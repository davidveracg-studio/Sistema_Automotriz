import { useMemo, useState } from 'react'
import { invocarFuncion } from '../../lib/invocarFuncion'
import { formatearPatente } from '../../lib/patente'
import { nombreCliente } from '../../lib/plano'
import DetalleOt from './DetalleOt'
import {
  CATEGORIAS_UBICACION,
  PRIORIDADES,
  claveEstado,
  elementosPermitidos,
  estaVencida,
  estadoUbicacion,
  formatoProgramada,
  iniciales,
  posicionBase,
  progresoSubtareas,
  reglaDeUbicacion,
} from '../../lib/tallerReglas'

function uno(valor) {
  return Array.isArray(valor) ? valor[0] : valor
}

// Vista kanban del taller: una tarjeta por OT activa, agrupadas por su estado
// de ClickUp. Usa los mismos datos que ya cargó el plano (Taller.jsx) -misma
// fuente, mismo refresco cada minuto-, así que plano y kanban nunca se
// desincronizan entre sí: si acá se cambia el puesto de un vehículo, el
// plano lo refleja apenas vuelva a cargar, y viceversa.
function Kanban({ usuario, puedeEditar, trabajos, tareas, elementos, ocupacion, tecnicos, estadosClickup, onUbicar, onRecargar }) {
  const [arrastrando, setArrastrando] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [reubicar, setReubicar] = useState(null) // { trabajoId, regla, elemento } tras un cambio de estado
  const [sobreEstadoOptimista, setSobreEstadoOptimista] = useState({}) // trabajoId -> estado (mientras ClickUp/webhook se ponen al día)
  const [detalleAbierto, setDetalleAbierto] = useState(null) // trabajo_id de la tarjeta abierta, o null

  const nombreTecnico = (id) => tecnicos.find((t) => t.id === id)?.nombre_completo || null
  const elementoDe = useMemo(() => new Map(ocupacion.map((o) => [o.trabajo_id, o.elemento_id])), [ocupacion])
  const elementoPorId = useMemo(() => new Map(elementos.map((e) => [e.id, e])), [elementos])
  const tareasDe = useMemo(() => {
    const mapa = new Map()
    for (const t of tareas) {
      if (!mapa.has(t.trabajo_id)) mapa.set(t.trabajo_id, [])
      mapa.get(t.trabajo_id).push(t)
    }
    return mapa
  }, [tareas])

  // Columnas: los estados reales de ClickUp si ya se sincronizaron; si no,
  // se arman con los estados que traigan las OT (para no mostrar un kanban
  // vacío mientras nadie presiona "Sincronizar estados").
  const columnas = useMemo(() => {
    if (estadosClickup.length > 0) return estadosClickup.map((e) => e.nombre)
    const vistos = new Set(trabajos.map((t) => t.clickup_estado_actual || t.estado).filter(Boolean))
    return [...vistos].sort((a, b) => posicionBase(a) - posicionBase(b))
  }, [estadosClickup, trabajos])

  const tarjetas = trabajos.map((ot) => ({
    ot,
    estado: sobreEstadoOptimista[ot.id] || ot.clickup_estado_actual || ot.estado,
  }))
  const tarjetasPorColumna = new Map(columnas.map((c) => [claveEstado(c), []]))
  for (const tarjeta of tarjetas) {
    const clave = claveEstado(tarjeta.estado)
    if (!tarjetasPorColumna.has(clave)) tarjetasPorColumna.set(clave, [])
    tarjetasPorColumna.get(clave).push(tarjeta)
  }
  // Columnas que no vienen de clickup_estados pero tienen tarjetas (estado que ClickUp ya no tiene, por ejemplo).
  for (const clave of tarjetasPorColumna.keys()) {
    if (!columnas.some((c) => claveEstado(c) === clave) && tarjetasPorColumna.get(clave).length > 0) columnas.push(clave)
  }

  // Mismo color que le puso el estado en ClickUp (columna clickup_estados.color).
  const colorPorClave = new Map(estadosClickup.filter((e) => e.color).map((e) => [claveEstado(e.nombre), e.color]))

  async function sincronizarEstados() {
    setOcupado(true)
    setError(null)
    try {
      await invocarFuncion('clickup-kanban', { body: { accion: 'estados' } })
      await onRecargar()
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  async function refrescarDetalle() {
    setOcupado(true)
    setError(null)
    try {
      const idsConTarjeta = trabajos.filter((t) => t.clickup_task_id).map((t) => t.id)
      const resultado = await invocarFuncion('clickup-kanban', { body: { accion: 'refrescar', trabajo_ids: idsConTarjeta.slice(0, 40) } })
      if (resultado?.limitado) setAviso('ClickUp puso un límite de llamadas; se actualizó lo que se pudo. Vuelve a intentar en un minuto.')
      await onRecargar()
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  async function moverA(ot, nuevoEstado) {
    const actual = sobreEstadoOptimista[ot.id] || ot.clickup_estado_actual || ot.estado
    if (claveEstado(actual) === claveEstado(nuevoEstado)) return
    if (['entregado', 'anulado'].includes(ot.estado)) return
    if (!ot.clickup_task_id) {
      setError(`OT ${ot.numero_ot} todavía no tiene tarjeta en ClickUp; sincronízala primero desde Trabajos.`)
      return
    }
    setOcupado(true)
    setError(null)
    setSobreEstadoOptimista((previo) => ({ ...previo, [ot.id]: nuevoEstado }))
    try {
      await invocarFuncion('clickup-kanban', { body: { accion: 'cambiar_estado', trabajo_id: ot.id, estado: nuevoEstado } })
      const regla = reglaDeUbicacion({ estado: nuevoEstado, subtareas: tareasDe.get(ot.id) })
      const elementoActual = elementoPorId.get(elementoDe.get(ot.id)) || null
      if (regla && estadoUbicacion(regla, elementoActual) !== 'ok') {
        setReubicar({ trabajoId: ot.id, ot, regla })
      }
      await onRecargar()
    } catch (excepcion) {
      setSobreEstadoOptimista((previo) => {
        const copia = { ...previo }
        delete copia[ot.id]
        return copia
      })
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  // El detalle reemplaza el tablero (no un overlay de pantalla completa): ocupa
  // el mismo espacio de contenido, sin taparle el menú ni la barra superior.
  if (detalleAbierto) {
    return (
      <DetalleOt trabajoId={detalleAbierto} usuario={usuario} tecnicos={tecnicos} nombreTecnico={nombreTecnico} onCerrar={() => setDetalleAbierto(null)} />
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">
          {estadosClickup.length === 0
            ? 'Sin estados de ClickUp cargados todavía.'
            : `${tarjetas.length} OT activa${tarjetas.length === 1 ? '' : 's'} · ${estadosClickup.length} estados de ClickUp.`}
        </p>
        <div className="ml-auto flex gap-2">
          {puedeEditar && (
            <button type="button" disabled={ocupado} onClick={sincronizarEstados} className="btn-ghost text-xs">
              {estadosClickup.length === 0 ? 'Sincronizar estados de ClickUp' : 'Releer estados de ClickUp'}
            </button>
          )}
          <button type="button" disabled={ocupado} onClick={refrescarDetalle} className="btn-ghost text-xs">
            Actualizar detalle (prioridad, fecha, subtareas)
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      {reubicar && (
        <PanelReubicar
          reubicar={reubicar}
          elementos={elementos}
          ocupacion={ocupacion}
          onUbicar={async (elementoId) => {
            setOcupado(true)
            try {
              await onUbicar(elementoPorId.get(elementoId), reubicar.trabajoId)
              setReubicar(null)
            } catch (excepcion) {
              setError(excepcion.message)
            } finally {
              setOcupado(false)
            }
          }}
          onCerrar={() => setReubicar(null)}
        />
      )}

      {estadosClickup.length === 0 && tarjetas.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Todavía no hay estados de ClickUp ni OT activas para mostrar.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columnas.map((nombreColumna) => {
            const clave = claveEstado(nombreColumna)
            const filas = tarjetasPorColumna.get(clave) || []
            const color = colorPorClave.get(clave) || '#94a3b8'
            return (
              <div
                key={clave}
                onDragOver={(evento) => evento.preventDefault()}
                onDrop={(evento) => {
                  evento.preventDefault()
                  if (arrastrando) moverA(arrastrando, nombreColumna)
                  setArrastrando(null)
                }}
                className="flex w-72 shrink-0 flex-col rounded-lg border border-slate-200 bg-slate-50"
              >
                <div
                  className="flex items-center justify-between gap-2 rounded-t-lg border-b border-slate-200 bg-white px-3 py-2"
                  style={{ borderTop: `3px solid ${color}` }}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate text-sm font-semibold text-slate-800">{nombreColumna}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{filas.length}</span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {filas.map(({ ot }) => (
                    <TarjetaOt
                      key={ot.id}
                      ot={ot}
                      estado={sobreEstadoOptimista[ot.id] || ot.clickup_estado_actual || ot.estado}
                      color={color}
                      subtareas={tareasDe.get(ot.id) || []}
                      elemento={elementoPorId.get(elementoDe.get(ot.id)) || null}
                      nombreTecnico={nombreTecnico}
                      arrastrable={puedeEditar}
                      onDragStart={() => setArrastrando(ot)}
                      onDragEnd={() => setArrastrando(null)}
                      onAbrir={() => setDetalleAbierto(ot.id)}
                    />
                  ))}
                  {filas.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">Sin OT en este estado</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {puedeEditar && (
        <p className="mt-2 text-xs text-slate-400">Toca una tarjeta para ver su detalle, o arrástrala a otra columna para cambiar el estado en ClickUp.</p>
      )}
    </div>
  )
}

function TarjetaOt({ ot, estado, color, subtareas, elemento, nombreTecnico, arrastrable, onDragStart, onDragEnd, onAbrir }) {
  const vehiculo = uno(ot.vehiculos)
  const progreso = progresoSubtareas(subtareas)
  const regla = reglaDeUbicacion({ estado, subtareas })
  const ubicacion = estadoUbicacion(regla, elemento)
  const prioridad = ot.clickup_prioridad ? PRIORIDADES[ot.clickup_prioridad] : null
  const nombresAsignados = [
    ...new Set(subtareas.map((t) => (t.tecnico_id ? nombreTecnico(t.tecnico_id) : t.clickup_asignado_nombre)).filter(Boolean)),
  ]
  const fechaTexto = formatoProgramada(ot.clickup_fecha_programada, ot.clickup_fecha_con_hora)
  const vencida = estaVencida(ot.clickup_fecha_programada, ot.clickup_fecha_con_hora)

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={arrastrable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault()
          onAbrir()
        }
      }}
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
      className={`cursor-pointer rounded-md border bg-white p-2 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-deep ${
        arrastrable ? 'active:cursor-grabbing' : ''
      } ${ubicacion === 'incorrecta' ? 'border-red-300' : ubicacion === 'sin_ubicar' ? 'border-amber-300' : 'border-slate-200'}`}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{formatearPatente(vehiculo?.patente) || `OT ${ot.numero_ot}`}</p>
          <p className="truncate text-xs text-slate-500">
            {vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : ''} · OT {ot.numero_ot}
          </p>
        </div>
        {prioridad && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${prioridad.clases}`}>{prioridad.etiqueta}</span>
        )}
      </div>

      <p className="truncate text-xs text-slate-500">{nombreCliente(uno(ot.clientes))}</p>

      {fechaTexto && (
        <p className={`mt-1 text-xs ${vencida ? 'font-medium text-red-600' : 'text-slate-500'}`}>
          {vencida ? '⚠ ' : ''}
          {fechaTexto}
        </p>
      )}

      {nombresAsignados.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {nombresAsignados.map((nombre) => (
            <span
              key={nombre}
              title={nombre}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-deep/10 text-[10px] font-semibold text-deep"
            >
              {iniciales(nombre)}
            </span>
          ))}
        </div>
      )}

      {progreso.total > 0 && (
        <div className="mt-1.5">
          <div className="h-1.5 rounded bg-slate-100">
            <div className="h-1.5 rounded bg-emerald-500" style={{ width: `${progreso.porcentaje}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {progreso.hechas}/{progreso.total} subtareas · {progreso.porcentaje}%
          </p>
        </div>
      )}

      <p className="mt-1 truncate text-[10px] text-slate-400">
        {elemento ? elemento.nombre : 'Sin puesto'}
        {ubicacion === 'incorrecta' && <span className="ml-1 text-red-600">· debería estar en {regla.texto}</span>}
        {ubicacion === 'sin_ubicar' && <span className="ml-1 text-amber-700">· falta ubicar en {regla.texto}</span>}
      </p>
    </div>
  )
}

// Tras cambiar el estado, si el puesto actual no corresponde, se pide elegir uno de los permitidos.
function PanelReubicar({ reubicar, elementos, ocupacion, onUbicar, onCerrar }) {
  const { ot, regla } = reubicar
  const vehiculo = uno(ot.vehiculos)
  const ocupantesPorElemento = new Map()
  for (const fila of ocupacion) {
    if (!ocupantesPorElemento.has(fila.elemento_id)) ocupantesPorElemento.set(fila.elemento_id, 0)
    ocupantesPorElemento.set(fila.elemento_id, ocupantesPorElemento.get(fila.elemento_id) + 1)
  }
  const permitidos = elementosPermitidos(regla, elementos)

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm text-amber-900">
        <span className="font-semibold">{formatearPatente(vehiculo?.patente) || `OT ${ot.numero_ot}`}</span> pasó a un estado que debe
        estar en {regla.texto}. Elige el puesto:
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {permitidos.map((elemento) => {
          const lleno = (ocupantesPorElemento.get(elemento.id) || 0) >= (elemento.capacidad_vehiculos || 1)
          return (
            <button
              key={elemento.id}
              type="button"
              disabled={lleno}
              onClick={() => onUbicar(elemento.id)}
              className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              title={lleno ? 'Puesto completo' : CATEGORIAS_UBICACION[Object.keys(CATEGORIAS_UBICACION).find((c) => CATEGORIAS_UBICACION[c].es(elemento))]?.etiqueta}
            >
              {elemento.nombre}
              {lleno ? ' (lleno)' : ''}
            </button>
          )
        })}
        {permitidos.length === 0 && <span className="text-xs text-amber-800">No hay puestos de ese tipo dibujados en el plano.</span>}
        <button type="button" onClick={onCerrar} className="ml-2 text-xs text-amber-700 underline">
          Ahora no
        </button>
      </div>
    </div>
  )
}

export default Kanban
