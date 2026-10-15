// clickup-tarea
//
// Acciones sobre UNA tarea de mano de obra (tareas_taller), llamadas tanto
// desde el detalle de la tarjeta en el Kanban como desde la pestaña Mano de
// obra de Trabajos. Tres acciones:
//   - asignar:     pone/cambia el técnico a cargo. Solo admin/socia/jefe de
//                  taller (es una decisión de quién hace qué, no del propio
//                  técnico). Empuja el cambio de asignado a ClickUp y avisa
//                  al técnico con una notificación (tipo tarea_asignada).
//   - completar:   marca la tarea como ejecutada. La puede hacer admin/socia/
//                  jefe de taller (cualquier tarea) o el propio técnico
//                  asignado (solo la suya). Mueve la subtarea en ClickUp a un
//                  estado de tipo "hecho"/"cerrado" de la lista de la
//                  empresa, y resuelve la notificación de asignación.
//   - observacion: guarda la observación del técnico. Mismos permisos que
//                  completar. Se guarda en tareas_taller Y en el campo
//                  personalizado "Observaciones" de la subtarea en ClickUp
//                  -el mismo campo que ya se lee en sentido ClickUp -> CRM,
//                  ver clickup-webhook-.
//
// Quién llama se identifica con su sesión; todo se acota a su empresa.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import { ErrorClickUp, actualizarTarea, encontrarPorCorreo, fijarCampoPersonalizado, obtenerMiembrosEquipo, obtenerTarea, resolverCampos } from '../_shared/clickup.ts'

const ROLES_QUE_ASIGNAN = ['admin', 'socia', 'jefe_taller']
const ROLES_QUE_EJECUTAN_CUALQUIERA = ['admin', 'socia', 'jefe_taller']
const TIPOS_TERMINALES = ['done', 'closed']

