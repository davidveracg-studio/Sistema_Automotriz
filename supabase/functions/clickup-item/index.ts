// clickup-item
//
// Ítems de las listas de control de una OT (Repuestos, Lubricantes e
// insumos, Servicios externos -ot_detalle-), llamados desde el detalle de la
// tarjeta en el Kanban. Tres acciones:
//   - agregar: crea el ítem. Si el área es Repuestos o Lubricantes e insumos,
//              se asigna solo al coordinador de repuestos de la empresa
//              (clickup_config.responsable_repuestos_id, ver 0062) -Servicios
//              externos no lleva asignación automática, son terceros-.
//   - editar:  cambia el nombre y/o la cantidad del ítem.
//   - marcar:  marca/desmarca el ítem como verificado.
// Las tres empujan el cambio al checklist de ClickUp (se crea el checklist si
// todavía no existe en la tarjeta, igual que clickup-sincronizar).
//
// Solo admin, socia y jefe de taller -mismo nivel de acceso que el resto del
// Kanban-, acotado a su empresa.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import {
  NOMBRE_CHECKLIST_POR_AREA,
  actualizarItemChecklist,
  crearChecklist,
  crearItemChecklist,
  encontrarPorCorreo,
  obtenerMiembrosEquipo,
  obtenerTarea,
} from '../_shared/clickup.ts'

const ROLES_PERMITIDOS = ['admin', 'socia', 'jefe_taller']
const AREAS_VALIDAS = ['repuestos', 'lubricantes_insumos', 'servicios_externos']
const AREAS_CON_ASIGNACION_AUTOMATICA = ['repuestos', 'lubricantes_insumos']

interface TareaRemota {
  checklists?: { id: string; name: string; items?: { id: string; name: string }[] }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const autorizacion = req.headers.get('Authorization')
    if (!autorizacion) return respuestaJson({ error: { mensaje: 'Falta la sesión.' } }, 401)

    const cuerpo = (await req.json()) as {
      accion?: string
      trabajo_id?: string
      item_id?: string
      area?: string
      detalle?: string
      cantidad?: number
      verificado?: boolean
    }

