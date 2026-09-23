// clickup-webhook
//
// Recibe los eventos que ClickUp manda cuando algo cambia en la lista de
// trabajos: nueva subtarea (el jefe de taller la crea directamente en
// ClickUp), cambio de estado, de asignado, o de un ítem de checklist.
//
// No se intenta leer el diff exacto que manda el payload del webhook -la
// granularidad de eventos de ClickUp para checklists no está garantizada-;
// en vez de eso, ante cualquier evento se vuelve a pedir la tarea completa
// a la API y se reconcilia contra lo que hay en la base. Cuesta una llamada
// extra por evento, pero es mucho más simple y confiable que tratar de
// interpretar cada tipo de evento por separado, y el volumen de Didial
// (~5 vehículos/día) lo hace irrelevante en costo.
//
// Verificación de firma: ClickUp firma cada webhook con HMAC-SHA256 sobre
// el cuerpo crudo, usando el secreto que entrega al crear la suscripción
// (guardado como CLICKUP_WEBHOOK_SECRET). Sin esto, cualquiera que
// adivinara la URL podría inyectar datos falsos en el taller.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { NOMBRE_CHECKLIST_POR_AREA, obtenerTarea } from '../_shared/clickup.ts'
import { enviarCorreo } from '../_shared/brevo.ts'

// Nombres de estado que el cliente confirmó el 2026-09-15 (ver CHANGELOG).
// Comparados siempre en minúsculas: la API de ClickUp normaliza el status
// a minúsculas al devolverlo, aunque se haya creado con otra capitalización
// (así se creó "POR DESIGNAR" en clickup-sincronizar, por ejemplo).
const ESTADO_RETROCESO = 'retroceso'
const ESTADO_LISTO_PARA_ENTREGA = 'listo para entrega'
const ESTADO_COMPRA_REPTOS = 'compra reptos'

