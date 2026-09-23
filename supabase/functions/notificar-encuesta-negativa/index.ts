// notificar-encuesta-negativa
//
// La página pública de la encuesta (EncuestaPublica.jsx) llama a esta
// función justo después de que `encuesta_responder()` clasifica la
// respuesta como "negativo" -cualquiera de las 4 preguntas quedó en 1-2
// estrellas-. El pedido del cliente fue explícito: "no puedo dejar pasar a
// nivel interno ninguno de los puntos", así que admin/socia reciben un
// correo con el desglose de qué área(s) fallaron, no solo un puntaje.
//
// Usa service role a propósito -corre después de una respuesta anónima,
// no de una sesión de usuario-, pero NUNCA confía en lo que mande el
// cliente: vuelve a leer la fila real por token y solo envía si
// `clasificacion = 'negativo'` y `notificado_en` sigue vacío (esa
// actualización atómica también evita un doble envío si la página
// reintenta la llamada).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { enviarCorreo } from '../_shared/brevo.ts'

const ETIQUETA_AREA: Record<string, string> = {
  entrega_tiempo: 'Entrega a tiempo',
  atencion_cliente: 'Atención del asesor',
  servicio_mecanico: 'Servicio mecánico',
  recomendaria: 'Recomendaría el servicio',
}

interface EncuestaFila {
  id: string
  trabajo_id: string
  clasificacion: string | null
  areas_bajas: string[] | null
  calificacion_entrega_tiempo: number | null
  calificacion_atencion_cliente: number | null
  calificacion_servicio_mecanico: number | null
  calificacion_recomendaria: number | null
  sugerencia: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'

  let token: string | undefined
  try {
    const cuerpo = await req.json()
    token = cuerpo?.token
  } catch {
    return respuestaJson({ error: { mensaje: 'Cuerpo inválido, se esperaba { token }.' } }, 400)
  }

  if (!token) {
    return respuestaJson({ error: { mensaje: 'Falta el token de la encuesta.' } }, 400)
  }

  const { data: encuesta, error: errorEncuesta } = await supabase
    .from('encuestas')
    .select(
      'id, trabajo_id, clasificacion, areas_bajas, calificacion_entrega_tiempo, calificacion_atencion_cliente, calificacion_servicio_mecanico, calificacion_recomendaria, sugerencia'
    )
    .eq('token', token)
    .maybeSingle<EncuestaFila>()

  if (errorEncuesta || !encuesta) {
    return respuestaJson({ data: { enviado: false, motivo: 'encuesta_no_encontrada' } })
  }

  if (encuesta.clasificacion !== 'negativo') {
    return respuestaJson({ data: { enviado: false, motivo: 'no_es_negativa' } })
  }

  // Guardia atómica: solo el llamado que realmente logra poner
  // notificado_en (desde null) sigue adelante y manda el correo.
  const { data: marcada } = await supabase
    .from('encuestas')
    .update({ notificado_en: new Date().toISOString() })
    .eq('id', encuesta.id)
    .is('notificado_en', null)
    .select('id')
    .maybeSingle()

  if (!marcada) {
    return respuestaJson({ data: { enviado: false, motivo: 'ya_notificada' } })
  }

  const { data: trabajo, error: errorTrabajo } = await supabase
    .from('trabajos_taller')
    .select(
      'id, numero_ot, empresa_id, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)'
    )
    .eq('id', encuesta.trabajo_id)
    .maybeSingle()

  if (errorTrabajo || !trabajo) {
    await supabase.from('integraciones_brevo_errores').insert({
      encuesta_id: encuesta.id,
      operacion: 'notificar_encuesta_negativa',
      mensaje: 'No se encontró la OT asociada a la encuesta.',
    })
    return respuestaJson({ data: { enviado: false, motivo: 'ot_no_encontrada' } })
  }

  const { data: destinatarios } = await supabase
    .from('usuarios')
    .select('correo, nombre_completo')
    .eq('empresa_id', trabajo.empresa_id)
    .eq('activo', true)
    .in('rol', ['admin', 'socia'])

  if (!destinatarios || destinatarios.length === 0) {
    await supabase.from('integraciones_brevo_errores').insert({
      empresa_id: trabajo.empresa_id,
      encuesta_id: encuesta.id,
      operacion: 'notificar_encuesta_negativa',
      mensaje: 'No hay usuarios admin/socia activos a quién avisar.',
    })
    return respuestaJson({ data: { enviado: false, motivo: 'sin_destinatarios' } })
  }

  const cliente = Array.isArray(trabajo.clientes) ? trabajo.clientes[0] : trabajo.clientes
  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos
  const nombreCliente = cliente?.razon_social || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ')

  const areasBajas = encuesta.areas_bajas || []
  const filasCalificaciones = [
    ['Entrega a tiempo', encuesta.calificacion_entrega_tiempo],
    ['Atención del asesor', encuesta.calificacion_atencion_cliente],
    ['Servicio mecánico', encuesta.calificacion_servicio_mecanico],
    ['Recomendaría el servicio', encuesta.calificacion_recomendaria],
  ]
    .map(([etiqueta, valor]) => {
      const esBaja = areasBajas.includes(
        Object.keys(ETIQUETA_AREA).find((clave) => ETIQUETA_AREA[clave] === etiqueta) || ''
      )
      const estrellas = '★'.repeat(Number(valor)) + '☆'.repeat(5 - Number(valor))
      return `<li${esBaja ? ' style="color:#b91c1c;font-weight:bold;"' : ''}>${etiqueta}: ${estrellas} (${valor}/5)${esBaja ? ' — requiere revisión' : ''}</li>`
    })
    .join('')

  const enlaceOt = `${appUrl}/trabajos/${trabajo.id}`
  const areasTexto = areasBajas.map((clave) => ETIQUETA_AREA[clave] || clave).join(', ')

  const html = `
    <p>Encuesta de postventa con calificación baja — OT ${trabajo.numero_ot}.</p>
    <p><strong>Cliente:</strong> ${nombreCliente || '(sin nombre)'} · <strong>Vehículo:</strong> ${vehiculo?.marca ?? ''} ${vehiculo?.modelo ?? ''} (${vehiculo?.patente ?? ''})</p>
    <p><strong>Área(s) a revisar:</strong> ${areasTexto || '—'}</p>
    <ul>${filasCalificaciones}</ul>
    ${encuesta.sugerencia ? `<p><strong>Sugerencia del cliente:</strong> ${encuesta.sugerencia}</p>` : ''}
    <p><a href="${enlaceOt}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;
    text-decoration:none;border-radius:6px;">Ver OT en el CRM</a></p>
  `

  let enviados = 0
  for (const destinatario of destinatarios) {
    try {
      await enviarCorreo({
        destinatarioEmail: destinatario.correo,
        destinatarioNombre: destinatario.nombre_completo,
        asunto: `⚠ Encuesta negativa — OT ${trabajo.numero_ot} (${areasTexto || 'revisar'})`,
        html,
      })
      enviados++
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      await supabase.from('integraciones_brevo_errores').insert({
        empresa_id: trabajo.empresa_id,
        encuesta_id: encuesta.id,
        operacion: 'notificar_encuesta_negativa',
        mensaje,
        detalle: error instanceof Error ? { stack: error.stack, destinatario: destinatario.correo } : null,
      })
    }
  }

  return respuestaJson({ data: { enviado: enviados > 0, enviados, destinatarios: destinatarios.length } })
})
