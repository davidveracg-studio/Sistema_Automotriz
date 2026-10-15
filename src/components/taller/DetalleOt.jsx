import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { invocarFuncion } from '../../lib/invocarFuncion'
import { formatearPatente } from '../../lib/patente'
import { nombreCliente } from '../../lib/plano'
import { NOMBRE_CHECKLIST_POR_AREA, PRIORIDADES, iniciales } from '../../lib/tallerReglas'

function uno(valor) {
  return Array.isArray(valor) ? valor[0] : valor
}

const ROLES_QUE_ASIGNAN = ['admin', 'socia', 'jefe_taller']

const ETIQUETA_TIPO_SERVICIO = {
  taller_mecanico: 'Mecánica',
  servicio_rapido: 'Servicio Rápido',
  dyp: 'DyP',
}

const AREAS = ['repuestos', 'lubricantes_insumos', 'servicios_externos']

const ZONA = 'America/Santiago'
function fechaHora(iso) {
  if (!iso) return null
  return new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso)
  )
}

// Detalle de una OT en pantalla completa, al abrir su tarjeta en el Kanban
// -parecido a como se ve la tarjeta en ClickUp-. Casi todo sale de lo que ya
// está sincronizado en la base (subtareas, checklists, campos); solo la
// descripción y la fecha de inicio se traen en vivo de ClickUp al abrir
// (acción "detalle" de clickup-kanban), porque nadie las copia a la base en
// ningún otro momento. Asignar técnico, marcar ejecutada y guardar la
// observación empujan el cambio a ClickUp también (función clickup-tarea).
function DetalleOt({ trabajoId, usuario, tecnicos, nombreTecnico, onCerrar }) {
  const [trabajo, setTrabajo] = useState(null)
  const [subtareas, setSubtareas] = useState([])
  const [items, setItems] = useState([])
  const [clickup, setClickup] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError(null)
      try {
        const [respTrabajo, respTareas, respItems] = await Promise.all([
          supabase
            .from('trabajos_taller')
            .select(
              'id, numero_ot, kilometraje_ingreso, categoria_servicio, clickup_estado_actual, clickup_prioridad, clickup_fecha_programada, clickup_fecha_con_hora, clickup_descripcion, clickup_fecha_inicio, vehiculos(patente, marca, modelo), clientes(tipo, nombre, apellido, razon_social, telefono)'
            )
            .eq('id', trabajoId)
            .single(),
          supabase
            .from('tareas_taller')
            .select('id, descripcion, estado, completada, tecnico_id, clickup_asignado_nombre, observaciones_tecnico')
            .eq('trabajo_id', trabajoId)
            .order('orden'),
          supabase
            .from('ot_detalle')
            .select('id, area, detalle, cantidad, verificado')
            .eq('trabajo_id', trabajoId)
            .neq('area', 'mano_obra')
            .order('creado_en'),
        ])
        if (!vigente) return
        if (respTrabajo.error) throw respTrabajo.error
        if (respTareas.error) throw respTareas.error
        if (respItems.error) throw respItems.error
        setTrabajo(respTrabajo.data)
        setSubtareas(respTareas.data || [])
        setItems(respItems.data || [])

        // Descripción y fecha de inicio: en vivo desde ClickUp (no se guardan en
        // ningún otro flujo). Si falla, el resto del detalle igual se muestra.
        try {
          const detalleClickup = await invocarFuncion('clickup-kanban', { body: { accion: 'detalle', trabajo_id: trabajoId } })
          if (vigente) setClickup(detalleClickup)
        } catch (excepcionClickup) {
          if (vigente) setClickup({ error: excepcionClickup.message })
        }
      } catch (excepcion) {
        if (vigente) setError(excepcion.message)
      } finally {
        if (vigente) setCargando(false)
      }
    }
    cargar()
    return () => {
      vigente = false
    }
  }, [trabajoId])

  function actualizarSubtarea(id, cambios) {
    setSubtareas((actual) => actual.map((t) => (t.id === id ? { ...t, ...cambios } : t)))
  }

  async function asignarTecnico(tareaId, tecnicoId) {
    const anterior = subtareas.find((t) => t.id === tareaId)
    actualizarSubtarea(tareaId, { tecnico_id: tecnicoId || null, clickup_asignado_nombre: null })
    try {
      await invocarFuncion('clickup-tarea', { body: { accion: 'asignar', tarea_taller_id: tareaId, tecnico_id: tecnicoId } })
    } catch (excepcion) {
      actualizarSubtarea(tareaId, anterior)
      setError(excepcion.message)
    }
  }

  async function completarTarea(tareaId) {
    const anterior = subtareas.find((t) => t.id === tareaId)
    actualizarSubtarea(tareaId, { completada: true })
    try {
      const resultado = await invocarFuncion('clickup-tarea', { body: { accion: 'completar', tarea_taller_id: tareaId } })
      if (resultado?.estado) actualizarSubtarea(tareaId, { estado: resultado.estado })
    } catch (excepcion) {
      actualizarSubtarea(tareaId, anterior)
      setError(excepcion.message)
    }
  }

  async function guardarObservacion(tareaId, texto) {
    const anterior = subtareas.find((t) => t.id === tareaId)
    actualizarSubtarea(tareaId, { observaciones_tecnico: texto })
    try {
      await invocarFuncion('clickup-tarea', { body: { accion: 'observacion', tarea_taller_id: tareaId, observacion: texto } })
    } catch (excepcion) {
      actualizarSubtarea(tareaId, anterior)
      setError(excepcion.message)
    }
  }

  async function guardarDescripcion(texto) {
    const anterior = clickup
    setClickup((actual) => ({ ...actual, descripcion: texto }))
    try {
      await invocarFuncion('clickup-kanban', { body: { accion: 'descripcion', trabajo_id: trabajoId, descripcion: texto } })
    } catch (excepcion) {
      setClickup(anterior)
      setError(excepcion.message)
    }
  }

  function actualizarItem(id, cambios) {
    setItems((actual) => actual.map((i) => (i.id === id ? { ...i, ...cambios } : i)))
  }

  async function agregarItem(area, detalle, cantidad) {
    const optimista = { id: `temp-${Date.now()}`, area, detalle, cantidad, verificado: false }
    setItems((actual) => [...actual, optimista])
    try {
      const resultado = await invocarFuncion('clickup-item', { body: { accion: 'agregar', trabajo_id: trabajoId, area, detalle, cantidad } })
      setItems((actual) => actual.map((i) => (i.id === optimista.id ? { ...i, id: resultado.id } : i)))
    } catch (excepcion) {
      setItems((actual) => actual.filter((i) => i.id !== optimista.id))
      setError(excepcion.message)
    }
  }

  async function editarItem(id, detalle, cantidad) {
    const anterior = items.find((i) => i.id === id)
    actualizarItem(id, { detalle, cantidad })
    try {
      await invocarFuncion('clickup-item', { body: { accion: 'editar', item_id: id, detalle, cantidad } })
    } catch (excepcion) {
      actualizarItem(id, anterior)
      setError(excepcion.message)
    }
  }

  async function marcarItem(id, verificado) {
    const anterior = items.find((i) => i.id === id)
    actualizarItem(id, { verificado })
    try {
      await invocarFuncion('clickup-item', { body: { accion: 'marcar', item_id: id, verificado } })
    } catch (excepcion) {
      actualizarItem(id, anterior)
      setError(excepcion.message)
    }
  }

  const vehiculo = trabajo ? uno(trabajo.vehiculos) : null
  const cliente = trabajo ? uno(trabajo.clientes) : null
  const asignados = [...new Set(subtareas.map((t) => (t.tecnico_id ? nombreTecnico(t.tecnico_id) : t.clickup_asignado_nombre)).filter(Boolean))]
  const total = subtareas.length
  const hechas = subtareas.filter((t) => t.completada).length
  const progreso = total === 0 ? 0 : Math.round((hechas / total) * 100)
  const puedeAsignar = ROLES_QUE_ASIGNAN.includes(usuario?.rol)
  const listaTecnicos = (tecnicos || []).filter((t) => t.rol === 'tecnico')

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
        <button type="button" onClick={onCerrar} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
          ← Volver al tablero
        </button>
      </div>

      <div>
        {cargando ? (
          <p className="p-6 text-slate-500">Cargando…</p>
        ) : error && !trabajo ? (
          <p className="m-6 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : (
          <div className="mx-auto max-w-4xl p-4 sm:p-6">
            {error && <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <h2 className="text-xl font-semibold text-slate-900">
              {formatearPatente(vehiculo?.patente)} {vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : ''}
              {trabajo.kilometraje_ingreso ? ` · ${trabajo.kilometraje_ingreso.toLocaleString('es-CL')} km` : ''} · OT {trabajo.numero_ot}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {nombreCliente(cliente)}
              {cliente?.telefono ? ` · ${cliente.telefono}` : ''}
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="label">Estado</p>
                <p className="text-sm font-medium text-slate-800">{trabajo.clickup_estado_actual || '—'}</p>
              </div>
              <div>
                <p className="label">Personas asignadas</p>
                {asignados.length > 0 ? (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {asignados.map((nombre) => (
                      <span key={nombre} className="flex items-center gap-1 rounded-full bg-deep/10 px-2 py-0.5 text-xs font-medium text-deep">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-deep/20 text-[9px]">{iniciales(nombre)}</span>
                        {nombre}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Sin asignar</p>
                )}
              </div>
              <div>
                <p className="label">Fechas</p>
                <p className="text-sm text-slate-700">
                  {fechaHora(clickup?.fecha_inicio) || 'Sin inicio'} → {trabajo.clickup_fecha_programada ? fechaHora(trabajo.clickup_fecha_programada) : 'Sin fecha límite'}
                </p>
              </div>
              <div>
                <p className="label">Prioridad</p>
                <p className="text-sm text-slate-700">{PRIORIDADES[trabajo.clickup_prioridad]?.etiqueta || '—'}</p>
              </div>
              <div>
                <p className="label">N.º OT</p>
                <p className="text-sm text-slate-700">{trabajo.numero_ot}</p>
              </div>
              <div>
                <p className="label">Patente</p>
                <p className="text-sm text-slate-700">{formatearPatente(vehiculo?.patente) || '—'}</p>
              </div>
              <div>
                <p className="label">Tipo de servicio</p>
                <p className="text-sm text-slate-700">{ETIQUETA_TIPO_SERVICIO[trabajo.categoria_servicio] || '—'}</p>
              </div>
              <div>
                <p className="label">Progreso</p>
                <div className="mt-1 h-2 rounded bg-slate-100">
                  <div className="h-2 rounded bg-emerald-500" style={{ width: `${progreso}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {hechas}/{total} subtareas · {progreso}%
                </p>
              </div>
              <div>
                <p className="label">Segmento</p>
                <p className="text-sm text-slate-700">{clickup?.segmento || '—'}</p>
              </div>
              <div>
                <p className="label">Sugerencias</p>
                <p className="text-sm text-slate-700">{clickup?.sugerencias || '—'}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="label">Observaciones (campo de ClickUp)</p>
                <p className="text-sm text-slate-700">{clickup?.observaciones || '—'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 p-4">
              <p className="label mb-1">Descripción</p>
              {clickup?.error ? (
                <p className="text-sm text-amber-700">No se pudo traer la descripción de ClickUp: {clickup.error}</p>
              ) : (
                <DescripcionOt puedeEditar={puedeAsignar} descripcion={clickup?.descripcion || ''} onGuardar={guardarDescripcion} />
              )}
            </div>

            {subtareas.length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-200 p-4">
                <p className="label mb-2">
                  Subtareas ({hechas}/{total} cerradas)
                </p>
                <div className="space-y-2">
                  {subtareas.map((subtarea) => {
                    const propsFila = {
                      tarea: subtarea,
                      puedeAsignar,
                      puedeEjecutar: puedeAsignar || subtarea.tecnico_id === usuario?.id,
                      listaTecnicos,
                      nombreTecnico,
                      onAsignar: (tecnicoId) => asignarTecnico(subtarea.id, tecnicoId),
                      onCompletar: () => completarTarea(subtarea.id),
                      onGuardarObservacion: (texto) => guardarObservacion(subtarea.id, texto),
                    }
                    return <FilaSubtarea key={subtarea.id} {...propsFila} />
                  })}
                </div>
              </div>
            )}

            {AREAS.map((area) => {
              const filas = items.filter((i) => i.area === area)
              return (
                <SeccionChecklist
                  key={area}
                  area={area}
                  filas={filas}
                  puedeEditar={puedeAsignar}
                  onAgregar={(detalle, cantidad) => agregarItem(area, detalle, cantidad)}
                  onEditar={editarItem}
                  onMarcar={marcarItem}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Una subtarea: asignar técnico (jefe de taller/admin/socia), marcar
// ejecutada y escribir observación (quien puede ejecutarla: lo mismo, o el
// propio técnico asignado). Todo empuja a ClickUp por su cuenta -ver
// clickup-tarea-, así que acá solo se llama y se refleja el resultado.
function FilaSubtarea({ tarea, puedeAsignar, puedeEjecutar, listaTecnicos, nombreTecnico, onAsignar, onCompletar, onGuardarObservacion }) {
  // El check de la izquierda ES el control para terminar la tarea -no un
  // botón aparte-. Al tocarlo se pide la observación (obligatoria: sin
  // observación no se puede terminar) y recién ahí se guarda y se completa
  // en un solo paso.
  const [editandoObs, setEditandoObs] = useState(false)
  const [textoObs, setTextoObs] = useState(tarea.observaciones_tecnico || '')
  const [guardando, setGuardando] = useState(false)
  const [faltaObservacion, setFaltaObservacion] = useState(false)

  function tocarCheck() {
    if (tarea.completada || !puedeEjecutar) return
    setEditandoObs(true)
    setFaltaObservacion(false)
  }

  async function guardarObservacion(evento) {
    evento.preventDefault()
    setGuardando(true)
    await onGuardarObservacion(textoObs.trim() || null)
    setGuardando(false)
    setEditandoObs(false)
  }

  async function guardarYCompletar() {
    const texto = textoObs.trim()
    if (!texto) {
      setFaltaObservacion(true)
      return
    }
    setGuardando(true)
    await onGuardarObservacion(texto)
    await onCompletar()
    setGuardando(false)
    setEditandoObs(false)
  }

  return (
    <div className={`rounded border p-2 ${tarea.completada ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={tocarCheck}
          disabled={tarea.completada || !puedeEjecutar}
          title={tarea.completada ? 'Ejecutada' : puedeEjecutar ? 'Marcar ejecutada' : undefined}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-sm ${
            tarea.completada
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : puedeEjecutar
                ? 'border-slate-300 text-transparent hover:border-emerald-500'
                : 'cursor-default border-slate-200 text-transparent'
          }`}
        >
          ✓
        </button>
        <span className={`text-sm ${tarea.completada ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{tarea.descripcion}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {puedeAsignar ? (
            <select
              value={tarea.tecnico_id || ''}
              onChange={(evento) => onAsignar(evento.target.value || null)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="">Sin asignar</option>
              {listaTecnicos.map((tecnico) => (
                <option key={tecnico.id} value={tecnico.id}>
                  {tecnico.nombre_completo}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-slate-500">{(tarea.tecnico_id ? nombreTecnico(tarea.tecnico_id) : tarea.clickup_asignado_nombre) || 'Sin asignar'}</span>
          )}
        </div>
      </div>

      {puedeEjecutar ? (
        editandoObs ? (
          <form onSubmit={guardarObservacion} className="mt-1.5">
            <div className="flex items-start gap-1.5">
              <textarea
                value={textoObs}
                onChange={(evento) => {
                  setTextoObs(evento.target.value)
                  if (evento.target.value.trim()) setFaltaObservacion(false)
                }}
                rows={2}
                autoFocus
                className={`w-full rounded border px-2 py-1 text-xs ${faltaObservacion ? 'border-red-400' : 'border-slate-300'}`}
                placeholder="Observación de la tarea (ej. venta cruzada, hallazgo)"
              />
              <div className="flex shrink-0 flex-col gap-1">
                {!tarea.completada && (
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={guardarYCompletar}
                    className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Guardar y marcar ejecutada
                  </button>
                )}
                <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50">
                  Solo guardar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTextoObs(tarea.observaciones_tecnico || '')
                    setEditandoObs(false)
                    setFaltaObservacion(false)
                  }}
                  className="text-xs text-slate-500 underline"
                >
                  Cancelar
                </button>
              </div>
            </div>
            {faltaObservacion && <p className="mt-1 text-xs text-red-600">Escribe una observación para poder marcar la tarea como ejecutada.</p>}
          </form>
        ) : (
          <button type="button" onClick={() => setEditandoObs(true)} className="mt-1 block text-left text-xs text-slate-500 hover:text-slate-800">
            {tarea.observaciones_tecnico ? (
              <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">{tarea.observaciones_tecnico}</span>
            ) : (
              <span className="underline">Agregar observación</span>
            )}
          </button>
        )
      ) : (
        tarea.observaciones_tecnico && (
          <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">{tarea.observaciones_tecnico}</p>
        )
      )}
    </div>
  )
}

// Descripción nativa de la tarjeta de ClickUp (no el campo "Observaciones").
// Editable solo por quien administra el equipo (mismo nivel que asignar técnico).
function DescripcionOt({ puedeEditar, descripcion, onGuardar }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(descripcion)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!editando) setTexto(descripcion)
  }, [descripcion, editando])

  async function guardar(evento) {
    evento.preventDefault()
    setGuardando(true)
    await onGuardar(texto.trim())
    setGuardando(false)
    setEditando(false)
  }

  if (editando) {
    return (
      <form onSubmit={guardar}>
        <textarea
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          rows={5}
          autoFocus
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Diagnóstico, presupuestos enviados, cualquier nota libre de la tarjeta…"
        />
        <div className="mt-1.5 flex gap-2">
          <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50">
            Guardar
          </button>
          <button
            type="button"
            onClick={() => {
              setTexto(descripcion)
              setEditando(false)
            }}
            className="text-xs text-slate-500 underline"
          >
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <div>
      {descripcion ? <p className="whitespace-pre-line text-sm text-slate-700">{descripcion}</p> : <p className="text-sm text-slate-400">Sin descripción en ClickUp.</p>}
      {puedeEditar && (
        <button type="button" onClick={() => setEditando(true)} className="mt-1 text-xs text-slate-500 underline hover:text-slate-800">
          {descripcion ? 'Editar' : 'Agregar descripción'}
        </button>
      )}
    </div>
  )
}

// Una lista de control (Repuestos/Lubricantes e insumos/Servicios externos):
// marcar cada ítem (el check ES el control, igual que las subtareas),
// editar su nombre/cantidad y agregar ítems nuevos.
function SeccionChecklist({ area, filas, puedeEditar, onAgregar, onEditar, onMarcar }) {
  const [agregando, setAgregando] = useState(false)
  const [detalleNuevo, setDetalleNuevo] = useState('')
  const [cantidadNueva, setCantidadNueva] = useState('1')

  async function agregar(evento) {
    evento.preventDefault()
    if (!detalleNuevo.trim()) return
    await onAgregar(detalleNuevo.trim(), Number(cantidadNueva) || 1)
    setDetalleNuevo('')
    setCantidadNueva('1')
    setAgregando(false)
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="label">
          {NOMBRE_CHECKLIST_POR_AREA[area]} ({filas.filter((i) => i.verificado).length}/{filas.length})
        </p>
        {puedeEditar && !agregando && (
          <button type="button" onClick={() => setAgregando(true)} className="text-xs text-slate-500 underline hover:text-slate-800">
            + Agregar
          </button>
        )}
      </div>

      {filas.length === 0 && !agregando && <p className="text-sm text-slate-400">Sin ítems todavía.</p>}

      <ul className="space-y-1">
        {filas.map((fila) => {
          const propsFila = { item: fila, puedeEditar, onEditar, onMarcar }
          return <FilaChecklist key={fila.id} {...propsFila} />
        })}
      </ul>

      {agregando && (
        <form onSubmit={agregar} className="mt-2 flex flex-wrap items-center gap-1.5">
          <input
            value={detalleNuevo}
            onChange={(evento) => setDetalleNuevo(evento.target.value)}
            autoFocus
            placeholder="Nombre del ítem"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            min="1"
            value={cantidadNueva}
            onChange={(evento) => setCantidadNueva(evento.target.value)}
            className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
            Agregar
          </button>
          <button type="button" onClick={() => setAgregando(false)} className="text-xs text-slate-500 underline">
            Cancelar
          </button>
        </form>
      )}
    </div>
  )
}

function FilaChecklist({ item, puedeEditar, onEditar, onMarcar }) {
  const [editando, setEditando] = useState(false)
  const [detalle, setDetalle] = useState(item.detalle)
  const [cantidad, setCantidad] = useState(item.cantidad)

  async function guardar(evento) {
    evento.preventDefault()
    if (!detalle.trim()) return
    await onEditar(item.id, detalle.trim(), Number(cantidad) || 1)
    setEditando(false)
  }

  if (editando) {
    return (
      <li>
        <form onSubmit={guardar} className="flex flex-wrap items-center gap-1.5">
          <input value={detalle} onChange={(evento) => setDetalle(evento.target.value)} autoFocus className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          <input
            type="number"
            min="1"
            value={cantidad}
            onChange={(evento) => setCantidad(evento.target.value)}
            className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
            Guardar
          </button>
          <button
            type="button"
            onClick={() => {
              setDetalle(item.detalle)
              setCantidad(item.cantidad)
              setEditando(false)
            }}
            className="text-xs text-slate-500 underline"
          >
            Cancelar
          </button>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => puedeEditar && onMarcar(item.id, !item.verificado)}
        disabled={!puedeEditar}
        title={item.verificado ? 'Verificado' : puedeEditar ? 'Marcar verificado' : undefined}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          item.verificado ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500'
        }`}
      >
        ✓
      </button>
      <span className={item.verificado ? 'text-slate-400 line-through' : 'text-slate-700'}>
        {item.detalle}
        {item.cantidad > 1 ? ` (x${item.cantidad})` : ''}
      </span>
      {puedeEditar && (
        <button type="button" onClick={() => setEditando(true)} className="text-xs text-slate-400 underline hover:text-slate-700">
          Editar
        </button>
      )}
    </li>
  )
}

export default DetalleOt