async function firmaValida(cuerpoCrudo: string, firmaRecibida: string | null): Promise<boolean> {
  const secreto = Deno.env.get('CLICKUP_WEBHOOK_SECRET')
  if (!secreto || !firmaRecibida) return false

  const claveCripto = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const firma = await crypto.subtle.sign('HMAC', claveCripto, new TextEncoder().encode(cuerpoCrudo))
  const firmaHex = Array.from(new Uint8Array(firma))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return firmaHex === firmaRecibida
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  const cuerpoCrudo = await req.text()

  if (!(await firmaValida(cuerpoCrudo, req.headers.get('X-Signature')))) {
    return respuestaJson({ error: { mensaje: 'Firma inválida.' } }, 401)
  }

  const payload = JSON.parse(cuerpoCrudo) as { task_id?: string }
  const taskId = payload.task_id
  if (!taskId) {
    // Eventos que no traen task_id (ej. de listas/carpetas) no aplican aquí.
    return respuestaJson({ data: { ignorado: true } })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  async function registrarError(empresaId: string | null, trabajoId: string | null, operacion: string, error: unknown) {
    const mensaje = error instanceof Error ? error.message : String(error)
    if (empresaId) {
      await supabase.from('integraciones_clickup_errores').insert({
        empresa_id: empresaId,
        trabajo_id: trabajoId,
        operacion,
        mensaje,
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }
  }

  try {
    // Caso 1: el evento es sobre una subtarea de mano de obra que ya conocemos.
    const { data: tareaExistente } = await supabase
      .from('tareas_taller')
      .select('id, trabajo_id, tecnico_id, trabajos_taller(empresa_id)')
      .eq('clickup_task_id', taskId)
      .maybeSingle()

    const tareaRemota = (await obtenerTarea(taskId)) as {
      name: string
      status?: { status?: string }
      assignees?: { id: number; email: string }[]
      parent: string | null
      checklists?: { id: string; name: string; items: { id: string; name: string; resolved: boolean; assignee?: { email: string } }[] }[]
    }

    // El asignado se cruza por correo contra nuestros propios usuarios, no
    // contra la lista de miembros de ClickUp: el correo ya viene en el
    // objeto assignee de la tarea, así que no hace falta la llamada extra a
    // obtenerMiembrosEquipo() (esa sirve solo para el sentido CRM -> ClickUp).
    const asignado = tareaRemota.assignees?.[0]
    const usuarioAsignado = asignado
      ? await supabase.from('usuarios').select('id').eq('correo', asignado.email).maybeSingle()
      : null

    if (tareaExistente) {
      const empresaId = (Array.isArray(tareaExistente.trabajos_taller)
        ? tareaExistente.trabajos_taller[0]
        : tareaExistente.trabajos_taller
      )?.empresa_id as string | undefined

      const { error: errorActualizar } = await supabase
        .from('tareas_taller')
        .update({
          descripcion: tareaRemota.name,
          estado: tareaRemota.status?.status ?? 'agenda',
          tecnico_id: usuarioAsignado?.data?.id ?? null,
          clickup_asignado_nombre: usuarioAsignado?.data ? null : asignado?.email ?? null,
        })
        .eq('id', tareaExistente.id)

      if (errorActualizar) {
        await registrarError(empresaId ?? null, tareaExistente.trabajo_id, 'actualizar_tarea_taller', errorActualizar)
        return respuestaJson({ error: { mensaje: errorActualizar.message } }, 500)
      }

      return respuestaJson({ data: { actualizada: 'tarea_taller', id: tareaExistente.id } })
    }

    // Caso 2: es la tarjeta (OT) misma -> reconciliar sus checklists, y
    // reaccionar a los estados que el cliente detalló el 2026-09-15.
    const { data: trabajo } = await supabase
      .from('trabajos_taller')
      .select(
        'id, empresa_id, numero_ot, vehiculo_id, trabajo_original_id, asesor_id, clickup_estado_actual, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)'
      )
      .eq('clickup_task_id', taskId)
      .maybeSingle()

    if (trabajo) {
      await reconciliarChecklists(supabase, trabajo.id, tareaRemota.checklists ?? [])

      const estadoClickUp = (tareaRemota.status?.status ?? '').toLowerCase()

      // RETROCESO = "retrabajo" (confirmado por el cliente 2026-09-15):
      // vincular a la OT original del mismo vehículo -la más reciente ya
      // entregada- si todavía no tiene una. Si no hay ninguna OT entregada
      // anterior para ese vehículo, queda registrado como aviso en vez de
      // fallar: puede que el retroceso sea de una OT que el CRM no
      // administra, o que haga falta vincularlo a mano.
      if (estadoClickUp === ESTADO_RETROCESO && !trabajo.trabajo_original_id && trabajo.vehiculo_id) {
        const { data: original } = await supabase
          .from('trabajos_taller')
          .select('id')
          .eq('vehiculo_id', trabajo.vehiculo_id)
          .eq('estado', 'entregado')
          .neq('id', trabajo.id)
          .order('fecha_entrega', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (original) {
          await supabase.from('trabajos_taller').update({ trabajo_original_id: original.id }).eq('id', trabajo.id)
        } else {
          await registrarError(
            trabajo.empresa_id,
            trabajo.id,
            'retroceso_sin_ot_original',
            new Error(
              'ClickUp marcó esta tarjeta como RETROCESO pero no se encontró una OT entregada anterior para el mismo vehículo. Revisar y vincular a mano si corresponde.'
            )
          )
        }
      }

      // "Listo para entrega": aviso activo al asesor por correo, solo en la
      // TRANSICIÓN -se compara contra el último estado guardado para no
      // reenviar en cada evento mientras la tarjeta sigue en este estado-.
      if (estadoClickUp === ESTADO_LISTO_PARA_ENTREGA && trabajo.clickup_estado_actual !== ESTADO_LISTO_PARA_ENTREGA) {
        await avisarListoParaEntrega(supabase, trabajo, registrarError)
        await crearNotificacionListoParaEntrega(supabase, trabajo, registrarError)
      }

      // "Compra reptos": mismo criterio de transición que "listo para
      // entrega", pero para jefe_taller/encargado_presupuestos (bodega). Se
      // resuelve sola si la tarjeta avanza a cualquier otro estado.
      if (estadoClickUp === ESTADO_COMPRA_REPTOS && trabajo.clickup_estado_actual !== ESTADO_COMPRA_REPTOS) {
        await crearNotificacionCompraReptos(supabase, trabajo, registrarError)
      } else if (estadoClickUp !== ESTADO_COMPRA_REPTOS && trabajo.clickup_estado_actual === ESTADO_COMPRA_REPTOS) {
        await supabase.from('notificaciones').delete().eq('trabajo_id', trabajo.id).eq('tipo', 'compra_reptos_pendiente')
      }

      if (estadoClickUp && estadoClickUp !== trabajo.clickup_estado_actual) {
        await supabase.from('trabajos_taller').update({ clickup_estado_actual: estadoClickUp }).eq('id', trabajo.id)
      }

      return respuestaJson({ data: { reconciliado: 'trabajos_taller', id: trabajo.id } })
    }

    // Caso 3: subtarea nueva, creada directamente en ClickUp por el jefe de
    // taller (spec §7: "el jefe crea trabajo directamente en ClickUp y eso
    // debe llegar al CRM"). Se importa si su padre es una OT conocida.
    if (tareaRemota.parent) {
      const { data: trabajoPadre } = await supabase
        .from('trabajos_taller')
        .select('id, empresa_id')
        .eq('clickup_task_id', tareaRemota.parent)
        .maybeSingle()

      if (trabajoPadre) {
        const { data: nuevaTarea, error: errorInsercion } = await supabase
          .from('tareas_taller')
          .insert({
            trabajo_id: trabajoPadre.id,
            descripcion: tareaRemota.name,
            estado: tareaRemota.status?.status ?? 'agenda',
            clickup_task_id: taskId,
            tecnico_id: usuarioAsignado?.data?.id ?? null,
            clickup_asignado_nombre: usuarioAsignado?.data ? null : asignado?.email ?? null,
          })
          .select('id')
          .single()

        if (errorInsercion) {
          await registrarError(trabajoPadre.empresa_id, trabajoPadre.id, 'importar_tarea_nueva', errorInsercion)
          return respuestaJson({ error: { mensaje: errorInsercion.message } }, 500)
        }

        return respuestaJson({ data: { importada: 'tarea_taller', id: nuevaTarea.id } })
      }
    }

    // No pertenece a ninguna OT que administre este CRM: se ignora.
    return respuestaJson({ data: { ignorado: true } })
  } catch (error) {
    await registrarError(null, null, 'webhook_general', error)
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : 'Error inesperado.' } }, 500)
  }
})

