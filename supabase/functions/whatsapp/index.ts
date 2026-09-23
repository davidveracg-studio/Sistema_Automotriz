// whatsapp
//
// Webhook + endpoint de envío para la integración de WhatsApp Cloud API en
// modo Coexistencia (dos números reales de Didial: Toyota y Multimarca, ver
// 0032_whatsapp_recepcion.sql). Un solo Deno.serve maneja dos cosas
// distintas, cada una con su propia forma de autenticación -Verify JWT
// queda OFF en el dashboard de Supabase a propósito, porque Meta llama al
// webhook sin ninguna sesión de Supabase-:
//
//   1. GET  -> verificación del webhook (handshake único al suscribir en
//      Meta App Dashboard): compara hub.verify_token contra WA_VERIFY_TOKEN.
//   2. POST con encabezado Authorization -> acción propia del CRM (enviar
//      un mensaje desde el panel de Recepción). Con "Verify JWT" en OFF a
//      nivel de función, el gateway de Supabase no valida esto solo, así
//      que se verifica acá mismo contra Supabase Auth (`auth.getUser`) y se
//      confirma el rol de quien llama contra `usuarios` -igual que
//      cualquier otra pantalla protegida de este CRM, nada de un secreto
//      estático compartido: un documento de referencia de otro proyecto
//      proponía eso, pero acá el frontend es una SPA pública y cualquier
//      secreto embebido en su bundle deja de ser secreto-.
//   3. POST sin ese encabezado -> webhook real de Meta. Exige una firma
//      X-Hub-Signature-256 válida (HMAC-SHA256 con WA_APP_SECRET) antes de
//      procesar nada -sin esto, cualquiera que adivinara la URL podría
//      inyectar mensajes falsos en la bandeja de Recepción-.
//
// Formas de payload verificadas contra la documentación oficial de Meta
// (developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/*)
// el 2026-09-21, no adivinadas de un documento de otro proyecto: los 5
// campos (`messages`, `smb_message_echoes`, `history`, `smb_app_state_sync`,
// `account_update`) usan el mismo sobre `entry[].changes[].field/value`
// -incluyendo `history`, que ese documento anterior asumía con una forma
// distinta-. Aun así, nada de esto se ha probado todavía contra un webhook
// real (la cuenta de Meta sigue esperando aprobación de "Tech Provider"):
// `payload_original` se guarda siempre crudo en cada tabla para poder
// reprocesar si algún nombre de campo resulta distinto en producción real.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GRAPH_BASE = 'https://graph.facebook.com/v23.0'

// Roles que pueden operar el panel de Recepción -mismo grupo que la policy
// de UPDATE de whatsapp_contactos en 0032_whatsapp_recepcion.sql-.
const ROLES_PUEDEN_ENVIAR = ['asesor', 'recepcionista', 'jefe_taller', 'admin', 'socia']

// Bot de agendamiento (0034_agenda_calendario_y_bot.sql): menú guiado por
// números, sin IA -confirmado con el cliente 2026-09-22-. Los 3 segmentos
// son los únicos que existen en catalogo_servicios; el texto es solo la
// etiqueta amigable que ve el cliente, "valor" es lo que se guarda/consulta.
const SEGMENTOS_BOT = [
  { etiqueta: 'Mecánica general', valor: 'Taller Mecánico' },
  { etiqueta: 'Servicio rápido (aceite, filtros, alineación, etc.)', valor: 'Servicio Rápido' },
  { etiqueta: 'Pintura, desabolladura o lavado', valor: 'DyP' },
]

const TAMANO_PAGINA_BOT = 9

// deno-lint-ignore no-explicit-any
type Cambio = { field: string; value: Record<string, any> }
type Entrada = { id: string; changes?: Cambio[] }

function clienteServicio() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') return manejarVerificacion(url)
  if (req.method !== 'POST') return new Response('Método no soportado.', { status: 405 })

  const cuerpoCrudo = await req.text()
  const encabezadoAuth = req.headers.get('Authorization')

  if (encabezadoAuth) {
    const usuario = await usuarioDesdeToken(encabezadoAuth)
    if (!usuario) return json({ error: { mensaje: 'Sesión inválida o expirada.' } }, 401)
    if (!ROLES_PUEDEN_ENVIAR.includes(usuario.rol ?? '')) {
      return json({ error: { mensaje: 'Tu rol no tiene permiso para enviar mensajes de WhatsApp.' } }, 403)
    }
    return await manejarEnvio(clienteServicio(), usuario.empresa_id, JSON.parse(cuerpoCrudo))
  }

  if (!(await firmaValida(cuerpoCrudo, req.headers.get('X-Hub-Signature-256')))) {
    return json({ error: { mensaje: 'Firma inválida.' } }, 401)
  }

  const payload = JSON.parse(cuerpoCrudo) as { entry?: Entrada[] }
  await procesarWebhook(clienteServicio(), payload)
  return json({ recibido: true })
})

