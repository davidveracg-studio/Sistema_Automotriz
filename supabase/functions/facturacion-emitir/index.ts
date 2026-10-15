// facturacion-emitir
//
// Emite un documento tributario que está en borrador (0037_facturacion_
// electronica.sql). El navegador solo manda el id: el contenido sale de la
// base, los montos los calculó la base, y el proveedor de DTE se elige por
// la configuración de la empresa -nada de eso lo decide el cliente-.
//
// Flujo: identifica al usuario y su rol → carga el borrador con SU sesión
// (RLS ya impide leer documentos de otra empresa) → valida → "reclama" el
// documento (borrador/error → emitiendo, con un UPDATE condicional que
// hace imposible emitir dos veces en paralelo) → llama al proveedor → guarda
// el resultado. Las transiciones de estado las hace SOLO esta función con
// service role; RLS impide que un usuario cambie `estado` a mano.
//
// Si el proveedor emitió pero no logramos guardar el resultado, el documento
// queda en 'emitiendo' a propósito (no en 'error'): reintentar podría
// duplicar un DTE real. Ese caso se concilia a mano contra el proveedor, y
// la respuesta lo dice explícitamente.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { obtenerProveedor } from '../_shared/dte/index.ts'
import type { ReferenciaDte, SolicitudEmision, TipoDte } from '../_shared/dte/proveedor.ts'
import { validarDocumento } from '../_shared/dte/validar.ts'

const ROLES_PUEDEN_EMITIR = ['admin', 'socia', 'encargado_presupuestos', 'asesor']
const TIPOS_REFERENCIABLES = [33, 34, 39, 41, 56]

interface Documento {
  id: string
  empresa_id: string
  tipo_dte: number
  estado: string
  fecha_emision: string
  receptor_rut: string | null
  receptor_razon_social: string | null
  receptor_giro: string | null
  receptor_direccion: string | null
  receptor_comuna: string | null
  receptor_ciudad: string | null
  receptor_correo: string | null
  trabajo_id: string | null
  monto_neto: number
  monto_exento: number
  monto_iva: number
  monto_total: number
  referencia_documento_id: string | null
  referencia_codigo: number | null
  referencia_razon: string | null
  guia_indicador_traslado: number | null
}

