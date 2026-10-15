import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

import { formatearPatente } from '../lib/patente'
const ETIQUETA_URGENCIA = { baja: 'Baja', media: 'Media', alta: 'Alta' }
const COLOR_URGENCIA = { baja: 'bg-slate-100 text-slate-600', media: 'bg-amber-100 text-amber-800', alta: 'bg-red-100 text-red-800' }
const ETIQUETA_AREA = {
  mano_obra: 'Mano de obra',
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes e insumos',
  servicios_externos: 'Servicios externos',
}

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return null
  return numero.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoDuracion(segundos) {
  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60
  return `${minutos}:${String(resto).padStart(2, '0')}`
}

function RadarSesion() {
  const { id } = useParams()
  const { usuario } = useAuth()

  const [trabajo, setTrabajo] = useState(null)
  const [sesion, setSesion] = useState(null)
  const [hallazgos, setHallazgos] = useState([])
  const [checklistItems, setChecklistItems] = useState([])
  const [checklistRespuestas, setChecklistRespuestas] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [modoPresentacion, setModoPresentacion] = useState(false)
  const [segundosTranscurridos, setSegundosTranscurridos] = useState(0)

  const [detalle, setDetalle] = useState('')
  const [area, setArea] = useState('')
  const [precioReferencial, setPrecioReferencial] = useState('')
  const [urgencia, setUrgencia] = useState('media')
  const [archivoFoto, setArchivoFoto] = useState(null)
  const [guardandoHallazgo, setGuardandoHallazgo] = useState(false)

  const origenEsperado = trabajo?.tipo_ingreso === 'diagnostico' ? 'radar_tecnico' : 'revision_asesor'
  const etiquetaSesion = origenEsperado === 'radar_tecnico' ? 'RADAR' : 'Revisión del asesor'

  async function cargarTodo() {
    try {
      const { data: trabajoData, error: errorTrabajo } = await supabase
        .from('trabajos_taller')
        .select('id, numero_ot, tipo_ingreso, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)')
        .eq('id', id)
        .maybeSingle()

      if (errorTrabajo) {
        setError(errorTrabajo.message)
        return
      }
      setTrabajo(trabajoData)

      const { data: sesionData } = await supabase
        .from('radar_inspecciones')
        .select('id, origen, iniciado_en, finalizado_en, observaciones_generales')
        .eq('trabajo_id', id)
        .order('creado_en', { ascending: false })
        .limit(1)
        .maybeSingle()

      setSesion(sesionData || null)
      setModoPresentacion(Boolean(sesionData?.finalizado_en))

      if (sesionData) {
        const { data: hallazgosData } = await supabase
          .from('radar_hallazgos')
          .select('id, detalle, area, precio_referencial, urgencia, foto_path, orden')
          .eq('radar_inspeccion_id', sesionData.id)
          .order('orden')
        setHallazgos(hallazgosData || [])

        const { data: respuestasData } = await supabase
          .from('radar_checklist_respuestas')
          .select('checklist_item_id, estado, nota')
          .eq('radar_inspeccion_id', sesionData.id)
        const mapaRespuestas = {}
        for (const r of respuestasData || []) mapaRespuestas[r.checklist_item_id] = { estado: r.estado, nota: r.nota || '' }
        setChecklistRespuestas(mapaRespuestas)
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarTodo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // La lista de inspección es de la empresa, no de esta sesión puntual: se
  // carga una sola vez.
  useEffect(() => {
    async function cargarChecklist() {
      const { data } = await supabase
        .from('radar_checklist_items')
        .select('id, area, item, orden')
        .eq('activo', true)
        .order('area')
        .order('orden')
      setChecklistItems(data || [])
    }
    cargarChecklist()
  }, [])

  useEffect(() => {
    if (!sesion?.iniciado_en || sesion.finalizado_en) return
    const inicio = new Date(sesion.iniciado_en).getTime()
    const intervalo = setInterval(() => {
      setSegundosTranscurridos(Math.floor((Date.now() - inicio) / 1000))
    }, 1000)
    return () => clearInterval(intervalo)
  }, [sesion])

  async function iniciarSesion() {
    setError(null)
    try {
      const { data, error: errorInsercion } = await supabase
        .from('radar_inspecciones')
        .insert({
          trabajo_id: id,
          origen: origenEsperado,
          realizado_por: usuario.id,
          iniciado_en: new Date().toISOString(),
        })
        .select('id, origen, iniciado_en, finalizado_en, observaciones_generales')
        .single()

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setSesion(data)
      setHallazgos([])
      setChecklistRespuestas({})
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function guardarRespuestaChecklist(checklistItemId, cambios) {
    const anterior = checklistRespuestas[checklistItemId] || { estado: 'bien', nota: '' }
    const nueva = { ...anterior, ...cambios }
    setChecklistRespuestas((actual) => ({ ...actual, [checklistItemId]: nueva }))
    try {
      const { error: errorUpsert } = await supabase
        .from('radar_checklist_respuestas')
        .upsert(
          { radar_inspeccion_id: sesion.id, checklist_item_id: checklistItemId, estado: nueva.estado, nota: nueva.nota || null },
          { onConflict: 'radar_inspeccion_id,checklist_item_id' }
        )
      if (errorUpsert) setError(errorUpsert.message)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  function usarChecklistComoHallazgo(area, item) {
    setDetalle(`${area} — ${item}`)
    document.getElementById('form-hallazgo')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  async function agregarHallazgo(evento) {
    evento.preventDefault()
    setGuardandoHallazgo(true)
    setError(null)
    try {
      let fotoPath = null
      if (archivoFoto) {
        const nombreArchivo = `${usuario.empresa_id}/${id}/${crypto.randomUUID()}-${archivoFoto.name}`
        const { error: errorSubida } = await supabase.storage.from('radar-fotos').upload(nombreArchivo, archivoFoto)
        if (errorSubida) {
          setError(`No se pudo subir la foto: ${errorSubida.message}`)
          return
        }
        fotoPath = nombreArchivo
      }

      const { error: errorInsercion } = await supabase.from('radar_hallazgos').insert({
        radar_inspeccion_id: sesion.id,
        detalle,
        area: area || null,
        precio_referencial: precioReferencial ? Number(precioReferencial) : null,
        urgencia,
        foto_path: fotoPath,
        orden: hallazgos.length,
      })

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }

      setDetalle('')
      setArea('')
      setPrecioReferencial('')
      setUrgencia('media')
      setArchivoFoto(null)
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardandoHallazgo(false)
    }
  }

  async function finalizarSesion() {
    setError(null)
    try {
      const { error: errorActualizar } = await supabase
        .from('radar_inspecciones')
        .update({ finalizado_en: new Date().toISOString() })
        .eq('id', sesion.id)

      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function usarEnPresupuesto(hallazgo) {
    setError(null)
    try {
      const { error: errorInsercion } = await supabase.from('ot_detalle').insert({
        trabajo_id: id,
        area: hallazgo.area || 'repuestos',
        detalle: hallazgo.detalle,
        hallazgo_radar_id: hallazgo.id,
      })
      if (errorInsercion) setError(errorInsercion.message)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>
  if (!trabajo) return <div className="p-6 text-slate-500">No se encontró el trabajo.</div>

  const areasChecklist = [...new Set(checklistItems.map((item) => item.area))]

  // --- Vista de presentación: pantalla grande y limpia para mostrar al cliente ---
  if (modoPresentacion) {
    return (
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link to={`/trabajos/${id}`} className="text-sm text-slate-500 hover:underline">
            ← Volver a la OT
          </Link>
          <button
            type="button"
            onClick={() => setModoPresentacion(false)}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Editar hallazgos
          </button>
        </div>

        <h1 className="mb-1 text-2xl font-semibold text-slate-900">
          {formatearPatente(trabajo.vehiculos?.patente)} — {trabajo.vehiculos?.marca} {trabajo.vehiculos?.modelo}
        </h1>
        <p className="mb-6 text-lg text-slate-500">{nombreCliente(trabajo.clientes)} · OT {trabajo.numero_ot}</p>

        <div className="space-y-4">
          {hallazgos.map((h) => (
            <div key={h.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className={`mb-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${COLOR_URGENCIA[h.urgencia]}`}>
                    {ETIQUETA_URGENCIA[h.urgencia]}
                  </span>
                  <p className="text-lg text-slate-900">{h.detalle}</p>
                </div>
                {h.precio_referencial !== null && (
                  <p className="whitespace-nowrap text-2xl font-semibold text-slate-900">
                    {formatoMoneda(h.precio_referencial)}
                  </p>
                )}
              </div>
              {h.foto_path && (
                <p className="mt-2 text-xs text-slate-400">Foto adjunta</p>
              )}
              <button
                type="button"
                onClick={() => usarEnPresupuesto(h)}
                className="mt-3 text-sm text-slate-500 underline hover:text-slate-700 print:hidden"
              >
                Usar en presupuesto
              </button>
            </div>
          ))}
          {hallazgos.length === 0 && <p className="text-slate-400">Sin hallazgos registrados.</p>}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  // --- Vista de captura ---
  return (
    <div className="p-6">
      <Link to={`/trabajos/${id}`} className="mb-4 inline-block text-sm text-slate-500 hover:underline">
        ← Volver a la OT
      </Link>

      <h1 className="mb-1 text-xl font-semibold text-slate-900">
        {etiquetaSesion} — {formatearPatente(trabajo.vehiculos?.patente)}
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        {trabajo.vehiculos?.marca} {trabajo.vehiculos?.modelo} · {nombreCliente(trabajo.clientes)} · OT {trabajo.numero_ot}
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {!sesion ? (
        <button
          type="button"
          onClick={iniciarSesion}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Iniciar {etiquetaSesion.toLowerCase()}
        </button>
      ) : (
        <div className="max-w-2xl">
          <div className="mb-4 flex items-center justify-between rounded border border-slate-200 bg-white p-3">
            <p className="text-sm text-slate-600">
              Iniciado {new Date(sesion.iniciado_en).toLocaleTimeString('es-CL')} · tiempo transcurrido{' '}
              <span className={segundosTranscurridos > 600 ? 'font-semibold text-amber-600' : ''}>
                {formatoDuracion(segundosTranscurridos)}
              </span>
            </p>
            <button
              type="button"
              onClick={finalizarSesion}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Finalizar y presentar
            </button>
          </div>

          {checklistItems.length > 0 && (
            <div className="mb-4 rounded border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">Lista de inspección</h2>
                <span className="text-xs text-slate-400">
                  {Object.keys(checklistRespuestas).length}/{checklistItems.length} revisados
                </span>
              </div>
              {areasChecklist.map((areaChecklist) => (
                <div key={areaChecklist} className="mb-3 last:mb-0">
                  <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{areaChecklist}</p>
                  <div className="divide-y divide-slate-100">
                    {checklistItems
                      .filter((item) => item.area === areaChecklist)
                      .map((item) => {
                        const respuesta = checklistRespuestas[item.id]
                        return (
                          <div key={item.id} className="py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-slate-700">{item.item}</span>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => guardarRespuestaChecklist(item.id, { estado: 'bien' })}
                                  className={`rounded px-2 py-1 text-xs ${
                                    respuesta?.estado === 'bien' ? 'bg-green-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                >
                                  Bien
                                </button>
                                <button
                                  type="button"
                                  onClick={() => guardarRespuestaChecklist(item.id, { estado: 'atencion' })}
                                  className={`rounded px-2 py-1 text-xs ${
                                    respuesta?.estado === 'atencion' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                >
                                  Atención
                                </button>
                                <button
                                  type="button"
                                  onClick={() => guardarRespuestaChecklist(item.id, { estado: 'no_aplica' })}
                                  className={`rounded px-2 py-1 text-xs ${
                                    respuesta?.estado === 'no_aplica' ? 'bg-slate-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                >
                                  N/A
                                </button>
                              </div>
                            </div>
                            {respuesta?.estado === 'atencion' && (
                              <div className="mt-1 flex items-center gap-2">
                                <input
                                  value={respuesta.nota}
                                  onChange={(evento) => guardarRespuestaChecklist(item.id, { nota: evento.target.value })}
                                  placeholder="Nota (opcional)"
                                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => usarChecklistComoHallazgo(areaChecklist, item.item)}
                                  className="shrink-0 text-xs text-amber-700 underline hover:text-amber-900"
                                >
                                  → Convertir en hallazgo
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <ul className="mb-4 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {hallazgos.map((h) => (
              <li key={h.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-slate-800">
                  {h.detalle} {h.area && <span className="text-slate-400">· {ETIQUETA_AREA[h.area]}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${COLOR_URGENCIA[h.urgencia]}`}>
                    {ETIQUETA_URGENCIA[h.urgencia]}
                  </span>
                  {h.precio_referencial !== null && <span className="text-slate-600">{formatoMoneda(h.precio_referencial)}</span>}
                </span>
              </li>
            ))}
            {hallazgos.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">Sin hallazgos todavía.</li>}
          </ul>

          <form id="form-hallazgo" onSubmit={agregarHallazgo} className="rounded border border-slate-200 bg-white p-3">
            <input
              required
              value={detalle}
              onChange={(evento) => setDetalle(evento.target.value)}
              placeholder="Ej. Amortiguador delantero derecho con fuga"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mb-2 grid grid-cols-3 gap-2">
              <select
                value={area}
                onChange={(evento) => setArea(evento.target.value)}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              >
                <option value="">Área (opcional)</option>
                {Object.entries(ETIQUETA_AREA).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={precioReferencial}
                onChange={(evento) => setPrecioReferencial(evento.target.value)}
                placeholder="Precio referencial"
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <select
                value={urgencia}
                onChange={(evento) => setUrgencia(evento.target.value)}
                className="rounded border border-slate-300 px-2 py-2 text-sm"
              >
                {Object.entries(ETIQUETA_URGENCIA).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(evento) => setArchivoFoto(evento.target.files?.[0] || null)}
              className="mb-2 w-full text-sm"
            />
            <button
              type="submit"
              disabled={guardandoHallazgo}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardandoHallazgo ? 'Guardando…' : 'Agregar hallazgo'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default RadarSesion