// Aviso por correo al asesor cuando la tarjeta llega a "listo para
// entrega": sin esto, nada le avisa de forma activa que puede cobrar -el
// spec original pide justo eso: "informar en el sistema para que el
// asesor pueda tomar el trabajo realizado y realizar el cobro"-.
async function avisarListoParaEntrega(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  trabajo: {
    id: string
    empresa_id: string
    numero_ot: number
    asesor_id: string | null
    clientes: { nombre: string; apellido: string | null; razon_social: string | null } | { nombre: string; apellido: string | null; razon_social: string | null }[] | null
    vehiculos: { patente: string; marca: string; modelo: string } | { patente: string; marca: string; modelo: string }[] | null
  },
  registrarError: (empresaId: string | null, trabajoId: string | null, operacion: string, error: unknown) => Promise<void>
) {
  if (!trabajo.asesor_id) {
    await registrarError(
      trabajo.empresa_id,
      trabajo.id,
      'aviso_listo_entrega',
      new Error('La OT no tiene asesor asignado; no se pudo avisar por correo.')
    )
    return
  }

  const { data: asesor } = await supabase
    .from('usuarios')
    .select('correo, nombre_completo')
    .eq('id', trabajo.asesor_id)
    .maybeSingle()

  if (!asesor?.correo) {
    await registrarError(trabajo.empresa_id, trabajo.id, 'aviso_listo_entrega', new Error('No se encontró el correo del asesor asignado.'))
    return
  }

  const cliente = Array.isArray(trabajo.clientes) ? trabajo.clientes[0] : trabajo.clientes
  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos
  const nombreCliente = cliente?.razon_social || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ')

  try {
    await enviarCorreo({
      destinatarioEmail: asesor.correo,
      destinatarioNombre: asesor.nombre_completo,
      asunto: `Listo para entrega: OT ${trabajo.numero_ot}`,
      html: `<p>La OT <strong>${trabajo.numero_ot}</strong> (${vehiculo?.patente ?? ''} — ${vehiculo?.marca ?? ''} ${vehiculo?.modelo ?? ''}, cliente ${nombreCliente}) quedó marcada como <strong>LISTO PARA ENTREGA</strong> en ClickUp. Contacta al cliente y registra el cobro en el CRM.</p>`,
    })
  } catch (error) {
    await registrarError(trabajo.empresa_id, trabajo.id, 'aviso_listo_entrega', error)
  }
}

