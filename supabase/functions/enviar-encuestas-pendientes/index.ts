// enviar-encuestas-pendientes
//
// Manda la encuesta de postventa de toda OT entregada cuyo día programado ya
// llegó (día siguiente a la entrega, agendado por el trigger
// programar_encuesta_postventa) y que todavía no se envió. Pensado para
// correr una vez al día -manual por ahora desde un botón de administración;
// automatizarlo con pg_cron + Supabase Vault es un paso aparte, documentado
// en el CHANGELOG en vez de ir en una migración con el secreto adentro-.
//
// Usa el service role a propósito: es un job de sistema que recorre todas
// las empresas, no la acción de un usuario dentro de su propio tenant.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { enviarCorreo } from '../_shared/brevo.ts'

interface EncuestaPendiente {
  id: string
  token: string
  trabajos_taller: {
    id: string
    numero_ot: number
    empresa_id: string
    clientes: { nombre: string; apellido: string | null; razon_social: string | null; email: string | null } | null
    vehiculos: { patente: string; marca: string; modelo: string } | null
    empresas: { nombre: string } | null
  } | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const appUrl = Deno.env.get('APP_URL') || 'http://localhost:5173'

  const hoy = new Date().toISOString().slice(0, 10)

  const { data: pendientes, error: errorConsulta } = await supabase
    .from('encuestas')
    .select(
      'id, token, trabajos_taller(id, numero_ot, empresa_id, clientes(nombre, apellido, razon_social, email), vehiculos(patente, marca, modelo), empresas(nombre))'
    )
    .is('enviado_en', null)
    .lte('programado_para', hoy)

  if (errorConsulta) {
    return respuestaJson({ error: { mensaje: errorConsulta.message } }, 500)
  }

  let enviadas = 0
  const errores: { encuesta_id: string; mensaje: string }[] = []

  for (const encuestaCruda of (pendientes ?? []) as unknown as EncuestaPendiente[]) {
    const trabajo = encuestaCruda.trabajos_taller
    const cliente = trabajo?.clientes
    const vehiculo = trabajo?.vehiculos
    const empresa = trabajo?.empresas

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

    const nombreCliente = cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
    const enlace = `${appUrl}/encuesta/${encuestaCruda.token}`

    const html = `
      <p>Hola ${nombreCliente},</p>
      <p>Gracias por confiar en ${empresa.nombre} para la mantención de tu ${vehiculo.marca} ${vehiculo.modelo}
      (patente ${vehiculo.patente}, OT ${trabajo.numero_ot}).</p>
      <p>¿Cómo fue tu experiencia? Cuéntanos en menos de un minuto:</p>
      <p><a href="${enlace}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;
      text-decoration:none;border-radius:6px;">Responder encuesta</a></p>
      <p style="color:#888;font-size:12px;">Si el botón no funciona, copia este enlace: ${enlace}</p>
    `

    try {
      await enviarCorreo({
        destinatarioEmail: cliente.email,
        destinatarioNombre: nombreCliente,
        asunto: `¿Cómo estuvo tu visita a ${empresa.nombre}?`,
        html,
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

  return respuestaJson({ data: { enviadas, pendientes_revisadas: pendientes?.length ?? 0, errores } })
})
