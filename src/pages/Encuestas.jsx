import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { PREGUNTAS, ETIQUETA_COMO_CONOCIO, ETIQUETA_CLASIFICACION, COLOR_CLASIFICACION } from '../lib/encuestas'

const FILTROS = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'negativo', etiqueta: 'Negativas' },
  { valor: 'positivo', etiqueta: 'Positivas' },
  { valor: 'excelente', etiqueta: 'Excelentes' },
]

function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoFecha(fechaIso) {
  if (!fechaIso) return '—'
  const fecha = new Date(fechaIso)
  return `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`
}

function Estrellas({ valor }) {
  if (!valor) return <span className="text-slate-300">—</span>
  return (
    <span title={`${valor}/5`} className={valor <= 2 ? 'text-red-600' : 'text-amber-500'}>
      {'★'.repeat(valor)}
      <span className="text-slate-300">{'★'.repeat(5 - valor)}</span>
    </span>
  )
}

function Encuestas() {
  const [encuestas, setEncuestas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('todas')

  useEffect(() => {
    async function cargar() {
      try {
        const { data, error: errorConsulta } = await supabase
          .from('encuestas')
          .select(
            'id, respondido_en, clasificacion, areas_bajas, como_conocio, sugerencia, ' +
              'calificacion_entrega_tiempo, calificacion_atencion_cliente, calificacion_servicio_mecanico, calificacion_recomendaria, ' +
              'trabajos_taller(id, numero_ot, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo))'
          )
          .not('respondido_en', 'is', null)
          .order('respondido_en', { ascending: false })

        if (errorConsulta) {
          setError(errorConsulta.message)
        } else {
          setEncuestas(data || [])
        }
      } catch {
        setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  const encuestasFiltradas = encuestas.filter((encuesta) => filtro === 'todas' || encuesta.clasificacion === filtro)
  const negativasPendientes = encuestas.filter((encuesta) => encuesta.clasificacion === 'negativo').length

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Encuestas de postventa</h1>
      <p className="mb-4 text-sm text-slate-500">
        Respuestas de clientes tras el retiro del vehículo.
        {negativasPendientes > 0 && (
          <span className="ml-2 font-medium text-red-700">
            {negativasPendientes} {negativasPendientes === 1 ? 'respuesta negativa' : 'respuestas negativas'} por revisar.
          </span>
        )}
      </p>

      <div className="mb-4 flex gap-2">
        {FILTROS.map((opcion) => (
          <button
            key={opcion.valor}
            type="button"
            onClick={() => setFiltro(opcion.valor)}
            className={`rounded border px-3 py-1.5 text-sm ${
              filtro === opcion.valor
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {!cargando &&
          encuestasFiltradas.map((encuesta) => {
            const trabajo = encuesta.trabajos_taller
            const areasBajas = encuesta.areas_bajas || []
            return (
              <div
                key={encuesta.id}
                className={`rounded border bg-white p-4 ${
                  encuesta.clasificacion === 'negativo' ? 'border-red-300' : 'border-slate-200'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${COLOR_CLASIFICACION[encuesta.clasificacion] || ''}`}>
                      {ETIQUETA_CLASIFICACION[encuesta.clasificacion] || encuesta.clasificacion}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">{formatoFecha(encuesta.respondido_en)}</span>
                  </div>
                  {trabajo?.id && (
                    <Link to={`/trabajos/${trabajo.id}`} className="text-xs text-slate-500 underline hover:text-slate-700">
                      Ver OT {trabajo.numero_ot}
                    </Link>
                  )}
                </div>

                <p className="mb-2 text-sm text-slate-800">
                  {nombreCliente(trabajo?.clientes)} · {trabajo?.vehiculos?.patente} — {trabajo?.vehiculos?.marca}{' '}
                  {trabajo?.vehiculos?.modelo}
                </p>

                <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  {PREGUNTAS.map((pregunta) => (
                    <div key={pregunta.clave}>
                      <p className="text-xs text-slate-500">{pregunta.etiqueta}</p>
                      <Estrellas valor={encuesta[`calificacion_${pregunta.clave}`]} />
                      {areasBajas.includes(pregunta.clave) && (
                        <p className="text-xs font-medium text-red-700">Requiere revisión</p>
                      )}
                    </div>
                  ))}
                </div>

                {encuesta.como_conocio && (
                  <p className="text-xs text-slate-500">
                    Cómo conoció: {ETIQUETA_COMO_CONOCIO[encuesta.como_conocio] || encuesta.como_conocio}
                  </p>
                )}
                {encuesta.sugerencia && (
                  <p className="mt-1 text-sm text-slate-700">
                    <span className="font-medium">Sugerencia:</span> {encuesta.sugerencia}
                  </p>
                )}
              </div>
            )
          })}

        {!cargando && encuestasFiltradas.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-400">
            Sin encuestas respondidas para este filtro.
          </p>
        )}
        {cargando && <p className="p-6 text-center text-slate-400">Cargando…</p>}
      </div>
    </div>
  )
}

export default Encuestas
