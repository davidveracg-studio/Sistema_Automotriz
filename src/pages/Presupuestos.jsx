import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

const ETIQUETA_ESTADO = {
  borrador: 'Borrador',
  enviado: 'Enviado · esperando respuesta',
  aceptado: 'Aceptado',
  parcial: 'Aceptado parcial',
  rechazado: 'Rechazado',
  anulado: 'Anulado',
}

const COLOR_ESTADO = {
  borrador: 'bg-slate-100 text-slate-700',
  enviado: 'bg-amber-100 text-amber-800',
  aceptado: 'bg-green-100 text-green-800',
  parcial: 'bg-blue-100 text-blue-800',
  rechazado: 'bg-red-100 text-red-800',
  anulado: 'bg-slate-100 text-slate-400',
}

function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return '—'
  return numero.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function Presupuestos() {
  const [presupuestos, setPresupuestos] = useState([])
  const [totales, setTotales] = useState({})
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { data: presupuestosData, error: errorPresupuestos } = await supabase
        .from('presupuestos_taller')
        .select(
          'id, correlativo, estado, creado_en, fecha_envio, fecha_respuesta, trabajos_taller(numero_ot, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo))'
        )
        .order('creado_en', { ascending: false })

      if (errorPresupuestos) {
        setError(errorPresupuestos.message)
        return
      }

      const ids = (presupuestosData || []).map((p) => p.id)
      let totalesPorPresupuesto = {}
      if (ids.length > 0) {
        const { data: itemsData, error: errorItems } = await supabase
          .from('ot_detalle_con_permiso')
          .select('presupuesto_id, total_linea')
          .in('presupuesto_id', ids)

        if (errorItems) {
          setError(errorItems.message)
          return
        }
        totalesPorPresupuesto = (itemsData || []).reduce((acumulado, item) => {
          const clave = item.presupuesto_id
          acumulado[clave] = (acumulado[clave] || 0) + (item.total_linea || 0)
          return acumulado
        }, {})
      }

      setPresupuestos(presupuestosData || [])
      setTotales(totalesPorPresupuesto)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  const listaFiltrada =
    filtroEstado === 'todos' ? presupuestos : presupuestos.filter((p) => p.estado === filtroEstado)
  const pendientesRespuesta = presupuestos.filter((p) => p.estado === 'enviado').length

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Presupuestos</h1>
          {pendientesRespuesta > 0 && (
            <p className="text-sm text-amber-700">
              {pendientesRespuesta} presupuesto{pendientesRespuesta === 1 ? '' : 's'} esperando respuesta del cliente.
            </p>
          )}
        </div>
        <select
          value={filtroEstado}
          onChange={(evento) => setFiltroEstado(evento.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="todos">Todos los estados</option>
          {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {cargando ? (
        <p className="text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Correlativo</th>
                <th className="px-3 py-2">OT</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Vehículo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Creado</th>
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
                    Sin presupuestos para este filtro.
                  </td>
                </tr>
              )}
              {listaFiltrada.map((p) => {
                const trabajo = Array.isArray(p.trabajos_taller) ? p.trabajos_taller[0] : p.trabajos_taller
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link to={`/presupuestos/${p.id}`} className="font-medium text-slate-800 underline hover:text-slate-900">
                        {p.correlativo}
                      </Link>
                    </td>
                    <td className="px-3 py-2">OT {trabajo?.numero_ot}</td>
                    <td className="px-3 py-2">{nombreCliente(trabajo?.clientes)}</td>
                    <td className="px-3 py-2">
                      {trabajo?.vehiculos?.patente} {trabajo?.vehiculos?.marca} {trabajo?.vehiculos?.modelo}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${COLOR_ESTADO[p.estado] || 'bg-slate-100'}`}>
                        {ETIQUETA_ESTADO[p.estado] || p.estado}
                      </span>
                    </td>
                    <td className="px-3 py-2">{formatoMoneda(totales[p.id] || 0)}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(p.creado_en).toLocaleDateString('es-CL')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default Presupuestos