// Verifica el JWT de la sesión del navegador contra Supabase Auth (el
// gateway no lo hace por nosotros con "Verify JWT" en OFF) y confirma que
// la cuenta sigue activa y con rol -mismo criterio que ya usa `AuthContext`
// del frontend, reescrito acá porque el Edge Function no comparte ese
// código con el navegador-.
async function usuarioDesdeToken(encabezadoAuth: string): Promise<{ id: string; empresa_id: string; rol: string | null } | null> {
  const token = encabezadoAuth.replace(/^Bearer\s+/i, '')
  const clienteAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: datosAuth, error: errorAuth } = await clienteAuth.auth.getUser(token)
  if (errorAuth || !datosAuth?.user) return null

  const { data: fila } = await clienteAuth
    .from('usuarios')
    .select('id, empresa_id, rol, activo')
    .eq('id', datosAuth.user.id)
    .maybeSingle()

  if (!fila || !fila.activo) return null
  return fila
}

function manejarVerificacion(url: URL): Response {
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const desafio = url.searchParams.get('hub.challenge')
  if (modo === 'subscribe' && token && token === Deno.env.get('WA_VERIFY_TOKEN')) {
    return new Response(desafio ?? '', { status: 200 })
  }
  return new Response('Verificación fallida.', { status: 403 })
}

async function firmaValida(cuerpoCrudo: string, firmaRecibida: string | null): Promise<boolean> {
  const secreto = Deno.env.get('WA_APP_SECRET')
  if (!secreto || !firmaRecibida) return false

  const claveCripto = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const firma = await crypto.subtle.sign('HMAC', claveCripto, new TextEncoder().encode(cuerpoCrudo))
  const firmaHex =
    'sha256=' +
    Array.from(new Uint8Array(firma))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

  return firmaHex === firmaRecibida
}

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })
}

function tsAFecha(tsSegundos: string | number): string {
  return new Date(Number(tsSegundos) * 1000).toISOString()
}

function soloDigitos(valor: string | undefined | null): string {
  return (valor ?? '').replace(/[^0-9]/g, '')
}

// ---------------------------------------------------------------------------
// Despacho por campo (fix del documento original: un código que asume
// siempre "messages" pierde los otros 4 campos en silencio -responde 200 a
// Meta igual, así que el problema no se nota hasta que falta un mensaje-).
// ---------------------------------------------------------------------------
async function procesarWebhook(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  payload: { entry?: Entrada[] }
) {
  for (const entrada of payload.entry ?? []) {
    for (const cambio of entrada.changes ?? []) {
      try {
        switch (cambio.field) {
          case 'messages':
            await procesarMensajes(supabase, cambio.value)
            break
          case 'smb_message_echoes':
            await procesarEcos(supabase, cambio.value)
            break
          case 'history':
            await procesarHistorial(supabase, cambio.value)
            break
          case 'smb_app_state_sync':
            await procesarSincronizacionContactos(supabase, cambio.value)
            break
          case 'account_update':
            await procesarEventoCuenta(supabase, entrada.id, cambio.value)
            break
          default:
          // Campo no contemplado: se ignora, mismo criterio que clickup-webhook
          // con eventos que no le competen.
        }
      } catch (error) {
        console.error(`whatsapp: error procesando campo "${cambio.field}":`, error)
      }
    }
  }
}

// deno-lint-ignore no-explicit-any
async function empresaDeCuenta(supabase: any, phoneNumberId: string): Promise<string | null> {
  const { data } = await supabase.from('whatsapp_cuentas').select('empresa_id').eq('phone_number_id', phoneNumberId).maybeSingle()
  return data?.empresa_id ?? null
}

// deno-lint-ignore no-explicit-any
async function empresaDeWaba(supabase: any, wabaId: string): Promise<string | null> {
  const { data } = await supabase.from('whatsapp_cuentas').select('empresa_id').eq('waba_id', wabaId).maybeSingle()
  return data?.empresa_id ?? null
}

// Alta/actualización de contacto + intento de match automático por
// teléfono, todo en el RPC (ver 0032_whatsapp_recepcion.sql) para que sea
// atómico y nunca pise la categorización manual de Recepción.
async function registrarContacto(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  empresaId: string,
  phoneNumberId: string,
  waId: string | undefined,
  nombreWhatsapp: string | null
) {
  if (!waId) return
  const { error } = await supabase.rpc('whatsapp_registrar_contacto', {
    p_empresa_id: empresaId,
    p_phone_number_id: phoneNumberId,
    p_wa_id: waId,
    p_nombre_whatsapp: nombreWhatsapp,
  })
  if (error) console.error('whatsapp: error registrando contacto', error)
}

