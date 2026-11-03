// analizar-inspeccion
//
// Analiza con visión (Claude vía API) las fotos de inspección ya guardadas de
// una OT (0068/0069): sugiere el inventario del interior y detecta daños con
// una caja de ubicación. El navegador solo manda el id de la OT (y,
// opcionalmente, qué fotos): las imágenes se leen de Storage en el servidor,
// nunca las manda el cliente.
//
// Flujo: identifica al usuario y su rol → lee las fotos con SU sesión (RLS ya
// impide ver las de otra empresa) → baja cada imagen con service role →
// pregunta al modelo → NORMALIZA la respuesta (es dato no confiable) → guarda
// con service role. Lo sugerido no es inventario hasta que una persona lo
// acepta en la pantalla de la OT.
//
// Procesa un lote acotado por llamada; `pendientes` en la respuesta dice si
// hay que volver a llamar. Una foto que falla queda con `analisis_error` y
// sin `analizado_en`, así que se reintenta en la siguiente llamada.
//
// Secrets: ANTHROPIC_API_KEY (obligatorio), ANTHROPIC_MODEL (opcional).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { HERRAMIENTA_ANALISIS, normalizarAnalisis, PROMPT_SISTEMA } from '../_shared/inspeccion.ts'

const ROLES_PUEDEN_ANALIZAR = ['admin', 'socia', 'asesor']
const MAX_FOTOS_POR_LLAMADA = 8
const EN_PARALELO = 3
const MODELO_POR_DEFECTO = 'claude-haiku-5-5'
const BUCKET = 'inspeccion-fotos'
const MAX_BYTES_IMAGEN = 4_500_000

interface FotoFila {
  id: string
  empresa_id: string
  zona: 'exterior' | 'interior'
  subzona: string | null
  storage_path: string
}

function aBase64(bytes: Uint8Array): string {
  let binario = ''
  const bloque = 0x8000
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloque))
  }
  return btoa(binario)
}

async function consultarModelo(clave: string, modelo: string, foto: FotoFila, imagenBase64: string): Promise<unknown> {
  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': clave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 1500,
      system: PROMPT_SISTEMA,
      tools: [HERRAMIENTA_ANALISIS],
      tool_choice: { type: 'tool', name: HERRAMIENTA_ANALISIS.name },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagenBase64 } },
            {
              type: 'text',
              text: `Foto de la zona "${foto.zona}"${foto.subzona ? ` (${foto.subzona})` : ''} de un vehículo que ingresa al taller. Analízala.`,
            },
          ],
        },
      ],
    }),
  })
  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 300)
    throw new Error(`La API de visión respondió ${respuesta.status}: ${detalle}`)
  }
  const cuerpo = await respuesta.json()
  const bloque = (cuerpo.content ?? []).find((b: { type: string }) => b.type === 'tool_use')
  if (!bloque) throw new Error('El modelo no devolvió un análisis estructurado.')
  return bloque.input
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const { trabajo_id: trabajoId, foto_ids: fotoIds, forzar } = await req.json()
    if (!trabajoId) return respuestaJson({ error: { mensaje: 'Falta trabajo_id.' } }, 400)

    const claveApi = Deno.env.get('ANTHROPIC_API_KEY')
    if (!claveApi) {
      return respuestaJson({ error: { mensaje: 'El análisis con IA no está configurado (falta el secret ANTHROPIC_API_KEY).' } }, 503)
    }
    const modelo = Deno.env.get('ANTHROPIC_MODEL') || MODELO_POR_DEFECTO

    const encabezadoAuth = req.headers.get('Authorization')
    if (!encabezadoAuth) return respuestaJson({ error: { mensaje: 'Sesión requerida.' } }, 401)

    const supabaseUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: encabezadoAuth } },
    })
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const token = encabezadoAuth.replace(/^Bearer\s+/i, '')
    const { data: datosAuth, error: errorAuth } = await supabaseUsuario.auth.getUser(token)
    if (errorAuth || !datosAuth?.user) return respuestaJson({ error: { mensaje: 'Sesión inválida o expirada.' } }, 401)

    const { data: usuario } = await supabaseUsuario
      .from('usuarios')
      .select('id, empresa_id, rol, activo')
      .eq('id', datosAuth.user.id)
      .maybeSingle()
    if (!usuario || !usuario.activo) return respuestaJson({ error: { mensaje: 'Cuenta inactiva.' } }, 403)
    if (!ROLES_PUEDEN_ANALIZAR.includes(usuario.rol ?? '')) {
      return respuestaJson({ error: { mensaje: 'Tu rol no puede analizar fotos de inspección.' } }, 403)
    }

    // Con la sesión del usuario: las fotos de otra empresa no se devuelven.
    let consulta = supabaseUsuario
      .from('inspeccion_fotos')
      .select('id, empresa_id, zona, subzona, storage_path')
      .eq('trabajo_id', trabajoId)
      .order('tomada_en', { ascending: true })
    if (Array.isArray(fotoIds) && fotoIds.length > 0) consulta = consulta.in('id', fotoIds)
    if (!forzar) consulta = consulta.is('analizado_en', null)
    const { data: candidatas, error: errorFotos } = await consulta
    if (errorFotos) return respuestaJson({ error: { mensaje: errorFotos.message } }, 500)

    const todas = (candidatas ?? []) as FotoFila[]
    const lote = todas.slice(0, MAX_FOTOS_POR_LLAMADA)
    const pendientes = todas.length - lote.length

    let analizadas = 0
    const errores: { foto_id: string; mensaje: string }[] = []
    let siguiente = 0

    async function procesar(foto: FotoFila) {
      try {
        if (!foto.storage_path.startsWith(`${foto.empresa_id}/`)) throw new Error('Ruta de foto inválida.')
        const { data: archivo, error: errorDescarga } = await supabase.storage.from(BUCKET).download(foto.storage_path)
        if (errorDescarga || !archivo) throw new Error(`No se pudo leer la foto: ${errorDescarga?.message ?? 'sin datos'}`)
        const bytes = new Uint8Array(await archivo.arrayBuffer())
        if (bytes.length > MAX_BYTES_IMAGEN) throw new Error('La foto es demasiado grande para analizarla.')

        const crudo = await consultarModelo(claveApi!, modelo, foto, aBase64(bytes))
        const analisis = normalizarAnalisis(crudo, foto.zona === 'interior')

        const { error: errorGuardado } = await supabase
          .from('inspeccion_fotos')
          .update({
            inventario_sugerido: analisis.objetos,
            danos_detectados: analisis.danos,
            analizado_en: new Date().toISOString(),
            analisis_error: null,
          })
          .eq('id', foto.id)
        if (errorGuardado) throw new Error(errorGuardado.message)
        analizadas++
      } catch (e) {
        const mensaje = e instanceof Error ? e.message : String(e)
        errores.push({ foto_id: foto.id, mensaje })
        await supabase.from('inspeccion_fotos').update({ analisis_error: mensaje.slice(0, 500) }).eq('id', foto.id)
      }
    }

    async function trabajador() {
      while (siguiente < lote.length) await procesar(lote[siguiente++])
    }
    await Promise.all(Array.from({ length: Math.min(EN_PARALELO, lote.length) }, trabajador))

    return respuestaJson({ data: { analizadas, errores, pendientes } })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    return respuestaJson({ error: { mensaje } }, 500)
  }
})