function hoyChile(): string {
  // En Chile la fecha tributaria es la local; toISOString() da UTC y de
  // noche el día ya cambió respecto a Chile.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const { documento_id: documentoId } = await req.json()
    if (!documentoId) return respuestaJson({ error: { mensaje: 'Falta documento_id.' } }, 400)

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
    if (!ROLES_PUEDEN_EMITIR.includes(usuario.rol ?? '')) {
      return respuestaJson({ error: { mensaje: 'Tu rol no puede emitir documentos tributarios.' } }, 403)
    }

    // Con la sesión del usuario: si el documento es de otra empresa, RLS no lo devuelve.
    const { data: documentoCrudo } = await supabaseUsuario
      .from('documentos_tributarios')
      .select('*')
      .eq('id', documentoId)
      .maybeSingle()
    if (!documentoCrudo) return respuestaJson({ error: { mensaje: 'Documento no encontrado.' } }, 404)
    const documento = documentoCrudo as Documento

    if (!['borrador', 'error'].includes(documento.estado)) {
      return respuestaJson({ error: { mensaje: `El documento ya está en estado "${documento.estado}" y no se puede emitir.` } }, 409)
    }

    const { data: lineas } = await supabaseUsuario
      .from('documento_tributario_lineas')
      .select('numero_linea, nombre, descripcion, cantidad, unidad, precio_unitario, exento, monto_linea')
      .eq('documento_id', documentoId)
      .order('numero_linea')

    const { data: config } = await supabase
      .from('facturacion_config')
      .select('proveedor, ambiente, activo')
      .eq('empresa_id', documento.empresa_id)
      .maybeSingle()
    if (!config || !config.activo) {
      return respuestaJson({ error: { mensaje: 'La facturación electrónica no está activa para esta empresa.' } }, 409)
    }

    const { data: empresa } = await supabase
      .from('empresas')
      .select('nombre, rut, giro, codigo_actividad, direccion, comuna, ciudad')
      .eq('id', documento.empresa_id)
      .maybeSingle()
    if (!empresa) return respuestaJson({ error: { mensaje: 'Empresa no encontrada.' } }, 404)

    const problemas = validarDocumento(
      documento,
      (lineas ?? []).map((l) => ({ numero_linea: l.numero_linea, nombre: l.nombre, cantidad: Number(l.cantidad), monto_linea: l.monto_linea })),
      empresa,
      config.proveedor,
      hoyChile()
    )

    // Validaciones que necesitan la base: la referencia de una NC/ND.
    let referencia: ReferenciaDte | null = null
    if (documento.tipo_dte === 56 || documento.tipo_dte === 61) {
      const { data: referenciado } = await supabase
        .from('documentos_tributarios')
        .select('id, empresa_id, tipo_dte, estado, folio, simulado, fecha_emision, monto_total')
        .eq('id', documento.referencia_documento_id)
        .maybeSingle()

      if (!referenciado || referenciado.empresa_id !== documento.empresa_id) {
        problemas.push('El documento referenciado no existe.')
      } else {
        if (!TIPOS_REFERENCIABLES.includes(referenciado.tipo_dte)) problemas.push('Ese tipo de documento no se puede referenciar.')
        if (referenciado.estado !== 'aceptado' || referenciado.folio == null) {
          problemas.push('El documento referenciado debe estar aceptado y tener folio.')
        }
        // Un documento simulado y uno real nunca se cruzan.
        if (referenciado.simulado !== (config.proveedor === 'sandbox')) {
          problemas.push('No se puede mezclar un documento simulado con uno real.')
        }
        if (documento.tipo_dte === 61 && documento.referencia_codigo === 1 && documento.monto_total !== referenciado.monto_total) {
          problemas.push('Una nota de crédito que anula debe tener el mismo monto total del documento referenciado.')
        }

        // Lo acreditado en total no puede superar lo facturado.
        if (documento.tipo_dte === 61) {
          const { data: previas } = await supabase
            .from('documentos_tributarios')
            .select('monto_total')
            .eq('referencia_documento_id', referenciado.id)
            .eq('tipo_dte', 61)
            .eq('estado', 'aceptado')
          const yaAcreditado = (previas ?? []).reduce((suma, fila) => suma + fila.monto_total, 0)
          if (yaAcreditado + documento.monto_total > referenciado.monto_total) {
            problemas.push('Las notas de crédito superarían el monto del documento referenciado.')
          }
        }

        referencia = {
          tipo_dte: referenciado.tipo_dte,
          folio: referenciado.folio,
          fecha_emision: referenciado.fecha_emision,
          codigo: documento.referencia_codigo as number,
          razon: documento.referencia_razon,
        }
      }
    }

    if (problemas.length > 0) {
      return respuestaJson({ error: { mensaje: problemas.join(' '), problemas } }, 422)
    }

    // Reclamo atómico: si dos clics/personas emiten a la vez, solo uno pasa.
    const { data: reclamado } = await supabase
      .from('documentos_tributarios')
      .update({ estado: 'emitiendo', error_detalle: null })
      .eq('id', documentoId)
      .in('estado', ['borrador', 'error'])
      .select('id')
      .maybeSingle()
    if (!reclamado) return respuestaJson({ error: { mensaje: 'Este documento ya se está emitiendo.' } }, 409)

    const solicitud: SolicitudEmision = {
      clave_idempotencia: documento.id,
      empresa_id: documento.empresa_id,
      ambiente: config.ambiente,
      tipo_dte: documento.tipo_dte as TipoDte,
      fecha_emision: documento.fecha_emision,
      emisor: {
        rut: empresa.rut,
        razon_social: empresa.nombre,
        giro: empresa.giro,
        codigo_actividad: empresa.codigo_actividad,
        direccion: empresa.direccion,
        comuna: empresa.comuna,
        ciudad: empresa.ciudad,
      },
      receptor: {
        rut: documento.receptor_rut,
        razon_social: documento.receptor_razon_social,
        giro: documento.receptor_giro,
        direccion: documento.receptor_direccion,
        comuna: documento.receptor_comuna,
        ciudad: documento.receptor_ciudad,
        correo: documento.receptor_correo,
      },
      lineas: (lineas ?? []).map((l) => ({ ...l, cantidad: Number(l.cantidad) })),
      montos: { neto: documento.monto_neto, exento: documento.monto_exento, iva: documento.monto_iva, total: documento.monto_total },
      referencia,
      guia_indicador_traslado: documento.guia_indicador_traslado,
    }

    let resultado
    try {
      resultado = await obtenerProveedor(config.proveedor, supabase).emitir(solicitud)
    } catch (errorProveedor) {
      const detalle = errorProveedor instanceof Error ? errorProveedor.message : String(errorProveedor)
      await supabase.from('documentos_tributarios').update({ estado: 'error', error_detalle: detalle }).eq('id', documentoId)
      return respuestaJson({ error: { mensaje: `No se pudo emitir: ${detalle}` } }, 502)
    }

    const { error: errorGuardar } = await supabase
      .from('documentos_tributarios')
      .update({
        estado: resultado.estado,
        folio: resultado.folio,
        simulado: resultado.simulado,
        proveedor: resultado.proveedor,
        proveedor_ref: resultado.proveedor_ref,
        url_pdf: resultado.url_pdf,
        url_xml: resultado.url_xml,
        error_detalle: resultado.estado === 'rechazado' ? resultado.mensaje : null,
        emitido_en: new Date().toISOString(),
      })
      .eq('id', documentoId)

    if (errorGuardar) {
      console.error('facturacion-emitir: el proveedor emitió pero no se pudo guardar el resultado', documentoId, resultado, errorGuardar)
      return respuestaJson(
        {
          error: {
            mensaje:
              'El proveedor emitió el documento pero no pudimos guardar el resultado. NO reintentes: avisa a un administrador para conciliar (documento ' +
              documentoId +
              ').',
          },
        },
        500
      )
    }

    const advertencias: string[] = []

    if (resultado.estado === 'aceptado') {
      // La NC que anula deja el documento original como anulado.
      if (documento.tipo_dte === 61 && documento.referencia_codigo === 1 && documento.referencia_documento_id) {
        const { error: errorAnular } = await supabase
          .from('documentos_tributarios')
          .update({ estado: 'anulado' })
          .eq('id', documento.referencia_documento_id)
          .eq('estado', 'aceptado')
        if (errorAnular) advertencias.push('La nota de crédito se emitió pero no se pudo marcar el documento original como anulado.')
      }

      // El folio real se refleja en la OT; uno simulado NO (ver sandbox.ts).
      if (!resultado.simulado && documento.trabajo_id && [33, 34, 39, 41].includes(documento.tipo_dte) && resultado.folio != null) {
        const { error: errorOt } = await supabase
          .from('trabajos_taller')
          .update({ numero_documento_facturacion: String(resultado.folio) })
          .eq('id', documento.trabajo_id)
          .is('numero_documento_facturacion', null)
        if (errorOt) advertencias.push('El documento se emitió pero no se pudo registrar su número en la OT.')
      }
    }

    return respuestaJson({
      data: { estado: resultado.estado, folio: resultado.folio, simulado: resultado.simulado, mensaje: resultado.mensaje, advertencias },
    })
  } catch (error) {
    console.error('facturacion-emitir: error inesperado', error)
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : 'Error inesperado.' } }, 500)
  }
})
