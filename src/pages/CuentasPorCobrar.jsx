import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

import { formatearPatente } from '../lib/patente'
import { calcularDescuentoManoObra } from '../lib/descuento'
function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return '—'
  return numero.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function estaVencida(fechaVencimiento) {
  if (!fechaVencimiento) return false
  return new Date(fechaVencimiento) < new Date(new Date().toDateString())
}

function CuentasPorCobrar() {
  const [facturas, setFacturas] = useState([])
  const [totales, setTotales] = useState({})
  const [filtro, setFiltro] = useState('pendiente')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [actualizando, setActualizando] = useState(null)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { data: facturasData, error: errorFacturas } = await supabase
        .from('trabajos_taller')
        .select(
          'id, numero_ot, descuento_mano_obra_pct, numero_documento_facturacion, estado_pago, fecha_vencimiento_pago, fecha_pago, fecha_entrega, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)'
        )
        .eq('tipo_documento', 'factura')
        .order('fecha_vencimiento_pago', { ascending: true, nullsFirst: false })

      if (errorFacturas) {
        setError(errorFacturas.message)
        return
      }

      const ids = (facturasData || []).map((f) => f.id)
      let totalesPorTrabajo = {}
      if (ids.length > 0) {
        const { data: itemsData, error: errorItems } = await supabase
          .from('ot_detalle_con_permiso')
          .select('trabajo_id, area, total_linea')
          .eq('decision', 'aceptado')
          .in('trabajo_id', ids)

        if (errorItems) {
          setError(errorItems.message)
          return
        }
        const itemsPorTrabajo = (itemsData || []).reduce((acumulado, item) => {
          if (!acumulado[item.trabajo_id]) acumulado[item.trabajo_id] = []
          acumulado[item.trabajo_id].push(item)
          return acumulado
        }, {})
        // Total con el descuento de mano de obra ya aplicado, igual que la orden de egreso.
        for (const factura of facturasData || []) {
          totalesPorTrabajo[factura.id] = calcularDescuentoManoObra(itemsPorTrabajo[factura.id] || [], factura.descuento_mano_obra_pct).total
        }
      }

      setFacturas(facturasData || [])
      setTotales(totalesPorTrabajo)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function marcarPagada(trabajoId) {
    setActualizando(trabajoId)
    try {
      const { error: errorUpdate } = await supabase
        .from('trabajos_taller')
        .update({ estado_pago: 'pagado', fecha_pago: new Date().toISOString() })
        .eq('id', trabajoId)
      if (errorUpdate) {
        setError(errorUpdate.message)
        return
      }
      await cargar()
    } finally {
      setActualizando(null)
    }
  }

  const listaFiltrada = filtro === 'todas' ? facturas : facturas.filter((f) => f.estado_pago === filtro)
  const totalPendiente = facturas
    .filter((f) => f.estado_pago === 'pendiente')
    .reduce((acumulado, f) => acumulado + (totales[f.id] || 0), 0)

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cuentas por cobrar</h1>
          <p className="text-sm text-slate-500">Facturas pendientes de pago: {formatoMoneda(totalPendiente)}</p>
        </div>
        <select
          value={filtro}
          onChange={(evento) => setFiltro(evento.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="pendiente">Pendientes</option>
          <option value="pagado">Pagadas</option>
          <option value="todas">Todas</option>
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
                <th className="px-3 py-2">OT</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Vehículo</th>
                <th className="px-3 py-2">Factura N°</th>
                <th className="px-3 py-2">Vence</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-slate-400">
                    Sin facturas para este filtro.
                  </td>
                </tr>
              )}
              {listaFiltrada.map((f) => {
                const vencida = f.estado_pago === 'pendiente' && estaVencida(f.fecha_vencimiento_pago)
                return (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link to={`/trabajos/${f.id}`} className="underline hover:text-slate-900">
                        OT {f.numero_ot}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{nombreCliente(f.clientes)}</td>
                    <td className="px-3 py-2">
                      {formatearPatente(f.vehiculos?.patente)} {f.vehiculos?.marca} {f.vehiculos?.modelo}
                    </td>
                    <td className="px-3 py-2">{f.numero_documento_facturacion}</td>
                    <td className={`px-3 py-2 ${vencida ? 'font-medium text-red-600' : ''}`}>
                      {f.fecha_vencimiento_pago || '—'}
                      {vencida && ' (vencida)'}
                    </td>
                    <td className="px-3 py-2">{formatoMoneda(totales[f.id] || 0)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          f.estado_pago === 'pagado' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {f.estado_pago === 'pagado' ? 'Pagada' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {f.estado_pago === 'pendiente' && (
                        <button
                          type="button"
                          disabled={actualizando === f.id}
                          onClick={() => marcarPagada(f.id)}
                          className="rounded border border-green-300 bg-green-50 px-2 py-1 text-xs text-green-800 hover:bg-green-100 disabled:opacity-50"
                        >
                          Marcar pagada
                        </button>
                      )}
                    </td>
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

export default CuentasPorCobrar
