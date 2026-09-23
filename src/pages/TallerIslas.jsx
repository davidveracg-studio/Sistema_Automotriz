import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

const ESTADOS_TERMINALES_OT = ['entregado', 'anulado']

function nombreCliente(cliente) {
  if (!cliente) return '—'
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return `${cliente.nombre} ${cliente.apellido || ''}`.trim()
}

function formatoTranscurrido(desde) {
  if (!desde) return '—'
  const minutos = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000))
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  if (horas < 24) return `${horas} h ${resto} min`
  const dias = Math.floor(horas / 24)
  return `${dias} d ${horas % 24} h`
}

function TallerIslas() {
  const { usuario } = useAuth()
  const [islas, setIslas] = useState([])
  const [asignaciones, setAsignaciones] = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [tareas, setTareas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [actualizadoEn, setActualizadoEn] = useState(null)
  const [islaParaAsignar, setIslaParaAsignar] = useState({})
  const intervaloRef = useRef(null)

  const cargar = useCallback(async (mostrarCargando = true) => {
    if (mostrarCargando) setCargando(true)
    setError(null)
    try {
      const [
        { data: islasData, error: errorIslas },
        { data: asignacionesData, error: errorAsignaciones },
        { data: tecnicosData, error: errorTecnicos },
        { data: tareasData, error: errorTareas },
      ] = await Promise.all([
        supabase.from('tipos_isla').select('id, nombre, capacidad, orden').eq('activo', true).order('orden'),
        supabase.from('usuarios_islas').select('id, usuario_id, tipo_isla_id, usuarios(nombre_completo)'),
        supabase.from('usuarios').select('id, nombre_completo, rol').eq('activo', true).order('nombre_completo'),
        supabase
          .from('tareas_taller')
          .select(
            `id, descripcion, tecnico_id, clickup_asignado_nombre,
             trabajos_taller!inner(id, numero_ot, estado, clickup_estado_actual, estado_cambiado_en,
               vehiculos(patente, marca, modelo), clientes(tipo, nombre, apellido, razon_social))`
          )
          .filter('trabajos_taller.estado', 'not.in', `(${ESTADOS_TERMINALES_OT.join(',')})`)
          .or('tecnico_id.not.is.null,clickup_asignado_nombre.not.is.null'),
      ])

      const primerError = errorIslas || errorAsignaciones || errorTecnicos || errorTareas
      if (primerError) {
        setError(primerError.message)
        return
      }

      setIslas(islasData || [])
      setAsignaciones(asignacionesData || [])
      setTecnicos(tecnicosData || [])
      setTareas(tareasData || [])
      setActualizadoEn(new Date())
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      if (mostrarCargando) setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    intervaloRef.current = setInterval(() => cargar(false), 60000)
    return () => clearInterval(intervaloRef.current)
  }, [cargar])

  async function agregarAsignacion(tipoIslaId) {
    const usuarioId = islaParaAsignar[tipoIslaId]
    if (!usuarioId) return
    const { error: errorInsert } = await supabase
      .from('usuarios_islas')
      .insert({ usuario_id: usuarioId, tipo_isla_id: tipoIslaId, empresa_id: usuario.empresa_id })
    if (errorInsert) {
      setError(errorInsert.message)
      return
    }
    setIslaParaAsignar((previo) => ({ ...previo, [tipoIslaId]: '' }))
    cargar(false)
  }

  async function quitarAsignacion(id) {
    const { error: errorDelete } = await supabase.from('usuarios_islas').delete().eq('id', id)
    if (errorDelete) {
      setError(errorDelete.message)
      return
    }
    cargar(false)
  }

  // Agrupa las tareas activas por técnico (id si está vinculado a un
  // usuario, o el nombre crudo de ClickUp si no) y, dentro de cada técnico,
  // por OT -una OT puede tener varias tareas de mano de obra del mismo
  // técnico, pero cuenta como un solo vehículo en la carga del día-.
  const porTecnico = new Map()
  for (const tarea of tareas) {
    const trabajo = Array.isArray(tarea.trabajos_taller) ? tarea.trabajos_taller[0] : tarea.trabajos_taller
    if (!trabajo) continue
    const clave = tarea.tecnico_id ? `u:${tarea.tecnico_id}` : `n:${tarea.clickup_asignado_nombre}`
    if (!porTecnico.has(clave)) {
      porTecnico.set(clave, {
        tecnicoId: tarea.tecnico_id,
        nombre: tarea.tecnico_id
          ? tecnicos.find((t) => t.id === tarea.tecnico_id)?.nombre_completo || 'Técnico'
          : tarea.clickup_asignado_nombre,
        vinculado: Boolean(tarea.tecnico_id),
        ots: new Map(),
      })
    }
    const entrada = porTecnico.get(clave)
    if (!entrada.ots.has(trabajo.id)) {
      entrada.ots.set(trabajo.id, {
        numeroOt: trabajo.numero_ot,
        vehiculo: trabajo.vehiculos,
        cliente: trabajo.clientes,
        estado: trabajo.clickup_estado_actual,
        desde: trabajo.estado_cambiado_en,
        tareas: [],
      })
    }
    entrada.ots.get(trabajo.id).tareas.push(tarea.descripcion)
  }

  const tecnicosPorIsla = new Map(islas.map((isla) => [isla.id, []]))
  const islasPorUsuario = new Map()
  for (const asignacion of asignaciones) {
    if (!tecnicosPorIsla.has(asignacion.tipo_isla_id)) continue
    tecnicosPorIsla.get(asignacion.tipo_isla_id).push(asignacion)
    if (!islasPorUsuario.has(asignacion.usuario_id)) islasPorUsuario.set(asignacion.usuario_id, [])
    islasPorUsuario.get(asignacion.usuario_id).push(asignacion.tipo_isla_id)
  }

  const tecnicosSinIsla = [...porTecnico.entries()].filter(
    ([, datos]) => !datos.vinculado || !islasPorUsuario.has(datos.tecnicoId)
  )

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Taller por islas</h1>
          <p className="text-sm text-slate-500">
            {actualizadoEn ? `Actualizado ${actualizadoEn.toLocaleTimeString('es-CL')}` : ''} · se refresca solo cada minuto
          </p>
        </div>
        <button
          type="button"
          onClick={() => cargar(false)}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Actualizar ahora
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {cargando ? (
        <p className="text-slate-500">Cargando…</p>
      ) : (
        <div className="space-y-6">
          {islas.map((isla) => {
            const asignadosIsla = tecnicosPorIsla.get(isla.id) || []
            return (
              <div key={isla.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {isla.nombre} <span className="text-sm font-normal text-slate-500">(capacidad {isla.capacidad})</span>
                  </h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={islaParaAsignar[isla.id] || ''}
                      onChange={(evento) =>
                        setIslaParaAsignar((previo) => ({ ...previo, [isla.id]: evento.target.value }))
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">Agregar técnico…</option>
                      {tecnicos.map((tecnico) => (
                        <option key={tecnico.id} value={tecnico.id}>
                          {tecnico.nombre_completo}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => agregarAsignacion(isla.id)}
                      className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Agregar
                    </button>
                  </div>
                </div>

                {asignadosIsla.length === 0 ? (
                  <p className="text-sm text-slate-400">Sin técnicos asignados a esta isla todavía.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {asignadosIsla.map((asignacion) => {
                      const datos = porTecnico.get(`u:${asignacion.usuario_id}`)
                      const ots = datos ? [...datos.ots.values()] : []
                      return (
                        <div key={asignacion.id} className="rounded border border-slate-200 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="font-medium text-slate-800">
                              {asignacion.usuarios?.nombre_completo || 'Técnico'}
                            </span>
                            <button
                              type="button"
                              onClick={() => quitarAsignacion(asignacion.id)}
                              className="text-xs text-slate-400 hover:text-red-600"
                            >
                              quitar de isla
                            </button>
                          </div>
                          <p className="mb-2 text-xs text-slate-500">
                            Carga: {ots.length} vehículo{ots.length === 1 ? '' : 's'}
                          </p>
                          {ots.length === 0 ? (
                            <p className="text-sm text-slate-400">Sin trabajos activos ahora.</p>
                          ) : (
                            <ul className="space-y-2">
                              {ots.map((ot) => (
                                <li key={ot.numeroOt} className="rounded bg-slate-50 p-2 text-sm">
                                  <div className="font-medium text-slate-800">
                                    OT {ot.numeroOt} · {ot.vehiculo?.patente} {ot.vehiculo?.marca} {ot.vehiculo?.modelo}
                                  </div>
                                  <div className="text-xs text-slate-500">{nombreCliente(ot.cliente)}</div>
                                  <div className="mt-1 flex items-center justify-between text-xs">
                                    <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                                      {ot.estado || 'sin sincronizar'}
                                    </span>
                                    <span className="text-slate-500">{formatoTranscurrido(ot.desde)}</span>
                                  </div>
                                  <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                                    {ot.tareas.map((tarea, indice) => (
                                      <li key={indice}>{tarea}</li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {tecnicosSinIsla.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Con trabajo activo, sin isla asignada</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {tecnicosSinIsla.map(([clave, datos]) => {
                  const ots = [...datos.ots.values()]
                  return (
                    <div key={clave} className="rounded border border-amber-200 bg-white p-3">
                      <div className="mb-2 font-medium text-slate-800">
                        {datos.nombre}
                        {!datos.vinculado && (
                          <span className="ml-2 text-xs font-normal text-amber-700">sin cuenta en el sistema</span>
                        )}
                      </div>
                      <p className="mb-2 text-xs text-slate-500">
                        Carga: {ots.length} vehículo{ots.length === 1 ? '' : 's'}
                      </p>
                      <ul className="space-y-2">
                        {ots.map((ot) => (
                          <li key={ot.numeroOt} className="rounded bg-slate-50 p-2 text-sm">
                            <div className="font-medium text-slate-800">
                              OT {ot.numeroOt} · {ot.vehiculo?.patente} {ot.vehiculo?.marca} {ot.vehiculo?.modelo}
                            </div>
                            <div className="mt-1 flex items-center justify-between text-xs">
                              <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                                {ot.estado || 'sin sincronizar'}
                              </span>
                              <span className="text-slate-500">{formatoTranscurrido(ot.desde)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TallerIslas
