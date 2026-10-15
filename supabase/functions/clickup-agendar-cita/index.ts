// clickup-agendar-cita
//
// Refleja en ClickUp las citas de la Agenda que quedaron pendientes: crea la
// tarjeta en el estado "agenda" de las citas nuevas, actualiza la de las que
// cambiaron de fecha/hora/servicio y retira la de las canceladas que nadie
// movió. Ver 0044_clickup_citas.sql y _shared/clickupCitas.ts.
//
// La llama la pantalla de Agenda después de guardar una cita y también al
// abrirse (reintenta las que fallaron). No recibe ningún id ni dato de la
// cita: procesa las pendientes de la empresa de quien llama, así que nadie
// puede pedirle que toque tarjetas de otra empresa. El bot de WhatsApp usa el
// mismo código directamente, sin pasar por acá.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { sincronizarCitasPendientes } from '../_shared/clickupCitas.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Misma verificación de sesión que whatsapp y facturacion-emitir: un cliente
  // de clave anónima con el JWT de la persona.
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const clienteAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: sesion } = await clienteAuth.auth.getUser(jwt)
  const { data: perfil } = sesion?.user
    ? await supabase.from('usuarios').select('empresa_id').eq('id', sesion.user.id).eq('activo', true).maybeSingle()
    : { data: null }
  if (!perfil) {
    return respuestaJson({ error: { mensaje: 'No autorizado: inicia sesión de nuevo.' } }, 401)
  }

  try {
    const resultado = await sincronizarCitasPendientes(supabase, perfil.empresa_id)
    return respuestaJson({ data: resultado })
  } catch (error) {
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : 'Error inesperado.' } }, 500)
  }
})