// deno-lint-ignore no-explicit-any
async function marcarSincronizacion(supabase: any, phoneNumberId: string, tipo: string, cambios: Record<string, unknown>) {
  const { data: existente } = await supabase
    .from('whatsapp_sincronizaciones')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .eq('tipo', tipo)
    .order('iniciado_en', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existente) {
    const { error } = await supabase.from('whatsapp_sincronizaciones').update(cambios).eq('id', existente.id)
    if (error) console.error('whatsapp: error actualizando sincronización', error)
    return
  }

  // No debería pasar en operación normal (la fila se crea al pedir la
  // sincronización), pero si llega un webhook sin ese registro previo, se
  // deja constancia igual en vez de perder la señal.
  const empresaId = await empresaDeCuenta(supabase, phoneNumberId)
  if (!empresaId) return
  const { error } = await supabase
    .from('whatsapp_sincronizaciones')
    .insert({ empresa_id: empresaId, phone_number_id: phoneNumberId, tipo, ...cambios })
  if (error) console.error('whatsapp: error creando sincronización', error)
}

// ---------------------------------------------------------------------------
// field = "messages": mensajes entrantes (value.messages), estados de
// entrega de lo que el CRM mandó (value.statuses).
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function procesarMensajes(supabase: any, valor: Record<string, any>) {
  const phoneNumberId = valor?.metadata?.phone_number_id
  if (!phoneNumberId) return
  const empresaId = await empresaDeCuenta(supabase, phoneNumberId)
  if (!empresaId) return

  const nombrePorWaId = new Map<string, string>()
  for (const contacto of valor.contacts ?? []) {
    if (contacto?.wa_id && contacto?.profile?.name) nombrePorWaId.set(contacto.wa_id, contacto.profile.name)
  }

  for (const mensaje of valor.messages ?? []) {
    await registrarContacto(supabase, empresaId, phoneNumberId, mensaje.from, nombrePorWaId.get(mensaje.from) ?? null)

    const { error } = await supabase.from('whatsapp_mensajes').upsert(
      {
        wamid: mensaje.id,
        empresa_id: empresaId,
        phone_number_id: phoneNumberId,
        wa_id: mensaje.from,
        direccion: 'entrante',
        origen: 'cloud_api',
        tipo_mensaje: mensaje.type,
        contenido: mensaje,
        wa_timestamp: tsAFecha(mensaje.timestamp),
        payload_original: mensaje,
      },
      { onConflict: 'wamid', ignoreDuplicates: true }
    )
    if (error) console.error('whatsapp: error insertando mensaje entrante', error)

    const contacto = await obtenerContacto(supabase, phoneNumberId, mensaje.from)
    await manejarBot(supabase, contacto, mensaje)
  }

  for (const estado of valor.statuses ?? []) {
    const { error } = await supabase.from('whatsapp_mensajes').update({ estado_entrega: estado.status }).eq('wamid', estado.id)
    if (error) console.error('whatsapp: error actualizando estado de entrega', error)
  }
}

// ---------------------------------------------------------------------------
// field = "smb_message_echoes": el equipo respondió desde la app del
// celular, no desde el CRM -mismo hilo, saliente-.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function procesarEcos(supabase: any, valor: Record<string, any>) {
  const phoneNumberId = valor?.metadata?.phone_number_id
  if (!phoneNumberId) return
  const empresaId = await empresaDeCuenta(supabase, phoneNumberId)
  if (!empresaId) return

  for (const eco of valor.message_echoes ?? []) {
    await registrarContacto(supabase, empresaId, phoneNumberId, eco.to, null)
    // Un humano respondió desde la app del celular: el bot no debe seguir
    // contestando por encima -mismo criterio que un envío desde el panel-.
    await supabase.from('whatsapp_contactos').update({ bot_pausado: true }).eq('phone_number_id', phoneNumberId).eq('wa_id', eco.to)

    const { error } = await supabase.from('whatsapp_mensajes').upsert(
      {
        wamid: eco.id,
        empresa_id: empresaId,
        phone_number_id: phoneNumberId,
        wa_id: eco.to,
        direccion: 'saliente',
        origen: 'app_celular',
        tipo_mensaje: eco.type,
        contenido: eco,
        wa_timestamp: tsAFecha(eco.timestamp),
        payload_original: eco,
      },
      { onConflict: 'wamid', ignoreDuplicates: true }
    )
    if (error) console.error('whatsapp: error insertando eco de mensaje', error)
  }
}

