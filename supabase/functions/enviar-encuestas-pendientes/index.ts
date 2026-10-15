// enviar-encuestas-pendientes
//
// Manda la encuesta de postventa de toda OT entregada cuyo día programado ya
// llegó (día siguiente a la entrega, agendado por el trigger
// programar_encuesta_postventa) y que todavía no se envió. Pensado para
// correr una vez al día -manual por ahora desde un botón de administración;
// automatizarlo con pg_cron + Supabase Vault es un paso aparte, documentado
// en el CHANGELOG en vez de ir en una migración con el secreto adentro-.
//
// Usa el service role a propósito para poder leer todas las empresas, pero
// NO recorre todas por cualquiera que llame: con la sesión de una persona
// solo procesa las encuestas de SU empresa (si no, un botón apretado desde
// el tenant de demostración le escribiría a clientes reales de otro taller).
// Solo el service role -el job automático futuro- recorre todas las empresas,
// y aun así se salta las empresas demo (sus clientes son ficticios).
//
// Empresa demo (empresas.es_demo): la persona ingresó al entrar a la demo un
// correo de cliente y otro de asesor, que llegan en el cuerpo de la llamada y
// NO se guardan en la base. En vez de recorrer pendientes, se toma la encuesta
// de la OT entregada más reciente y se REINICIA (sin respuestas, token nuevo,
// sin la notificación anterior) para que la demo se pueda repetir sin limpiar
// nada; se envía a ese correo de cliente y el correo de asesor viaja firmado
// dentro del enlace (ver _shared/demo.ts).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { formatearPatente } from '../_shared/patente.ts'
import { enviarCorreo } from '../_shared/brevo.ts'
import { correoValido, firmarCorreoAsesorDemo, normalizarCorreo } from '../_shared/demo.ts'

interface EncuestaPendiente {
  id: string
  token: string
  trabajos_taller: {
    id: string
    numero_ot: number
    empresa_id: string
    clientes: { nombre: string; apellido: string | null; razon_social: string | null; email: string | null } | null
    vehiculos: { patente: string; marca: string; modelo: string } | null
    empresas: { nombre: string; es_demo: boolean } | null
  } | null
}

