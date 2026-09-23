// clickup-sincronizar
//
// Empuja el estado actual de un trabajo (OT) hacia ClickUp: crea la tarjeta
// si no existe, sube las tareas de mano de obra pendientes como subtareas,
// y los ítems de repuestos/lubricantes e insumos/servicios externos
// pendientes como checklist (spec §7). Se llama después de cargar tareas u
// ot_detalle nuevas desde el frontend -no hay sincronización automática por
// trigger todavía, ver CHANGELOG-.
//
// No es transaccional entre ítems a propósito: si un ítem falla, se
// registra en integraciones_clickup_errores y se sigue con el resto, para
// que un solo repuesto mal cargado no bloquee subir el resto de la tarea.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { respuestaJson, respuestaPreflight } from '../_shared/cors.ts'
import {
  CAMPOS_PERSONALIZADOS,
  ESTADO_TARJETA_CON_CITA,
  ESTADO_TARJETA_SIN_CITA,
  NOMBRE_CHECKLIST_POR_AREA,
  OPCIONES_TIPO_SERVICIO,
  crearChecklist,
  crearItemChecklist,
  crearTarea,
  encontrarPorCorreo,
  fijarCampoPersonalizado,
  obtenerMiembrosEquipo,
  obtenerTarea,
  type MiembroClickUp,
} from '../_shared/clickup.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    const { trabajo_id: trabajoId } = await req.json()
    if (!trabajoId) {
      return respuestaJson({ error: { mensaje: 'Falta trabajo_id.' } }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: trabajoCrudo, error: errorTrabajo } = await supabase
      .from('trabajos_taller')
      .select(
        'id, empresa_id, numero_ot, categoria_servicio, kilometraje_ingreso, clickup_task_id, cita_id, clientes(nombre, apellido, razon_social, telefono), vehiculos(patente, marca, modelo, kilometraje), inspecciones_ingreso(observaciones)'
      )
      .eq('id', trabajoId)
      .maybeSingle()

    if (errorTrabajo || !trabajoCrudo) {
      return respuestaJson({ error: { mensaje: errorTrabajo?.message || 'Trabajo no encontrado.' } }, 404)
    }

    // El tipo que infiere supabase-js para un select con joins, sin un tipo
    // Database generado, es demasiado genérico para ser útil -se declara la
    // forma real a mano en vez de pelear con el inferido-.
    interface TrabajoConRelaciones {
      id: string
      empresa_id: string
      numero_ot: number
      categoria_servicio: string | null
      kilometraje_ingreso: number | null
      clickup_task_id: string | null
      cita_id: string | null
      clientes: { nombre: string; apellido: string | null; razon_social: string | null; telefono: string | null } | { nombre: string; apellido: string | null; razon_social: string | null; telefono: string | null }[] | null
      vehiculos: { patente: string; marca: string; modelo: string; kilometraje: number | null } | { patente: string; marca: string; modelo: string; kilometraje: number | null }[] | null
      inspecciones_ingreso: { observaciones: string | null } | { observaciones: string | null }[] | null
    }
    const trabajo = trabajoCrudo as unknown as TrabajoConRelaciones

    const { data: config, error: errorConfig } = await supabase
      .from('clickup_config')
      .select('lista_trabajos_id')
      .eq('empresa_id', trabajo.empresa_id)
      .maybeSingle()

    if (errorConfig || !config) {
      return respuestaJson({ error: { mensaje: 'Esta empresa no tiene configurada una lista de ClickUp.' } }, 422)
    }

    const errores: { operacion: string; mensaje: string }[] = []
    async function registrarError(operacion: string, error: unknown) {
      const mensaje = error instanceof Error ? error.message : String(error)
      errores.push({ operacion, mensaje })
      await supabase.from('integraciones_clickup_errores').insert({
        empresa_id: trabajo.empresa_id,
        trabajo_id: trabajoId,
        operacion,
        mensaje,
        detalle: error instanceof Error ? { stack: error.stack } : null,
      })
    }

    const cliente = Array.isArray(trabajo.clientes) ? trabajo.clientes[0] : trabajo.clientes
    const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos
    const inspeccion = Array.isArray(trabajo.inspecciones_ingreso)
      ? trabajo.inspecciones_ingreso[0]
      : trabajo.inspecciones_ingreso

    const nombreCliente = cliente?.razon_social || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ')
    const nombreTarjeta = `${vehiculo?.patente ?? ''} ${vehiculo?.marca ?? ''} ${vehiculo?.modelo ?? ''} · OT ${trabajo.numero_ot}`.trim()

    // 1. Crear la tarjeta si todavía no existe.
    let clickupTaskId = trabajo.clickup_task_id as string | null
    if (!clickupTaskId) {
      try {
        const estadoInicial = trabajo.cita_id ? ESTADO_TARJETA_CON_CITA : ESTADO_TARJETA_SIN_CITA
        const tarea = (await crearTarea(config.lista_trabajos_id, {
          name: nombreTarjeta,
          status: estadoInicial,
        })) as { id: string }
        clickupTaskId = tarea.id
        await supabase.from('trabajos_taller').update({ clickup_task_id: clickupTaskId }).eq('id', trabajoId)
      } catch (error) {
        await registrarError('crear_tarjeta', error)
        return respuestaJson({ error: { mensaje: 'No se pudo crear la tarjeta en ClickUp.' }, errores }, 502)
      }

      // Campos personalizados: solo al crear (si cambian después, se
      // actualizan aquí mismo en una próxima sincronización si hace falta).
      const camposAFijar: [string, unknown][] = [
        [CAMPOS_PERSONALIZADOS.numeroOt, String(trabajo.numero_ot)],
        [CAMPOS_PERSONALIZADOS.patente, vehiculo?.patente ?? ''],
        [CAMPOS_PERSONALIZADOS.datosCliente, `${nombreCliente} · ${cliente?.telefono ?? 'sin teléfono'}`],
      ]
      // Preferir el kilometraje capturado en ESTE ingreso; si no se
      // registró (queda vacío en el formulario), usar el último conocido
      // del vehículo en vez de dejar el campo sin nada en ClickUp.
      const kilometrajeAReportar = trabajo.kilometraje_ingreso ?? vehiculo?.kilometraje ?? null
      if (kilometrajeAReportar != null) {
        camposAFijar.push([CAMPOS_PERSONALIZADOS.kilometraje, kilometrajeAReportar])
      }
      if (inspeccion?.observaciones) {
        camposAFijar.push([CAMPOS_PERSONALIZADOS.observaciones, inspeccion.observaciones])
      }
      if (trabajo.categoria_servicio && OPCIONES_TIPO_SERVICIO[trabajo.categoria_servicio]) {
        camposAFijar.push([CAMPOS_PERSONALIZADOS.tipoServicio, [OPCIONES_TIPO_SERVICIO[trabajo.categoria_servicio]]])
      }

      for (const [campoId, valor] of camposAFijar) {
        try {
          await fijarCampoPersonalizado(clickupTaskId, campoId, valor)
        } catch (error) {
          await registrarError(`campo_personalizado:${campoId}`, error)
        }
      }
    }

    // 2. Miembros del equipo, para cruzar el asignado por correo (spec §7).
    let miembros: MiembroClickUp[] = []
    try {
      miembros = await obtenerMiembrosEquipo()
    } catch (error) {
      await registrarError('obtener_miembros_equipo', error)
    }

    // 3. Mano de obra pendiente -> subtareas.
    const { data: tareasPendientes } = await supabase
      .from('tareas_taller')
      .select('id, descripcion, tecnico_id, usuarios(correo)')
      .eq('trabajo_id', trabajoId)
      .is('clickup_task_id', null)

    let tareasSincronizadas = 0
    for (const tarea of tareasPendientes ?? []) {
      try {
        const usuarioTecnico = Array.isArray(tarea.usuarios) ? tarea.usuarios[0] : tarea.usuarios
        const miembro = encontrarPorCorreo(miembros, usuarioTecnico?.correo ?? null)
        const nuevaSubtarea = (await crearTarea(config.lista_trabajos_id, {
          name: tarea.descripcion,
          parent: clickupTaskId,
          assignees: miembro ? [miembro.id] : [],
        })) as { id: string; status?: { status?: string } }

        // clickup_asignado_nombre no se toca acá: en este sentido (CRM ->
        // ClickUp) el técnico ya se conoce por tecnico_id. Ese campo es
        // para el sentido contrario, cuando ClickUp trae un asignado que no
        // cruza con ningún usuario (ver clickup-webhook).
        await supabase
          .from('tareas_taller')
          .update({
            clickup_task_id: nuevaSubtarea.id,
            estado: nuevaSubtarea.status?.status ?? 'agenda',
          })
          .eq('id', tarea.id)
        tareasSincronizadas++
      } catch (error) {
        await registrarError(`tarea_taller:${tarea.id}`, error)
      }
    }

    // 4. Repuestos / Lubricantes e insumos / Servicios externos -> checklist.
    let itemsSincronizados = 0
    for (const area of ['repuestos', 'lubricantes_insumos', 'servicios_externos'] as const) {
      const { data: itemsPendientes } = await supabase
        .from('ot_detalle')
        .select('id, detalle, responsable_id, usuarios(correo)')
        .eq('trabajo_id', trabajoId)
        .eq('area', area)
        .is('clickup_checklist_item_id', null)

      if (!itemsPendientes || itemsPendientes.length === 0) continue

      try {
        const tareaClickUp = (await obtenerTarea(clickupTaskId!)) as {
          checklists: { id: string; name: string }[]
        }
        let checklist = tareaClickUp.checklists.find((c) => c.name === NOMBRE_CHECKLIST_POR_AREA[area])
        if (!checklist) {
          // Igual que crearItemChecklist: POST /task/{id}/checklist también
          // devuelve { checklist: {...} }, no el checklist suelto en la raíz.
          const respuestaCrearChecklist = (await crearChecklist(clickupTaskId!, NOMBRE_CHECKLIST_POR_AREA[area])) as {
            checklist: { id: string; name: string }
          }
          checklist = respuestaCrearChecklist.checklist
        }

        for (const item of itemsPendientes) {
          try {
            const usuarioResponsable = Array.isArray(item.usuarios) ? item.usuarios[0] : item.usuarios
            const miembro = encontrarPorCorreo(miembros, usuarioResponsable?.correo ?? null)
            // POST /checklist/{id}/checklist_item devuelve el CHECKLIST
            // completo (con todos sus items), no el item recién creado
            // suelto -no hay `id` en la raíz de la respuesta-. Hay que
            // buscarlo por nombre dentro de checklist.items; se toma el
            // último match porque, si el nombre se repite, el que acabamos
            // de crear es el más reciente.
            const respuestaCrear = (await crearItemChecklist(checklist.id, item.detalle, miembro?.id ?? null)) as {
              checklist: { items: { id: string; name: string }[] }
            }
            const itemCreado = [...(respuestaCrear.checklist?.items ?? [])]
              .reverse()
              .find((i) => i.name === item.detalle)
            if (!itemCreado) {
              throw new Error('ClickUp no devolvió el ítem recién creado en la respuesta del checklist.')
            }
            await supabase.from('ot_detalle').update({ clickup_checklist_item_id: itemCreado.id }).eq('id', item.id)
            itemsSincronizados++
          } catch (error) {
            await registrarError(`ot_detalle:${item.id}`, error)
          }
        }
      } catch (error) {
        await registrarError(`checklist:${area}`, error)
      }
    }

    return respuestaJson({
      data: {
        clickup_task_id: clickupTaskId,
        tareas_sincronizadas: tareasSincronizadas,
        items_sincronizados: itemsSincronizados,
        errores,
      },
    })
  } catch (error) {
    return respuestaJson(
      { error: { mensaje: error instanceof Error ? error.message : 'Error inesperado.' } },
      500
    )
  }
})