// ---------------------------------------------------------------------------
// field = "history": carga única de conversación previa a la conexión
// (hasta 180 días), en fases/chunks. value.history[].errors (código
// 2593109) si el negocio no compartió historial desde la app.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function procesarHistorial(supabase: any, valor: Record<string, any>) {
  const phoneNumberId = valor?.metadata?.phone_number_id
  if (!phoneNumberId) return
  const empresaId = await empresaDeCuenta(supabase, phoneNumberId)
  if (!empresaId) return

  const numeroNegocio = soloDigitos(valor?.metadata?.display_phone_number)

  for (const item of valor.history ?? []) {
    if (item.errors?.length) {
      const codigo = item.errors[0]?.code
      if (codigo === 2593109) {
        await marcarSincronizacion(supabase, phoneNumberId, 'historial', {
          estado: 'rechazado',
          completado_en: new Date().toISOString(),
        })
      } else {
        console.error('whatsapp: error en history', item.errors)
      }
      continue
    }

    const fase = item.metadata?.phase ?? null
    const progreso = item.metadata?.progress ?? null

    await marcarSincronizacion(supabase, phoneNumberId, 'historial', {
      estado: Number(progreso) >= 100 ? 'completo' : 'en_progreso',
      fase,
      progreso,
      completado_en: Number(progreso) >= 100 ? new Date().toISOString() : null,
    })

    for (const hilo of item.threads ?? []) {
      const waId = hilo.id
      await registrarContacto(supabase, empresaId, phoneNumberId, waId, null)

      for (const mensaje of hilo.messages ?? []) {
        const direccion = soloDigitos(mensaje.from) === numeroNegocio ? 'saliente' : 'entrante'
        const { error } = await supabase.from('whatsapp_mensajes').upsert(
          {
            wamid: mensaje.id,
            empresa_id: empresaId,
            phone_number_id: phoneNumberId,
            wa_id: waId,
            direccion,
            origen: 'historial',
            tipo_mensaje: mensaje.type,
            contenido: mensaje,
            fase_historial: fase,
            wa_timestamp: tsAFecha(mensaje.timestamp),
            payload_original: mensaje,
          },
          { onConflict: 'wamid', ignoreDuplicates: true }
        )
        if (error) console.error('whatsapp: error insertando mensaje de historial', error)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// field = "smb_app_state_sync": altas/ediciones ("add") y bajas ("remove")
// de contactos en la app del celular. Una baja NO borra el contacto acá
// -perdería el vínculo con el cliente y, por cascada, su historial de
// mensajes-, solo queda registrado en el log de la función.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function procesarSincronizacionContactos(supabase: any, valor: Record<string, any>) {
  const phoneNumberId = valor?.metadata?.phone_number_id
  if (!phoneNumberId) return
  const empresaId = await empresaDeCuenta(supabase, phoneNumberId)
  if (!empresaId) return

  for (const item of valor.state_sync ?? []) {
    if (item.type !== 'contact') continue

    if (item.action === 'add') {
      const nombre = item.contact?.full_name || item.contact?.first_name || null
      await registrarContacto(supabase, empresaId, phoneNumberId, item.contact?.phone_number, nombre)
    } else if (item.action === 'remove') {
      console.log(`whatsapp: contacto eliminado en la app del celular (${item.contact?.phone_number ?? 'desconocido'})`)
    }
  }
}

// ---------------------------------------------------------------------------
// field = "account_update": PARTNER_REMOVED (se desconectó de la API),
// ACCOUNT_OFFBOARDED, ACCOUNT_RECONNECTED. Solo PARTNER_REMOVED trae
// waba_info -para los otros dos se usa el id de la entrada (WABA ID real
// según la referencia de Meta), y ninguno trae phone_number_id-.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function procesarEventoCuenta(supabase: any, wabaIdEntrada: string, valor: Record<string, any>) {
  const wabaId = valor?.waba_info?.waba_id ?? wabaIdEntrada
  const empresaId = await empresaDeWaba(supabase, wabaId)

  const { error } = await supabase.from('whatsapp_eventos_cuenta').insert({
    empresa_id: empresaId,
    waba_id: wabaId,
    evento: valor?.event ?? 'desconocido',
    motivo: valor?.disconnection_info?.reason ?? null,
    iniciado_por: valor?.disconnection_info?.initiated_by ?? null,
    payload_original: valor,
  })
  if (error) console.error('whatsapp: error insertando evento de cuenta', error)

  if (valor?.event === 'PARTNER_REMOVED' && empresaId) {
    const { error: errorNotif } = await supabase.from('notificaciones').insert({
      empresa_id: empresaId,
      tipo: 'whatsapp_desconectado',
      titulo: 'WhatsApp desconectado',
      mensaje: `El número quedó desconectado de la API (WABA ${wabaId}). Hay que repetir la conexión desde Embedded Signup dentro de las próximas 24 horas para no perder mensajes.`,
    })
    if (errorNotif) console.error('whatsapp: error creando notificación de desconexión', errorNotif)
  }
}

// ---------------------------------------------------------------------------
// Llamada real a la Graph API para mandar un mensaje de texto. No registra
// nada en la base -eso lo hace quien llama, según si es un envío humano
// (manejarEnvio) o del bot (enviarBot)-, para no forzar a este helper a
// conocer empresa_id ni el resto del contexto de cada caso.
// ---------------------------------------------------------------------------
async function enviarTexto(phoneNumberId: string, waId: string, texto: string): Promise<{ ok: boolean; resultado: unknown }> {
  const respuesta = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('WA_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: waId, type: 'text', text: { body: texto } }),
  })
  const resultado = await respuesta.json()
  return { ok: respuesta.ok, resultado }
}