function nombreDe(cliente: { nombre: string; apellido: string | null; razon_social: string | null }) {
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function htmlEncuesta(opciones: {
  nombreCliente: string
  empresa: string
  marca: string
  modelo: string
  patente: string
  numeroOt: number
  enlace: string
}) {
  return `
      <p>Hola ${opciones.nombreCliente},</p>
      <p>Gracias por confiar en ${opciones.empresa} para la mantención de tu ${opciones.marca} ${opciones.modelo}
      (patente ${formatearPatente(opciones.patente)}, OT ${opciones.numeroOt}).</p>
      <p>¿Cómo fue tu experiencia? Cuéntanos en menos de un minuto:</p>
      <p><a href="${opciones.enlace}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;
      text-decoration:none;border-radius:6px;">Responder encuesta</a></p>
      <p style="color:#888;font-size:12px;">Si el botón no funciona, copia este enlace: ${opciones.enlace}</p>
    `
}

async function enviarEncuestaDemo(
  supabase: SupabaseClient,
  empresaId: string,
  cuerpo: Record<string, unknown>,
  appUrl: string,
  hoy: string
) {
  const correoCliente = normalizarCorreo(cuerpo.correo_cliente_demo)
  const correoAsesor = normalizarCorreo(cuerpo.correo_asesor_demo)
  if (!correoValido(correoCliente) || !correoValido(correoAsesor)) {
    return respuestaJson(
      { error: { mensaje: 'Ingresa tus correos de prueba (cliente y asesor) en "Correos de prueba" antes de enviar.' } },
      400
    )
  }

  const { data: trabajo } = await supabase
    .from('trabajos_taller')
    .select('id, numero_ot, empresa_id, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo), empresas(nombre)')
    .eq('empresa_id', empresaId)
    .eq('estado', 'entregado')
    .order('fecha_entrega', { ascending: false })
    .limit(1)
    .maybeSingle()

  const cliente = Array.isArray(trabajo?.clientes) ? trabajo?.clientes[0] : trabajo?.clientes
  const vehiculo = Array.isArray(trabajo?.vehiculos) ? trabajo?.vehiculos[0] : trabajo?.vehiculos
  const empresa = Array.isArray(trabajo?.empresas) ? trabajo?.empresas[0] : trabajo?.empresas
  if (!trabajo || !cliente || !vehiculo || !empresa) {
    return respuestaJson({ error: { mensaje: 'La demo no tiene una OT entregada para armar la encuesta de prueba.' } }, 409)
  }

  const { data: encuesta } = await supabase.from('encuestas').select('id').eq('trabajo_id', trabajo.id).maybeSingle()
  if (!encuesta) {
    return respuestaJson({ error: { mensaje: 'La OT entregada no tiene encuesta programada.' } }, 409)
  }

  // Reinicio: encuesta como nueva, con enlace nuevo, sin el aviso de la prueba anterior.
  const tokenNuevo = crypto.randomUUID().replaceAll('-', '')
  const { error: errorReinicio } = await supabase
    .from('encuestas')
    .update({
      token: tokenNuevo,
      programado_para: hoy,
      enviado_en: null,
      respondido_en: null,
      notificado_en: null,
      calificacion: null,
      comentario: null,
      calificacion_entrega_tiempo: null,
      calificacion_atencion_cliente: null,
      calificacion_servicio_mecanico: null,
      calificacion_recomendaria: null,
      como_conocio: null,
      sugerencia: null,
      clasificacion: null,
      areas_bajas: null,
    })
    .eq('id', encuesta.id)
  if (errorReinicio) {
    return respuestaJson({ error: { mensaje: `No se pudo reiniciar la encuesta de prueba: ${errorReinicio.message}` } }, 500)
  }
  await supabase.from('notificaciones').delete().eq('encuesta_id', encuesta.id)

  const firma = await firmarCorreoAsesorDemo(correoAsesor, tokenNuevo)
  const enlace = `${appUrl}/encuesta/${tokenNuevo}?da=${encodeURIComponent(correoAsesor)}&ds=${firma}`
  const nombreCliente = nombreDe(cliente)

  try {
    await enviarCorreo({
      destinatarioEmail: correoCliente,
      destinatarioNombre: nombreCliente,
      asunto: `[Demo] ¿Cómo estuvo tu visita a ${empresa.nombre}?`,
      html: htmlEncuesta({
        nombreCliente,
        empresa: empresa.nombre,
        marca: vehiculo.marca,
        modelo: vehiculo.modelo,
        patente: vehiculo.patente,
        numeroOt: trabajo.numero_ot,
        enlace,
      }),
    })
    await supabase.from('encuestas').update({ enviado_en: new Date().toISOString() }).eq('id', encuesta.id)
    return respuestaJson({ data: { enviadas: 1, pendientes_revisadas: 1, errores: [], demo: true, numero_ot: trabajo.numero_ot } })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    await supabase.from('integraciones_brevo_errores').insert({
      empresa_id: empresaId,
      encuesta_id: encuesta.id,
      operacion: 'enviar_encuesta',
      mensaje,
      detalle: error instanceof Error ? { stack: error.stack } : null,
    })
    return respuestaJson({
      data: { enviadas: 0, pendientes_revisadas: 1, errores: [{ encuesta_id: encuesta.id, mensaje }], demo: true },
    })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'

  const hoy = new Date().toISOString().slice(0, 10)

  // Quién llama: el service role (job de sistema) o una persona con sesión.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  let empresaDelUsuario: string | null = null
  if (!jwt || jwt !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    // Mismo patrón que whatsapp y facturacion-emitir: la sesión se valida con
    // un cliente de clave anónima y el JWT de la persona (con el cliente de
    // service role, getUser(jwt) no reconoce la sesión).
    const clienteAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: sesion } = await clienteAuth.auth.getUser(jwt)
    const { data: perfil } = sesion?.user
      ? await supabase.from('usuarios').select('empresa_id').eq('id', sesion.user.id).eq('activo', true).maybeSingle()
      : { data: null }
    if (!perfil) {
      return respuestaJson({ error: { mensaje: 'No autorizado: inicia sesión de nuevo para enviar encuestas.' } }, 401)
    }
    empresaDelUsuario = perfil.empresa_id
  }

  if (empresaDelUsuario) {
    const { data: empresaLlamador } = await supabase
      .from('empresas')
      .select('es_demo')
      .eq('id', empresaDelUsuario)
      .maybeSingle()
    if (empresaLlamador?.es_demo) {
      let cuerpo: Record<string, unknown> = {}
      try {
        cuerpo = (await req.json()) ?? {}
      } catch {
        // Sin cuerpo: los correos de prueba faltan y enviarEncuestaDemo lo avisa.
      }
      return await enviarEncuestaDemo(supabase, empresaDelUsuario, cuerpo, appUrl, hoy)
    }
  }

  let consulta = supabase
    .from('encuestas')
    .select(
      'id, token, trabajos_taller!inner(id, numero_ot, empresa_id, clientes(nombre, apellido, razon_social, email), vehiculos(patente, marca, modelo), empresas(nombre, es_demo))'
    )
    .is('enviado_en', null)
    .lte('programado_para', hoy)
  if (empresaDelUsuario) {
    consulta = consulta.eq('trabajos_taller.empresa_id', empresaDelUsuario)
  }
  const { data: pendientes, error: errorConsulta } = await consulta

  if (errorConsulta) {
    return respuestaJson({ error: { mensaje: errorConsulta.message } }, 500)
  }

  let enviadas = 0
  let revisadas = 0
  const errores: { encuesta_id: string; mensaje: string }[] = []

  for (const encuestaCruda of (pendientes ?? []) as unknown as EncuestaPendiente[]) {
    const trabajo = encuestaCruda.trabajos_taller
    const cliente = trabajo?.clientes
    const vehiculo = trabajo?.vehiculos
    const empresa = trabajo?.empresas

    // Las empresas demo tienen clientes ficticios: el job automático no les escribe.
    if (empresa?.es_demo) continue
    revisadas++

    if (!trabajo || !cliente?.email || !vehiculo || !empresa) {
      errores.push({ encuesta_id: encuestaCruda.id, mensaje: 'Cliente sin correo registrado; no se puede enviar.' })
      await supabase.from('integraciones_brevo_errores').insert({
        empresa_id: trabajo?.empresa_id ?? null,
        encuesta_id: encuestaCruda.id,
        operacion: 'enviar_encuesta',
        mensaje: 'Cliente sin correo registrado.',
      })
      continue
    }

    const nombreCliente = nombreDe(cliente)
    const enlace = `${appUrl}/encuesta/${encuestaCruda.token}`

    try {
      await enviarCorreo({
        destinatarioEmail: cliente.email,
        destinatarioNombre: nombreCliente,
        asunto: `¿Cómo estuvo tu visita a ${empresa.nombre}?`,
        html: htmlEncuesta({
          nombreCliente,
          empresa: empresa.nombre,
          marca: vehiculo.marca,
          modelo: vehiculo.modelo,
          patente: vehiculo.patente,
          numeroOt: trabajo.numero_ot,
          enlace,
        }),
      })

      await supabase.from('encuestas').update({ enviado_en: new Date().toISOString() }).eq('id', encuestaCruda.id)
      enviadas++
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      errores.push({ encuesta_id: encuestaCruda.id, mensaje })
      await supabase.from('integraciones_brevo_errores').insert({
        empresa_id: trabajo.empresa_id,
        encuesta_id: encuestaCruda.id,
        operacion: 'enviar_encuesta',
        mensaje,
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }
  }

  return respuestaJson({ data: { enviadas, pendientes_revisadas: revisadas, errores } })
})