    const clienteUsuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: autorizacion } },
    })
    const { data: datosAuth } = await clienteUsuario.auth.getUser()
    if (!datosAuth.user) return respuestaJson({ error: { mensaje: 'Sesión inválida.' } }, 401)

    const { data: perfil } = await clienteUsuario.from('usuarios').select('empresa_id, rol, activo').eq('id', datosAuth.user.id).maybeSingle()
    if (!perfil?.activo || !ROLES_PERMITIDOS.includes(perfil.rol)) {
      return respuestaJson({ error: { mensaje: 'Solo admin, socia o jefe de taller pueden editar las listas de control.' } }, 403)
    }
    const empresaId = perfil.empresa_id as string

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    async function registrarError(trabajoId: string | null, operacion: string, error: unknown) {
      await admin.from('integraciones_clickup_errores').insert({
        empresa_id: empresaId,
        trabajo_id: trabajoId,
        operacion,
        mensaje: error instanceof Error ? error.message : String(error),
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }

    // Busca el checklist del área en la tarjeta; lo crea si todavía no existe.
    async function obtenerOCrearChecklist(clickupTaskId: string, area: string) {
      const remota = (await obtenerTarea(clickupTaskId)) as TareaRemota
      const existente = remota.checklists?.find((c) => c.name === NOMBRE_CHECKLIST_POR_AREA[area])
      if (existente) return existente
      const respuesta = (await crearChecklist(clickupTaskId, NOMBRE_CHECKLIST_POR_AREA[area])) as { checklist: { id: string; name: string; items: [] } }
      return { ...respuesta.checklist, items: [] as { id: string; name: string }[] }
    }

    if (cuerpo.accion === 'agregar') {
      if (!cuerpo.trabajo_id || !cuerpo.area || !cuerpo.detalle?.trim()) {
        return respuestaJson({ error: { mensaje: 'Faltan trabajo_id, area y detalle.' } }, 400)
      }
      if (!AREAS_VALIDAS.includes(cuerpo.area)) return respuestaJson({ error: { mensaje: 'Área inválida.' } }, 400)

      const { data: trabajo } = await admin
        .from('trabajos_taller')
        .select('id, clickup_task_id, estado')
        .eq('id', cuerpo.trabajo_id)
        .eq('empresa_id', empresaId)
        .maybeSingle()
      if (!trabajo) return respuestaJson({ error: { mensaje: 'OT no encontrada.' } }, 404)
      if (['entregado', 'anulado'].includes(trabajo.estado)) {
        return respuestaJson({ error: { mensaje: 'La OT está cerrada: no se pueden agregar ítems.' } }, 422)
      }

      let responsableId: string | null = null
      if (AREAS_CON_ASIGNACION_AUTOMATICA.includes(cuerpo.area)) {
        const { data: config } = await admin.from('clickup_config').select('responsable_repuestos_id').eq('empresa_id', empresaId).maybeSingle()
        responsableId = config?.responsable_repuestos_id ?? null
      }

      const detalle = cuerpo.detalle.trim()
      const cantidad = Number(cuerpo.cantidad) > 0 ? Number(cuerpo.cantidad) : 1

      const { data: item, error: errorInsercion } = await admin
        .from('ot_detalle')
        .insert({ trabajo_id: trabajo.id, area: cuerpo.area, detalle, cantidad, responsable_id: responsableId })
        .select('id')
        .single()
      if (errorInsercion) return respuestaJson({ error: { mensaje: errorInsercion.message } }, 500)

      if (trabajo.clickup_task_id) {
        try {
          const checklist = await obtenerOCrearChecklist(trabajo.clickup_task_id as string, cuerpo.area)
          let asignadoId: number | null = null
          if (responsableId) {
            const { data: responsable } = await admin.from('usuarios').select('correo').eq('id', responsableId).maybeSingle()
            if (responsable?.correo) {
              const miembros = await obtenerMiembrosEquipo()
              asignadoId = encontrarPorCorreo(miembros, responsable.correo)?.id ?? null
            }
          }
          const respuestaCrear = (await crearItemChecklist(checklist.id, detalle, asignadoId)) as {
            checklist: { items: { id: string; name: string }[] }
          }
          const itemCreado = [...(respuestaCrear.checklist?.items ?? [])].reverse().find((i) => i.name === detalle)
          if (itemCreado) {
            await admin.from('ot_detalle').update({ clickup_checklist_item_id: itemCreado.id }).eq('id', item.id)
          }
        } catch (error) {
          await registrarError(trabajo.id, 'item_agregar_clickup', error)
          // El ítem ya quedó guardado en el CRM; ClickUp se reintenta a mano si hace falta (botón Sincronizar).
        }
      }

      return respuestaJson({ data: { id: item.id } })
    }

    if (!cuerpo.item_id) return respuestaJson({ error: { mensaje: 'Falta item_id.' } }, 400)

    const { data: item } = await admin
      .from('ot_detalle')
      .select('id, area, detalle, cantidad, verificado, clickup_checklist_item_id, trabajo_id, trabajos_taller!inner(id, empresa_id, clickup_task_id, estado)')
      .eq('id', cuerpo.item_id)
      .eq('trabajos_taller.empresa_id', empresaId)
      .maybeSingle()
    if (!item) return respuestaJson({ error: { mensaje: 'Ítem no encontrado.' } }, 404)
    const trabajo = Array.isArray(item.trabajos_taller) ? item.trabajos_taller[0] : item.trabajos_taller
    if (['entregado', 'anulado'].includes(trabajo.estado)) {
      return respuestaJson({ error: { mensaje: 'La OT está cerrada: no se puede modificar este ítem.' } }, 422)
    }

    // item/trabajo van como parámetro (no cerrados desde afuera): TypeScript
    // no arrastra el "ya se comprobó que no es null" de arriba hacia una
    // función anidada que se llama más abajo.
    async function empujarACheckItem(itemActual: NonNullable<typeof item>, trabajoActual: typeof trabajo, cambios: Record<string, unknown>) {
      if (!trabajoActual.clickup_task_id || !itemActual.clickup_checklist_item_id) return
      try {
        const checklist = await obtenerOCrearChecklist(trabajoActual.clickup_task_id as string, itemActual.area)
        await actualizarItemChecklist(checklist.id, itemActual.clickup_checklist_item_id as string, cambios)
      } catch (error) {
        await registrarError(trabajoActual.id, 'item_actualizar_clickup', error)
        // El CRM ya quedó guardado; ClickUp se reintenta a mano si hace falta.
      }
    }

    if (cuerpo.accion === 'editar') {
      if (!cuerpo.detalle?.trim()) return respuestaJson({ error: { mensaje: 'Falta detalle.' } }, 400)
      const detalle = cuerpo.detalle.trim()
      const cantidad = cuerpo.cantidad != null && Number(cuerpo.cantidad) > 0 ? Number(cuerpo.cantidad) : item.cantidad

      const { error: errorUpdate } = await admin.from('ot_detalle').update({ detalle, cantidad }).eq('id', item.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      await empujarACheckItem(item, trabajo, { name: detalle })
      return respuestaJson({ data: { detalle, cantidad } })
    }

    if (cuerpo.accion === 'marcar') {
      const verificado = Boolean(cuerpo.verificado)
      const { error: errorUpdate } = await admin.from('ot_detalle').update({ verificado }).eq('id', item.id)
      if (errorUpdate) return respuestaJson({ error: { mensaje: errorUpdate.message } }, 500)

      await empujarACheckItem(item, trabajo, { resolved: verificado })
      return respuestaJson({ data: { verificado } })
    }

    return respuestaJson({ error: { mensaje: 'Acción desconocida.' } }, 400)
  } catch (error) {
    return respuestaJson({ error: { mensaje: error instanceof Error ? error.message : String(error) } }, 500)
  }
})