// deno-lint-ignore no-explicit-any
function wamidDe(resultado: any): string | undefined {
  return resultado?.messages?.[0]?.id
}

// ---------------------------------------------------------------------------
// Acción propia del CRM: enviar un mensaje de texto desde el panel de
// Recepción. Verificada por sesión real de Supabase (ver Deno.serve arriba),
// no por un secreto estático. Al enviar, se marca bot_pausado=true -un
// humano ya está atendiendo esta conversación, el bot no debe seguir
// contestando por encima de lo que Recepción está escribiendo-.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
async function manejarEnvio(supabase: any, empresaId: string, body: Record<string, any>): Promise<Response> {
  const phoneNumberId = body?.phone_number_id
  const waId = body?.wa_id
  const texto = body?.texto

  if (!phoneNumberId || !waId || !texto) {
    return json({ error: { mensaje: 'Faltan phone_number_id, wa_id o texto.' } }, 400)
  }

  // La cuenta debe ser de la MISMA empresa de quien llama -nunca confiar en
  // el phone_number_id que manda el body sin cruzarlo contra algo propio
  // del usuario autenticado; en multi-tenant, evita que alguien mande un
  // phone_number_id de otro tenant y el mensaje salga igual.
  const empresaDeLaCuenta = await empresaDeCuenta(supabase, phoneNumberId)
  if (empresaDeLaCuenta !== empresaId) {
    return json({ error: { mensaje: 'Esa cuenta de WhatsApp no pertenece a tu empresa.' } }, 403)
  }

  const { ok, resultado } = await enviarTexto(phoneNumberId, waId, texto)
  if (!ok) {
    return json({ error: { mensaje: 'Meta rechazó el envío.', detalle: resultado } }, 502)
  }

  const wamid = wamidDe(resultado)

  if (wamid) {
    const { error } = await supabase.from('whatsapp_mensajes').upsert(
      {
        wamid,
        empresa_id: empresaId,
        phone_number_id: phoneNumberId,
        wa_id: waId,
        direccion: 'saliente',
        origen: 'cloud_api',
        tipo_mensaje: 'text',
        contenido: { text: { body: texto } },
        wa_timestamp: new Date().toISOString(),
        payload_original: resultado,
      },
      { onConflict: 'wamid', ignoreDuplicates: true }
    )
    if (error) console.error('whatsapp: error registrando mensaje enviado', error)

    await registrarContacto(supabase, empresaId, phoneNumberId, waId, null)
    await supabase.from('whatsapp_contactos').update({ bot_pausado: true }).eq('phone_number_id', phoneNumberId).eq('wa_id', waId)
  }

  return json({ ok: true, wamid })
}

// ===========================================================================
// Bot de agendamiento (0034_agenda_calendario_y_bot.sql). Menú guiado por
// números -segmento → categoría → servicio → horario-, sin interpretar
// texto libre. Se apoya en catalogo_isla_para_servicio/catalogo_horas_servicio
// /citas_buscar_horarios (todas SQL, no reimplementadas acá) y agenda
// directo apenas encuentra un horario -confirmado con el cliente
// 2026-09-22-, reutilizando la notificación "cita nueva" que ya existe
// (0031_notificaciones.sql) en vez de un aviso aparte.
//
// Estado de la conversación: whatsapp_contactos.bot_estado/bot_contexto.
// bot_contexto guarda, para el paso actual, las opciones mostradas
// (etiqueta visible + valor real) y la página, para poder traducir la
// respuesta numérica del cliente sin volver a consultar la base.
// ===========================================================================

// deno-lint-ignore no-explicit-any
async function obtenerContacto(supabase: any, phoneNumberId: string, waId: string) {
  const { data } = await supabase.from('whatsapp_contactos').select('*').eq('phone_number_id', phoneNumberId).eq('wa_id', waId).maybeSingle()
  return data
}

// deno-lint-ignore no-explicit-any
async function enviarBot(supabase: any, contacto: any, texto: string) {
  const { ok, resultado } = await enviarTexto(contacto.phone_number_id, contacto.wa_id, texto)
  if (!ok) {
    console.error('whatsapp: el bot no pudo enviar el mensaje', resultado)
    return
  }
  const wamid = wamidDe(resultado)
  if (!wamid) return
  const { error } = await supabase.from('whatsapp_mensajes').upsert(
    {
      wamid,
      empresa_id: contacto.empresa_id,
      phone_number_id: contacto.phone_number_id,
      wa_id: contacto.wa_id,
      direccion: 'saliente',
      origen: 'cloud_api',
      tipo_mensaje: 'text',
      contenido: { text: { body: texto } },
      wa_timestamp: new Date().toISOString(),
      payload_original: resultado,
    },
    { onConflict: 'wamid', ignoreDuplicates: true }
  )
  if (error) console.error('whatsapp: error registrando mensaje del bot', error)
}

