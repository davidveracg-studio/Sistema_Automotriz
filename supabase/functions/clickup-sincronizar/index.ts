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
  ESTADO_TARJETA_CON_CITA,
  ESTADO_TARJETA_SIN_CITA,
  NOMBRE_CHECKLIST_POR_AREA,
  actualizarTarea,
  crearChecklist,
  crearItemChecklist,
  crearTarea,
  encontrarPorCorreo,
  fijarCampoPersonalizado,
  obtenerMiembrosEquipo,
  obtenerTarea,
  resolverCampos,
  type MiembroClickUp,
} from '../_shared/clickup.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return respuestaPreflight()

  try {
    // forzar_estado: además de crear lo que falte, deja la tarjeta y sus subtareas
    // en el estado que ya tiene la OT en el CRM (lo usa la sincronización completa
    // de la demo, cuyos datos traen estados que ClickUp todavía no conoce).
    const { trabajo_id: trabajoId, forzar_estado: forzarEstado } = await req.json()
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
        'id, empresa_id, numero_ot, categoria_servicio, kilometraje_ingreso, clickup_task_id, clickup_estado_actual, cita_id, clientes(nombre, apellido, razon_social, telefono), vehiculos(patente, marca, modelo, kilometraje), inspecciones_ingreso(observaciones)'
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
      clickup_estado_actual: string | null
      cita_id: string | null
      clientes: { nombre: string; apellido: string | null; razon_social: string | null; telefono: string | null } | { nombre: string; apellido: string | null; razon_social: string | null; telefono: string | null }[] | null
      vehiculos: { patente: string; marca: string; modelo: string; kilometraje: number | null } | { patente: string; marca: string; modelo: string; kilometraje: number | null }[] | null
      inspecciones_ingreso: { observaciones: string | null } | { observaciones: string | null }[] | null
    }
    const trabajo = trabajoCrudo as unknown as TrabajoConRelaciones

    const { data: config, error: errorConfig } = await supabase
      .from('clickup_config')
      .select('lista_trabajos_id, campos')
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

    const campos = resolverCampos(config.campos)

    // 1. Crear la tarjeta si todavía no existe. Si la OT nace de una cita, esa
    // cita ya creó su tarjeta en el estado "agenda" al agendarse (ver
    // 0044_clickup_citas.sql): la OT la ADOPTA -le cambia el nombre al de la
    // OT y sigue sobre ella- en vez de crear una segunda.
    let clickupTaskId = trabajo.clickup_task_id as string | null
    let adoptada = false
    if (!clickupTaskId && trabajo.cita_id) {
      const { data: cita } = await supabase.from('citas').select('clickup_task_id').eq('id', trabajo.cita_id).maybeSingle()
      if (cita?.clickup_task_id) {
        try {
          await actualizarTarea(cita.clickup_task_id, { name: nombreTarjeta })
          const { error: errorVinculo } = await supabase
            .from('trabajos_taller')
            .update({ clickup_task_id: cita.clickup_task_id })
            .eq('id', trabajoId)
          if (errorVinculo) throw errorVinculo
          clickupTaskId = cita.clickup_task_id
          adoptada = true
        } catch (error) {
          await registrarError('adoptar_tarjeta_de_cita', error)
          return respuestaJson({ error: { mensaje: 'No se pudo tomar la tarjeta de la cita en ClickUp.' }, errores }, 502)
        }
      }
    }
    if (!clickupTaskId || adoptada || forzarEstado) {
      if (!adoptada && !clickupTaskId) {
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
      }

      // Campos personalizados: al crear la tarjeta y, con forzar_estado, también en
      // las que ya existen (sirve cuando los campos se crearon en ClickUp después).
      const camposAFijar: [string, unknown][] = [
        [campos.ids.numeroOt, String(trabajo.numero_ot)],
        [campos.ids.patente, vehiculo?.patente ?? ''],
        [campos.ids.datosCliente, `${nombreCliente} · ${cliente?.telefono ?? 'sin teléfono'}`],
      ]
      // Preferir el kilometraje capturado en ESTE ingreso; si no se
      // registró (queda vacío en el formulario), usar el último conocido
      // del vehículo en vez de dejar el campo sin nada en ClickUp.
      const kilometrajeAReportar = trabajo.kilometraje_ingreso ?? vehiculo?.kilometraje ?? null
      if (kilometrajeAReportar != null) {
        camposAFijar.push([campos.ids.kilometraje, kilometrajeAReportar])
      }
      if (inspeccion?.observaciones) {
        camposAFijar.push([campos.ids.observaciones, inspeccion.observaciones])
      }
      if (trabajo.categoria_servicio && campos.opcionesTipoServicio[trabajo.categoria_servicio]) {
        camposAFijar.push([campos.ids.tipoServicio, [campos.opcionesTipoServicio[trabajo.categoria_servicio]]])
      }

      for (const [campoId, valor] of camposAFijar) {
        try {
          await fijarCampoPersonalizado(clickupTaskId as string, campoId, valor)
        } catch (error) {
          await registrarError(`campo_personalizado:${campoId}`, error)
        }
      }
    }

    // 1b. Estado de la tarjeta igual al de la OT (solo si se pide).
    if (forzarEstado && trabajo.clickup_estado_actual) {
      try {
        await actualizarTarea(clickupTaskId as string, { status: trabajo.clickup_estado_actual })
      } catch (error) {
        await registrarError('estado_tarjeta', error)
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
      .select('id, descripcion, estado, tecnico_id, usuarios(correo)')
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

        // Con forzar_estado la subtarea toma el estado que la tarea ya tenía en el CRM.
        let estadoSubtarea = nuevaSubtarea.status?.status ?? 'agenda'
        if (forzarEstado && tarea.estado && tarea.estado !== estadoSubtarea) {
          try {
            await actualizarTarea(nuevaSubtarea.id, { status: tarea.estado })
            estadoSubtarea = tarea.estado
          } catch (error) {
            await registrarError(`estado_subtarea:${tarea.id}`, error)
          }
        }

        // clickup_asignado_nombre no se toca acá: en este sentido (CRM ->
        // ClickUp) el técnico ya se conoce por tecnico_id. Ese campo es
        // para el sentido contrario, cuando ClickUp trae un asignado que no
        // cruza con ningún usuario (ver clickup-webhook).
        await supabase
          .from('tareas_taller')
          .update({
            clickup_task_id: nuevaSubtarea.id,
            estado: estadoSubtarea,
          })
          .eq('id', tarea.id)
        tareasSincronizadas++
      } catch (error) {
        await registrarError(`tarea_taller:${tarea.id}`, error)
      }
    }

    // 3b. Con forzar_estado, las subtareas que ya existían también quedan en el
    // estado que tienen en el CRM.
    if (forzarEstado) {
      const { data: subtareasExistentes } = await supabase
        .from('tareas_taller')
        .select('id, estado, clickup_task_id')
        .eq('trabajo_id', trabajoId)
        .not('clickup_task_id', 'is', null)
        .not('estado', 'is', null)
      for (const subtarea of subtareasExistentes ?? []) {
        try {
          await actualizarTarea(subtarea.clickup_task_id as string, { status: subtarea.estado })
        } catch (error) {
          await registrarError(`estado_subtarea:${subtarea.id}`, error)
        }
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
