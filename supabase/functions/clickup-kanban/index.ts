// clickup-kanban
//
// Soporte del kanban del taller (Taller > Kanban). Tres acciones:
//   - estados:        trae de ClickUp los estados de la lista (nombre exacto, tipo,
//                     color, orden) y los deja en clickup_estados -esa tabla existía
//                     desde 0004 pero nadie la llenaba-. Son las columnas del kanban.
//   - cambiar_estado: mueve la tarjeta a otro estado EN CLICKUP (arrastrar una
//                     tarjeta). A propósito NO escribe clickup_estado_actual: eso lo
//                     hace clickup-webhook al recibir el evento de ClickUp, que
//                     compara contra el estado guardado para disparar los avisos de
//                     transición ("listo para entrega", "compra reptos"). Si esta
//                     función adelantara el estado, el webhook vería "sin cambio" y
//                     no avisaría a nadie.
//   - refrescar:      trae de ClickUp prioridad, fecha de vencimiento y estado de las
//                     subtareas de las OT pedidas (el webhook de hoy no escucha los
//                     eventos de prioridad ni de fecha). Tampoco toca
//                     clickup_estado_actual, por la misma razón.
//   - detalle:        para el detalle de una sola OT (al abrir la tarjeta en el
//                     Kanban): trae de ClickUp la descripción y la fecha de inicio
//                     de la tarjeta -lo único que no vive ya en la base; el resto
//                     del detalle (subtareas, checklists, campos) se arma en el
//                     frontend con lo que ya está sincronizado-. Una sola llamada
//                     por apertura, no por cada tarjeta del tablero.
//   - descripcion:    edita la descripción de la tarjeta (texto libre, no el campo
//                     personalizado "Observaciones"). Se empuja a ClickUp y se
//                     guarda en caché en trabajos_taller.clickup_descripcion.
//
// Quién llama se identifica con su sesión (no con un secreto): solo admin, socia y
// jefe de taller, y todo se acota a SU empresa. Las escrituras usan service role
// porque clickup_estados solo la escribe admin por RLS y esto lo necesita el jefe
// de taller también.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { ErrorClickUp, actualizarTarea, obtenerLista, obtenerTarea, obtenerTareaConSubtareas } from '../_shared/clickup.ts'

const ROLES_PERMITIDOS = ['admin', 'socia', 'jefe_taller']
const MAX_OT_POR_LLAMADA = 12
// La API de ClickUp tiene tope de ~100 llamadas por minuto: pausa entre OT.
const PAUSA_ENTRE_OT_MS = 700
const PRIORIDADES = new Set(['urgent', 'high', 'normal', 'low'])
const TIPOS_TERMINALES = new Set(['done', 'closed'])

interface EstadoLista {
  id: string
  status: string
  type?: string
  orderindex?: number
  color?: string
}

interface CampoPersonalizadoRemoto {
  name: string
  type?: string
  type_config?: { options?: { id: string; name?: string; label?: string; orderindex?: number }[] }
  value?: unknown
}

interface TareaRemota {
  id: string
  status?: { status?: string; type?: string }
  priority?: { priority?: string } | null
  due_date?: string | null
  due_date_time?: boolean | null
  start_date?: string | null
  text_content?: string
  description?: string
  subtasks?: { id: string; status?: { status?: string; type?: string } }[]
  custom_fields?: CampoPersonalizadoRemoto[]
}