// deno-lint-ignore no-explicit-any
async function actualizarBotEstado(supabase: any, contacto: any, botEstado: string | null, botContexto: unknown, extra: Record<string, unknown> = {}) {
  const { error } = await supabase
    .from('whatsapp_contactos')
    .update({ bot_estado: botEstado, bot_contexto: botContexto, ...extra })
    .eq('id', contacto.id)
  if (error) console.error('whatsapp: error actualizando estado del bot', error)
}

// Interpreta la respuesta numérica del cliente contra las opciones
// guardadas en bot_contexto (ver mostrarPaginaBot). Nunca intenta entender
// texto libre -si no es un número de la lista, es inválido-.
// deno-lint-ignore no-explicit-any
function resolverSeleccionBot(contexto: any, texto: string): { valor?: any; siguientePagina?: boolean; invalido?: boolean } {
  const numero = Number((texto || '').trim())
  const opciones = contexto?.opciones ?? []
  const pagina = contexto?.pagina ?? 0
  if (!Number.isInteger(numero)) return { invalido: true }

  const inicio = pagina * TAMANO_PAGINA_BOT
  if (numero === 0) {
    if (opciones.length > inicio + TAMANO_PAGINA_BOT) return { siguientePagina: true }
    return { invalido: true }
  }
  if (numero < 1 || numero > TAMANO_PAGINA_BOT) return { invalido: true }

  const opcion = opciones[inicio + numero - 1]
  if (!opcion) return { invalido: true }
  return { valor: opcion.valor }
}

// Muestra una lista numerada (paginada de a 9 -Servicio Rápido/Taller
// Mecánico tienen muchas categorías/servicios, no caben en un solo mensaje
// legible-) y guarda el estado para poder resolver la respuesta.
async function mostrarPaginaBot(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  contacto: any,
  paso: string,
  pregunta: string,
  // deno-lint-ignore no-explicit-any
  opciones: { etiqueta: string; valor: any }[],
  contextoExtra: Record<string, unknown>,
  pagina = 0
) {
  const inicio = pagina * TAMANO_PAGINA_BOT
  const visibles = opciones.slice(inicio, inicio + TAMANO_PAGINA_BOT)
  let texto = `${pregunta}\n\n`
  visibles.forEach((opcion, indice) => {
    texto += `${indice + 1}) ${opcion.etiqueta}\n`
  })
  if (opciones.length > inicio + TAMANO_PAGINA_BOT) texto += `0) Ver más opciones\n`
  texto += `\nResponde con el número.`

  await enviarBot(supabase, contacto, texto)
  await actualizarBotEstado(supabase, contacto, paso, { ...contextoExtra, opciones, pagina })
}

function formatoFechaCortaBot(fechaIso: string): string {
  const fecha = new Date(`${fechaIso}T00:00:00`)
  return fecha.toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: '2-digit' })
}

// deno-lint-ignore no-explicit-any
async function obtenerCategoriasBot(supabase: any, empresaId: string, segmento: string): Promise<string[]> {
  const { data } = await supabase
    .from('catalogo_servicios')
    .select('categoria')
    .eq('empresa_id', empresaId)
    .eq('segmento', segmento)
    .eq('activo', true)
  const categorias = [...new Set((data ?? []).map((fila: { categoria: string }) => fila.categoria))] as string[]
  return categorias.sort()
}

async function obtenerServiciosBot(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  empresaId: string,
  segmento: string,
  categoria: string
): Promise<{ etiqueta: string; valor: string }[]> {
  const { data } = await supabase
    .from('catalogo_servicios')
    .select('id, servicio')
    .eq('empresa_id', empresaId)
    .eq('segmento', segmento)
    .eq('categoria', categoria)
    .eq('activo', true)
    .order('servicio')
  return (data ?? []).map((fila: { id: string; servicio: string }) => ({ etiqueta: fila.servicio, valor: fila.id }))
}

// deno-lint-ignore no-explicit-any
async function mostrarMenuPrincipalBot(supabase: any, contacto: any) {
  const texto =
    'Hola, soy el asistente de Servicio Automotriz Didial.\n¿En qué te podemos ayudar?\n\n1) Agendar una hora\n2) Hablar con un asesor\n\nResponde con el número de la opción.'
  await enviarBot(supabase, contacto, texto)
  await actualizarBotEstado(supabase, contacto, 'saludo', {})
}