interface TareaRemota {
  assignees?: { id: number; email: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const autorizacion = req.headers.get('Authorization')
    if (!autorizacion) return respuestaJson({ error: { mensaje: 'Falta la sesión.' } }, 401)

    const cuerpo = (await req.json()) as {
      accion?: string
      tarea_taller_id?: string
      tecnico_id?: string
      observacion?: string
    }
    if (!cuerpo.tarea_taller_id) return respuestaJson({ error: { mensaje: 'Falta tarea_taller_id.' } }, 400)

    const clienteUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: autorizacion } },
    })
    const { data: datosAuth } = await clienteUsuario.auth.getUser()
    if (!datosAuth.user) return respuestaJson({ error: { mensaje: 'Sesión inválida.' } }, 401)

    const { data: perfil } = await clienteUsuario.from('usuarios').select('id, empresa_id, rol, activo').eq('id', datosAuth.user.id).maybeSingle()
    if (!perfil?.activo) return respuestaJson({ error: { mensaje: 'Cuenta inactiva.' } }, 403)
    const empresaId = perfil.empresa_id as string

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: tarea } = await admin
      .from('tareas_taller')
      .select('id, descripcion, tecnico_id, clickup_task_id, trabajo_id, observaciones_tecnico, trabajos_taller!inner(id, empresa_id, numero_ot, estado, vehiculos(patente))')
      .eq('id', cuerpo.tarea_taller_id)
      .eq('trabajos_taller.empresa_id', empresaId)
      .maybeSingle()
    if (!tarea) return respuestaJson({ error: { mensaje: 'Tarea no encontrada.' } }, 404)

    const trabajo = Array.isArray(tarea.trabajos_taller) ? tarea.trabajos_taller[0] : tarea.trabajos_taller
    if (['entregado', 'anulado'].includes(trabajo.estado)) {
      return respuestaJson({ error: { mensaje: 'La OT está cerrada: no se puede modificar esta tarea.' } }, 422)
    }

    async function registrarError(operacion: string, error: unknown) {
      await admin.from('integraciones_clickup_errores').insert({
        empresa_id: empresaId,
        trabajo_id: trabajo.id,
        operacion,
        mensaje: error instanceof Error ? error.message : String(error),
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }

    const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos
    const tituloOt = `${vehiculo?.patente ?? ''} · OT ${trabajo.numero_ot}`.trim()

    if (cuerpo.accion === 'asignar') {
      if (!ROLES_QUE_ASIGNAN.includes(perfil.rol)) {
        return respuestaJson({ error: { mensaje: 'Solo admin, socia o jefe de taller pueden asignar técnico.' } }, 403)
      }
      if (!cuerpo.tecnico_id) return respuestaJson({ error: { mensaje: 'Falta tecnico_id.' } }, 400)

      const { data: tecnico } = await admin
        .from('usuarios')
        .select('id, nombre_completo, correo, activo')
        .eq('id', cuerpo.tecnico_id)
        .eq('empresa_id', empresaId)
        .maybeSingle()
      if (!tecnico?.activo) return respuestaJson({ error: { mensaje: 'Técnico no encontrado o inactivo.' } }, 404)

      const { error: errorUpdate } = await admin
        .from('tareas_taller')
        .update({ tecnico_id: tecnico.id, clickup_asignado_nombre: null })
        .eq('id', tarea.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      if (tarea.clickup_task_id) {
        try {
          const [miembros, remota] = await Promise.all([
            obtenerMiembrosEquipo(),
            obtenerTarea(tarea.clickup_task_id as string) as Promise<TareaRemota>,
          ])
          const miembroNuevo = encontrarPorCorreo(miembros, tecnico.correo)
          const actualesIds = (remota.assignees ?? []).map((a) => a.id)
          const add = miembroNuevo && !actualesIds.includes(miembroNuevo.id) ? [miembroNuevo.id] : []
          const rem = miembroNuevo ? actualesIds.filter((id) => id !== miembroNuevo.id) : []
          if (add.length > 0 || rem.length > 0) {
            await actualizarTarea(tarea.clickup_task_id as string, { assignees: { add, rem } })
          }
        } catch (error) {
          await registrarError('asignar_tecnico_clickup', error)
          // No se corta el flujo: el CRM ya quedó asignado, ClickUp se reintenta a mano si hace falta.
        }
      }

      // Se borra cualquier aviso pendiente de una asignación anterior de esta misma tarea.
      await admin.from('notificaciones').delete().eq('tarea_taller_id', tarea.id).eq('tipo', 'tarea_asignada')
      await admin.from('notificaciones').insert({
        empresa_id: empresaId,
        tipo: 'tarea_asignada',
        trabajo_id: trabajo.id,
        tarea_taller_id: tarea.id,
        usuario_destino_id: tecnico.id,
        titulo: 'Nueva tarea asignada',
        mensaje: `${tarea.descripcion} · ${tituloOt}`,
      })

      return respuestaJson({ data: { tecnico_id: tecnico.id, nombre: tecnico.nombre_completo } })
    }

    const puedeEjecutar = ROLES_QUE_EJECUTAN_CUALQUIERA.includes(perfil.rol) || tarea.tecnico_id === perfil.id
    if (!puedeEjecutar) {
      return respuestaJson({ error: { mensaje: 'Solo el técnico asignado (o admin/socia/jefe de taller) puede hacer esto.' } }, 403)
    }

    if (cuerpo.accion === 'completar') {
      // Sin observación no se puede terminar la tarea (regla del cliente,
      // 2026-09-28): se valida acá también, no solo en el formulario -el
      // frontend siempre guarda la observación primero, con la acción
      // "observacion" (esa sí la empuja a ClickUp), y recién después llama a
      // "completar"-, para que no se pueda saltar llamando a la función directo.
      if (!(tarea.observaciones_tecnico ?? '').trim()) {
        return respuestaJson({ error: { mensaje: 'Escribe una observación antes de marcar la tarea como ejecutada.' } }, 422)
      }

      let nombreEstado: string | null = null
      if (tarea.clickup_task_id) {
        const { data: estados } = await admin
          .from('clickup_estados')
          .select('nombre, tipo, orden')
          .eq('empresa_id', empresaId)
          .in('tipo', TIPOS_TERMINALES)
          .order('orden')
        nombreEstado = estados?.[0]?.nombre ?? null
        if (!nombreEstado) {
          return respuestaJson({ error: { mensaje: 'No hay un estado de tipo "hecho" en la lista de ClickUp de esta empresa. Sincroniza los estados desde el Kanban primero.' } }, 422)
        }
        try {
          await actualizarTarea(tarea.clickup_task_id as string, { status: nombreEstado })
        } catch (error) {
          await registrarError('completar_tarea_clickup', error)
          const mensaje = error instanceof ErrorClickUp ? `ClickUp rechazó el cambio: ${error.message}` : 'No se pudo marcar la tarea en ClickUp.'
          return respuestaJson({ error: { mensaje } }, 502)
        }
      }

      const { error: errorUpdate } = await admin
        .from('tareas_taller')
        .update({ completada: true, ...(nombreEstado ? { estado: nombreEstado } : {}) })
        .eq('id', tarea.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      await admin.from('notificaciones').delete().eq('tarea_taller_id', tarea.id).eq('tipo', 'tarea_asignada')

      return respuestaJson({ data: { estado: nombreEstado, completada: true } })
    }

    if (cuerpo.accion === 'observacion') {
      const texto = (cuerpo.observacion ?? '').trim().slice(0, 2000) || null

      const { error: errorUpdate } = await admin.from('tareas_taller').update({ observaciones_tecnico: texto }).eq('id', tarea.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      if (tarea.clickup_task_id) {
        try {
          const { data: config } = await admin.from('clickup_config').select('campos').eq('empresa_id', empresaId).maybeSingle()
          const campos = resolverCampos(config?.campos)
          await fijarCampoPersonalizado(tarea.clickup_task_id as string, campos.ids.observaciones, texto ?? '')
        } catch (error) {
          await registrarError('guardar_observacion_clickup', error)
          // El CRM ya quedó guardado; ClickUp se reintenta a mano si hace falta.
        }
      }

      return respuestaJson({ data: { observacion: texto } })
    }

    return respuestaJson({ error: { mensaje: 'Acción desconocida.' } }, 400)
  } catch (error) {
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : String(error) } }, 500)
  }
})