// Notificación en la app (además del correo) para el asesor ya asignado a
// la OT -mismo destinatario, mismo criterio de "solo en la transición".
async function crearNotificacionListoParaEntrega(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  trabajo: {
    id: string
    empresa_id: string
    numero_ot: number
    asesor_id: string | null
    vehiculos: { patente: string } | { patente: string }[] | null
  },
  registrarError: (empresaId: string | null, trabajoId: string | null, operacion: string, error: unknown) => Promise<void>
) {
  if (!trabajo.asesor_id) return // ya quedó registrado el error en avisarListoParaEntrega

  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos

  const { error } = await supabase.from('notificaciones').insert({
    empresa_id: trabajo.empresa_id,
    tipo: 'listo_para_entrega',
    trabajo_id: trabajo.id,
    usuario_destino_id: trabajo.asesor_id,
    titulo: 'Vehículo listo para entrega',
    mensaje: `${vehiculo?.patente ?? 'Vehículo'} · OT ${trabajo.numero_ot} quedó listo para entrega. Contacta al cliente y registra el cobro.`,
  })
  if (error) await registrarError(trabajo.empresa_id, trabajo.id, 'notificacion_listo_entrega', error)
}

// Aviso para jefe_taller/encargado_presupuestos cuando ClickUp marca que
// faltan repuestos por comprar -mismo grupo de acceso de /bodega-.
async function crearNotificacionCompraReptos(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  trabajo: {
    id: string
    empresa_id: string
    numero_ot: number
    vehiculos: { patente: string } | { patente: string }[] | null
  },
  registrarError: (empresaId: string | null, trabajoId: string | null, operacion: string, error: unknown) => Promise<void>
) {
  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos

  const { error } = await supabase.from('notificaciones').insert({
    empresa_id: trabajo.empresa_id,
    tipo: 'compra_reptos_pendiente',
    trabajo_id: trabajo.id,
    roles_destino: ['jefe_taller', 'encargado_presupuestos'],
    titulo: 'Repuestos pendientes de compra',
    mensaje: `${vehiculo?.patente ?? 'Vehículo'} · OT ${trabajo.numero_ot} quedó en "Compra reptos": faltan repuestos por comprar.`,
  })
  if (error) await registrarError(trabajo.empresa_id, trabajo.id, 'notificacion_compra_reptos', error)
}

// Compara los checklists que trae ClickUp contra ot_detalle: marca
// verificado/nombre en los ítems que ya conocemos, e importa los que se
// hayan agregado directamente en ClickUp.
async function reconciliarChecklists(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  trabajoId: string,
  checklists: { id: string; name: string; items: { id: string; name: string; resolved: boolean }[] }[]
) {
  // Antes tenía su propio mapeo hardcodeado con los nombres viejos
  // (REPUESTOS/LUBRICANTES E INSUMOS/SERVICIO EXTERNO) -se desincronizó en
  // silencio el 2026-09-15 cuando se corrigieron los nombres reales en
  // NOMBRE_CHECKLIST_POR_AREA (dirección CRM->ClickUp) sin tocar este
  // archivo-. Se invierte esa misma constante en vez de mantener una copia
  // aparte, para que no vuelva a pasar.
  const NOMBRE_A_AREA: Record<string, string> = Object.fromEntries(
    Object.entries(NOMBRE_CHECKLIST_POR_AREA).map(([area, nombre]) => [nombre, area])
  )

  for (const checklist of checklists) {
    const area = NOMBRE_A_AREA[checklist.name]
    if (!area) continue // checklist que no es de las tres áreas conocidas: se deja como está

    for (const item of checklist.items) {
      const { data: itemExistente } = await supabase
        .from('ot_detalle')
        .select('id')
        .eq('clickup_checklist_item_id', item.id)
        .maybeSingle()

      if (itemExistente) {
        await supabase
          .from('ot_detalle')
          .update({ detalle: item.name, verificado: item.resolved })
          .eq('id', itemExistente.id)
      } else {
        await supabase.from('ot_detalle').insert({
          trabajo_id: trabajoId,
          area,
          detalle: item.name,
          verificado: item.resolved,
          clickup_checklist_item_id: item.id,
        })
      }
    }
  }
}