// deno-lint-ignore no-explicit-any
async function manejarSaludoBot(supabase: any, contacto: any, texto: string) {
  const opcion = texto.trim()
  if (opcion === '1') {
    await mostrarPaginaBot(
      supabase,
      contacto,
      'elige_segmento',
      '¿Qué tipo de servicio necesitas?',
      SEGMENTOS_BOT,
      {}
    )
  } else if (opcion === '2') {
    await enviarBot(supabase, contacto, 'Perfecto, un asesor te va a escribir a la brevedad.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
  } else {
    await enviarBot(supabase, contacto, 'No entendí tu respuesta. Responde 1 para agendar una hora o 2 para hablar con un asesor.')
  }
}

// deno-lint-ignore no-explicit-any
async function manejarEligeSegmentoBot(supabase: any, contacto: any, texto: string) {
  const contexto = contacto.bot_contexto
  const resultado = resolverSeleccionBot(contexto, texto)

  if (resultado.siguientePagina) {
    await mostrarPaginaBot(supabase, contacto, 'elige_segmento', '¿Qué tipo de servicio necesitas?', contexto.opciones, {}, (contexto.pagina ?? 0) + 1)
    return
  }
  if (resultado.invalido) {
    await enviarBot(supabase, contacto, 'No entendí tu respuesta. Responde con el número de la lista.')
    return
  }

  const segmento = resultado.valor as string
  const categorias = await obtenerCategoriasBot(supabase, contacto.empresa_id, segmento)
  if (!categorias.length) {
    await enviarBot(supabase, contacto, 'Por ahora no tenemos servicios cargados en esa categoría. Un asesor te va a contactar para coordinar directamente.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
    return
  }

  const opciones = categorias.map((categoria) => ({ etiqueta: categoria, valor: categoria }))
  await mostrarPaginaBot(supabase, contacto, 'elige_categoria', '¿Qué necesitas específicamente?', opciones, { segmento })
}

// deno-lint-ignore no-explicit-any
async function manejarEligeCategoriaBot(supabase: any, contacto: any, texto: string) {
  const contexto = contacto.bot_contexto
  const resultado = resolverSeleccionBot(contexto, texto)

  if (resultado.siguientePagina) {
    await mostrarPaginaBot(supabase, contacto, 'elige_categoria', '¿Qué necesitas específicamente?', contexto.opciones, { segmento: contexto.segmento }, (contexto.pagina ?? 0) + 1)
    return
  }
  if (resultado.invalido) {
    await enviarBot(supabase, contacto, 'No entendí tu respuesta. Responde con el número de la lista.')
    return
  }

  const categoria = resultado.valor as string
  const servicios = await obtenerServiciosBot(supabase, contacto.empresa_id, contexto.segmento, categoria)
  if (!servicios.length) {
    await enviarBot(supabase, contacto, 'Por ahora no tenemos servicios cargados ahí. Un asesor te va a contactar para coordinar directamente.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
    return
  }

  await mostrarPaginaBot(supabase, contacto, 'elige_servicio', 'Elige el servicio:', servicios, { segmento: contexto.segmento, categoria })
}

// deno-lint-ignore no-explicit-any
async function manejarEligeServicioBot(supabase: any, contacto: any, texto: string) {
  const contexto = contacto.bot_contexto
  const resultado = resolverSeleccionBot(contexto, texto)

  if (resultado.siguientePagina) {
    await mostrarPaginaBot(
      supabase,
      contacto,
      'elige_servicio',
      'Elige el servicio:',
      contexto.opciones,
      { segmento: contexto.segmento, categoria: contexto.categoria },
      (contexto.pagina ?? 0) + 1
    )
    return
  }
  if (resultado.invalido) {
    await enviarBot(supabase, contacto, 'No entendí tu respuesta. Responde con el número de la lista.')
    return
  }

  const servicioId = resultado.valor as string
  // deno-lint-ignore no-explicit-any
  const servicioEtiqueta = contexto.opciones.find((op: any) => op.valor === servicioId)?.etiqueta ?? 'Servicio'

  const { data: tipoIslaId } = await supabase.rpc('catalogo_isla_para_servicio', { p_servicio_id: servicioId })
  if (!tipoIslaId) {
    await enviarBot(supabase, contacto, 'No pudimos ubicar ese servicio en nuestra agenda. Un asesor te va a contactar para coordinar directamente.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
    return
  }

  // Duración genérica (sin distinguir tipo de vehículo/combustible: el bot
  // todavía no pregunta la patente en esta primera versión) -si el
  // catálogo no tiene una hora de mano de obra ni siquiera genérica para
  // este servicio, se usa 60 min como resguardo, mejor sobreestimar que
  // ofrecer un horario que en la práctica queda corto-.
  const { data: horasMo } = await supabase.rpc('catalogo_horas_servicio', {
    p_servicio_id: servicioId,
    p_tipo_vehiculo: null,
    p_combustible: null,
  })
  const duracionMinutos = horasMo ? Math.round(Number(horasMo) * 60) : 60

  const { data: horarios } = await supabase.rpc('citas_buscar_horarios', {
    p_tipo_isla_id: tipoIslaId,
    p_duracion_minutos: duracionMinutos,
    p_limite: 5,
  })

  if (!horarios?.length) {
    await enviarBot(supabase, contacto, 'No encontramos horarios disponibles pronto para ese servicio. Un asesor te va a contactar para coordinar directamente.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
    return
  }

  // deno-lint-ignore no-explicit-any
  const opciones = horarios.map((horario: any) => ({
    etiqueta: `${formatoFechaCortaBot(horario.fecha)} a las ${String(horario.hora).slice(0, 5)}`,
    valor: { fecha: horario.fecha, hora: horario.hora, tipoIslaId, duracionMinutos, servicioId, servicioEtiqueta },
  }))

  await mostrarPaginaBot(supabase, contacto, 'elige_horario', `Encontramos estos horarios para "${servicioEtiqueta}":`, opciones, {})
}

async function confirmarReservaBot(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  contacto: any,
  fecha: string,
  hora: string,
  tipoIslaId: string,
  duracionMinutos: number,
  servicioId: string,
  servicioEtiqueta: string
) {
  let clienteId = contacto.cliente_id

  if (!clienteId) {
    const { data: nuevoCliente, error: errorCliente } = await supabase
      .from('clientes')
      .insert({
        empresa_id: contacto.empresa_id,
        tipo: 'persona',
        nombre: contacto.nombre_whatsapp || 'Cliente WhatsApp',
        telefono: contacto.wa_id,
      })
      .select('id')
      .single()

    if (errorCliente || !nuevoCliente) {
      console.error('whatsapp: error creando cliente desde el bot', errorCliente)
      await enviarBot(supabase, contacto, 'Tuvimos un problema agendando tu hora. Un asesor te va a contactar para coordinar directamente.')
      await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
      return
    }
    clienteId = nuevoCliente.id
    await supabase.from('whatsapp_contactos').update({ cliente_id: clienteId }).eq('id', contacto.id)
  }

  const { error: errorCita } = await supabase.from('citas').insert({
    empresa_id: contacto.empresa_id,
    tipo_isla_id: tipoIslaId,
    cliente_id: clienteId,
    vehiculo_id: contacto.vehiculo_id,
    catalogo_servicio_id: servicioId,
    fecha,
    hora,
    duracion_estimada_minutos: duracionMinutos,
    descripcion: servicioEtiqueta,
    origen: 'bot_whatsapp',
  })

  if (errorCita) {
    console.error('whatsapp: error agendando cita desde el bot', errorCita)
    await enviarBot(supabase, contacto, 'Tuvimos un problema agendando tu hora. Un asesor te va a contactar para coordinar directamente.')
    await actualizarBotEstado(supabase, contacto, null, null, { bot_pausado: true })
    return
  }

  await enviarBot(
    supabase,
    contacto,
    `¡Listo! Tu hora quedó agendada para el ${formatoFechaCortaBot(fecha)} a las ${hora.slice(0, 5)} — ${servicioEtiqueta}.\nCualquier cambio, escríbenos por acá.`
  )
  await actualizarBotEstado(supabase, contacto, null, null, { estado: 'agendado' })
}

// deno-lint-ignore no-explicit-any
async function manejarEligeHorarioBot(supabase: any, contacto: any, texto: string) {
  const resultado = resolverSeleccionBot(contacto.bot_contexto, texto)

  if (resultado.siguientePagina || resultado.invalido) {
    await enviarBot(supabase, contacto, 'No entendí tu respuesta. Responde con el número de una de las horas mostradas.')
    return
  }

  const { fecha, hora, tipoIslaId, duracionMinutos, servicioId, servicioEtiqueta } = resultado.valor
  await confirmarReservaBot(supabase, contacto, fecha, hora, tipoIslaId, duracionMinutos, servicioId, servicioEtiqueta)
}

// Punto de entrada del bot: se llama desde procesarMensajes por cada
// mensaje de texto entrante. "menu"/"reiniciar" en cualquier punto del
// flujo lo reinicia -único mecanismo de recuperación, dado que no hay
// interpretación de texto libre-.
// deno-lint-ignore no-explicit-any
async function manejarBot(supabase: any, contacto: any, mensaje: Record<string, any>) {
  if (!contacto || contacto.bot_pausado) return
  if (mensaje?.type !== 'text') return

  const texto = (mensaje?.text?.body ?? '').trim()
  if (!texto) return

  if (['menu', 'menú', 'reiniciar'].includes(texto.toLowerCase())) {
    await mostrarMenuPrincipalBot(supabase, contacto)
    return
  }

  switch (contacto.bot_estado) {
    case 'saludo':
      await manejarSaludoBot(supabase, contacto, texto)
      break
    case 'elige_segmento':
      await manejarEligeSegmentoBot(supabase, contacto, texto)
      break
    case 'elige_categoria':
      await manejarEligeCategoriaBot(supabase, contacto, texto)
      break
    case 'elige_servicio':
      await manejarEligeServicioBot(supabase, contacto, texto)
      break
    case 'elige_horario':
      await manejarEligeHorarioBot(supabase, contacto, texto)
      break
    default:
      await mostrarMenuPrincipalBot(supabase, contacto)
  }
}