// Campos personalizados de ClickUp que solo se MUESTRAN en el detalle (no se
// escriben desde el CRM): se buscan por NOMBRE en la respuesta de la propia
// tarea, no por id fijo -a diferencia de CAMPOS_PERSONALIZADOS en
// _shared/clickup.ts, que son los que el CRM sí escribe y por eso necesitan
// el id exacto configurado por empresa-. Resuelve dropdown/labels contra sus
// opciones; el resto lo muestra tal cual.
function valorCampoPersonalizado(campos: CampoPersonalizadoRemoto[] | undefined, nombre: string): string | null {
  const campo = campos?.find((c) => c.name === nombre)
  if (!campo || campo.value == null || campo.value === '') return null

  const opciones = campo.type_config?.options
  if ((campo.type === 'drop_down' || campo.type === 'labels') && opciones) {
    const ids = Array.isArray(campo.value) ? campo.value : [campo.value]
    const nombres = ids
      .map((id) => opciones.find((o) => o.id === id || String(o.orderindex) === String(id)))
      .map((o) => o?.name ?? o?.label)
      .filter(Boolean)
    return nombres.length > 0 ? nombres.join(', ') : null
  }

  return typeof campo.value === 'string' ? campo.value : JSON.stringify(campo.value)
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const autorizacion = req.headers.get('Authorization')
    if (!autorizacion) return respuestaJson({ error: { mensaje: 'Falta la sesión.' } }, 401)

    const cuerpo = (await req.json()) as {
      accion?: string
      trabajo_id?: string
      estado?: string
      trabajo_ids?: string[]
      descripcion?: string
    }

    const clienteUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: autorizacion } },
    })
    const { data: datosAuth } = await clienteUsuario.auth.getUser()
    if (!datosAuth.user) return respuestaJson({ error: { mensaje: 'Sesión inválida.' } }, 401)

    const { data: perfil } = await clienteUsuario
      .from('usuarios')
      .select('empresa_id, rol, activo')
      .eq('id', datosAuth.user.id)
      .maybeSingle()
    if (!perfil?.activo || !ROLES_PERMITIDOS.includes(perfil.rol)) {
      return respuestaJson({ error: { mensaje: 'Solo admin, socia o jefe de taller pueden usar el kanban.' } }, 403)
    }
    const empresaId = perfil.empresa_id as string

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: config } = await admin.from('clickup_config').select('lista_trabajos_id').eq('empresa_id', empresaId).maybeSingle()
    if (!config?.lista_trabajos_id) {
      return respuestaJson({ error: { mensaje: 'Esta empresa no tiene configurada una lista de ClickUp.' } }, 422)
    }
    const listaId = config.lista_trabajos_id as string

    async function registrarError(trabajoId: string | null, operacion: string, error: unknown) {
      await admin.from('integraciones_clickup_errores').insert({
        empresa_id: empresaId,
        trabajo_id: trabajoId,
        operacion,
        mensaje: error instanceof Error ? error.message : String(error),
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }

    // Trae los estados de la lista y deja clickup_estados igual a ClickUp.
    async function sincronizarEstados() {
      const lista = (await obtenerLista(listaId)) as { statuses?: EstadoLista[] }
      const estados = lista.statuses ?? []
      if (estados.length === 0) throw new Error('ClickUp no devolvió estados para la lista de esta empresa.')

      const filas = estados.map((e, i) => ({
        empresa_id: empresaId,
        clickup_status_id: e.id,
        nombre: e.status,
        orden: e.orderindex ?? i,
        tipo: e.type ?? null,
        color: e.color ?? null,
      }))
      const { error: errorUpsert } = await admin.from('clickup_estados').upsert(filas, { onConflict: 'empresa_id,clickup_status_id' })
      if (errorUpsert) throw errorUpsert

      // Los que ya no existen en ClickUp se quitan: el kanban no debe ofrecer columnas fantasma.
      const idsVigentes = estados.map((e) => e.id)
      await admin
        .from('clickup_estados')
        .delete()
        .eq('empresa_id', empresaId)
        .not('clickup_status_id', 'in', `(${idsVigentes.map((id) => `"${id}"`).join(',')})`)

      return filas
    }

    if (cuerpo.accion === 'estados') {
      const filas = await sincronizarEstados()
      return respuestaJson({ data: { estados: filas } })
    }

    if (cuerpo.accion === 'cambiar_estado') {
      if (!cuerpo.trabajo_id || !cuerpo.estado) {
        return respuestaJson({ error: { mensaje: 'Faltan trabajo_id y estado.' } }, 400)
      }

      const { data: trabajo } = await admin
        .from('trabajos_taller')
        .select('id, clickup_task_id, estado')
        .eq('id', cuerpo.trabajo_id)
        .eq('empresa_id', empresaId)
        .maybeSingle()
      if (!trabajo) return respuestaJson({ error: { mensaje: 'OT no encontrada.' } }, 404)
      if (!trabajo.clickup_task_id) {
        return respuestaJson({ error: { mensaje: 'Esta OT todavía no tiene tarjeta en ClickUp; sincronízala primero.' } }, 422)
      }
      if (['entregado', 'anulado'].includes(trabajo.estado)) {
        return respuestaJson({ error: { mensaje: 'La OT está cerrada: no se puede cambiar su estado.' } }, 422)
      }

      // El nombre se valida contra los estados reales de ClickUp (y se usa el
      // exacto de ClickUp, no lo que llegó): un nombre mal escrito da un error
      // claro acá en vez de un 400 críptico de la API.
      let { data: estados } = await admin.from('clickup_estados').select('nombre').eq('empresa_id', empresaId)
      if (!estados || estados.length === 0) {
        estados = (await sincronizarEstados()).map((e) => ({ nombre: e.nombre }))
      }
      const objetivo = cuerpo.estado.trim().toLowerCase()
      const estadoExacto = estados.find((e) => e.nombre.trim().toLowerCase() === objetivo)?.nombre
      if (!estadoExacto) {
        return respuestaJson({ error: { mensaje: `"${cuerpo.estado}" no es un estado de la lista de ClickUp.` } }, 422)
      }

      try {
        await actualizarTarea(trabajo.clickup_task_id as string, { status: estadoExacto })
      } catch (error) {
        await registrarError(trabajo.id, 'kanban_cambiar_estado', error)
        const mensaje = error instanceof ErrorClickUp ? `ClickUp rechazó el cambio: ${error.message}` : 'No se pudo cambiar el estado en ClickUp.'
        return respuestaJson({ error: { mensaje } }, 502)
      }
      return respuestaJson({ data: { estado: estadoExacto } })
    }

    if (cuerpo.accion === 'refrescar') {
      const ids = (cuerpo.trabajo_ids ?? []).slice(0, MAX_OT_POR_LLAMADA)
      if (ids.length === 0) return respuestaJson({ data: { actualizados: 0, errores: [] } })

      const { data: trabajos } = await admin
        .from('trabajos_taller')
        .select('id, clickup_task_id')
        .eq('empresa_id', empresaId)
        .in('id', ids)
        .not('clickup_task_id', 'is', null)
        .not('estado', 'in', '(entregado,anulado)')

      let actualizados = 0
      let limitado = false
      const errores: { trabajo_id: string; mensaje: string }[] = []

      for (const trabajo of trabajos ?? []) {
        try {
          const remota = (await obtenerTareaConSubtareas(trabajo.clickup_task_id as string)) as TareaRemota

          const prioridad = remota.priority?.priority
          const vencimiento = remota.due_date ? Number(remota.due_date) : null
          const { error: errorTrabajo } = await admin
            .from('trabajos_taller')
            .update({
              clickup_prioridad: prioridad && PRIORIDADES.has(prioridad) ? prioridad : null,
              clickup_fecha_programada: vencimiento ? new Date(vencimiento).toISOString() : null,
              clickup_fecha_con_hora: Boolean(vencimiento && remota.due_date_time),
              clickup_detalle_en: new Date().toISOString(),
            })
            .eq('id', trabajo.id)
          if (errorTrabajo) throw errorTrabajo

          for (const sub of remota.subtasks ?? []) {
            const { error: errorSub } = await admin
              .from('tareas_taller')
              .update({
                estado: sub.status?.status ?? 'agenda',
                completada: TIPOS_TERMINALES.has(sub.status?.type ?? ''),
              })
              .eq('trabajo_id', trabajo.id)
              .eq('clickup_task_id', sub.id)
            if (errorSub) throw errorSub
          }
          actualizados++
        } catch (error) {
          if (error instanceof ErrorClickUp && error.status === 429) {
            limitado = true
            break
          }
          await registrarError(trabajo.id, 'kanban_refrescar', error)
          errores.push({ trabajo_id: trabajo.id, mensaje: error instanceof Error ? error.message : String(error) })
        }
        await esperar(PAUSA_ENTRE_OT_MS)
      }

      return respuestaJson({ data: { actualizados, errores, limitado } })
    }

    if (cuerpo.accion === 'detalle') {
      if (!cuerpo.trabajo_id) return respuestaJson({ error: { mensaje: 'Falta trabajo_id.' } }, 400)

      const { data: trabajo } = await admin
        .from('trabajos_taller')
        .select('id, clickup_task_id')
        .eq('id', cuerpo.trabajo_id)
        .eq('empresa_id', empresaId)
        .maybeSingle()
      if (!trabajo) return respuestaJson({ error: { mensaje: 'OT no encontrada.' } }, 404)
      if (!trabajo.clickup_task_id) {
        return respuestaJson({ data: { descripcion: null, fecha_inicio: null, observaciones: null, segmento: null, sugerencias: null } })
      }

      let remota: TareaRemota
      try {
        remota = (await obtenerTarea(trabajo.clickup_task_id as string)) as TareaRemota
      } catch (error) {
        await registrarError(trabajo.id, 'kanban_detalle', error)
        return respuestaJson({ error: { mensaje: 'No se pudo traer el detalle desde ClickUp.' } }, 502)
      }

      const descripcion = (remota.text_content ?? remota.description ?? '').trim() || null
      const inicio = remota.start_date ? Number(remota.start_date) : null
      const fechaInicio = inicio ? new Date(inicio).toISOString() : null

      await admin
        .from('trabajos_taller')
        .update({ clickup_descripcion: descripcion, clickup_fecha_inicio: fechaInicio })
        .eq('id', trabajo.id)

      return respuestaJson({
        data: {
          descripcion,
          fecha_inicio: fechaInicio,
          observaciones: valorCampoPersonalizado(remota.custom_fields, 'Observaciones'),
          segmento: valorCampoPersonalizado(remota.custom_fields, 'Segmento'),
          sugerencias: valorCampoPersonalizado(remota.custom_fields, 'Sugerencias'),
        },
      })
    }

    if (cuerpo.accion === 'descripcion') {
      if (!cuerpo.trabajo_id) return respuestaJson({ error: { mensaje: 'Falta trabajo_id.' } }, 400)

      const { data: trabajo } = await admin
        .from('trabajos_taller')
        .select('id, clickup_task_id, estado')
        .eq('id', cuerpo.trabajo_id)
        .eq('empresa_id', empresaId)
        .maybeSingle()
      if (!trabajo) return respuestaJson({ error: { mensaje: 'OT no encontrada.' } }, 404)
      if (['entregado', 'anulado'].includes(trabajo.estado)) {
        return respuestaJson({ error: { mensaje: 'La OT está cerrada: no se puede editar la descripción.' } }, 422)
      }

      const texto = (cuerpo.descripcion ?? '').trim() || null

      if (trabajo.clickup_task_id) {
        try {
          await actualizarTarea(trabajo.clickup_task_id as string, { description: texto ?? '' })
        } catch (error) {
          await registrarError(trabajo.id, 'kanban_editar_descripcion', error)
          const mensaje = error instanceof ErrorClickUp ? `ClickUp rechazó el cambio: ${error.message}` : 'No se pudo actualizar la descripción en ClickUp.'
          return respuestaJson({ error: { mensaje } }, 502)
        }
      }

      const { error: errorUpdate } = await admin.from('trabajos_taller').update({ clickup_descripcion: texto }).eq('id', trabajo.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      return respuestaJson({ data: { descripcion: texto } })
    }

    return respuestaJson({ error: { mensaje: 'Acción desconocida.' } }, 400)
  } catch (error) {
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : String(error) } }, 500)
  }
})
