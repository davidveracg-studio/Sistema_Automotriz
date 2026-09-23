import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const ETIQUETA_DECISION = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  postergado: 'Postergado',
}

function porcentaje(parte, total) {
  if (!total) return null
  return Math.round((parte / total) * 1000) / 10
}

function BarraPorcentaje({ etiqueta, valor, detalle }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-slate-700">{etiqueta}</span>
        <span className="font-medium text-slate-900">{valor === null ? '—' : `${valor}%`}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-slate-900"
          style={{ width: `${valor === null ? 0 : Math.min(valor, 100)}%` }}
        />
      </div>
      {detalle && <p className="mt-1 text-xs text-slate-400">{detalle}</p>}
    </div>
  )
}

function Tarjeta({ titulo, children }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{titulo}</h2>
      {children}
    </div>
  )
}

function Informes() {
  const [retorno, setRetorno] = useState(null)
  const [captura, setCaptura] = useState(null)
  const [presupuestos, setPresupuestos] = useState([])
  const [retrabajos, setRetrabajos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError(null)
      try {
        const [rRetorno, rCaptura, rPresupuestos, rRetrabajos] = await Promise.all([
          supabase.rpc('informe_retorno_clientes'),
          supabase.rpc('informe_captura_datos'),
          supabase.rpc('informe_presupuestos_decision'),
          supabase.rpc('informe_retrabajos_por_tecnico'),
        ])

        const primerError = [rRetorno, rCaptura, rPresupuestos, rRetrabajos].find((r) => r.error)?.error
        if (primerError) {
          setError(primerError.message)
          return
        }

        setRetorno(rRetorno.data?.[0] || null)
        setCaptura(rCaptura.data?.[0] || null)
        setPresupuestos(rPresupuestos.data || [])
        setRetrabajos(rRetrabajos.data || [])
      } catch {
        setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>

  const totalPresupuestos = presupuestos.reduce((suma, p) => suma + Number(p.cantidad), 0)
  const totalRetrabajos = retrabajos.reduce((suma, r) => suma + Number(r.cantidad), 0)

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Informes</h1>
      <p className="mb-4 text-sm text-slate-500">
        Los tres números que definen el estado del negocio. Desconfía de los indicadores perfectos: un 100% casi
        siempre significa que la medición está mal hecha, no que el negocio sea impecable.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Tarjeta titulo="Clientes que vuelven">
          {retorno && retorno.total_clientes > 0 ? (
            <>
              <BarraPorcentaje
                etiqueta="Con más de una OT"
                valor={porcentaje(retorno.con_mas_de_una_ot, retorno.total_clientes)}
                detalle={`${retorno.con_mas_de_una_ot} de ${retorno.total_clientes} clientes`}
              />
              <BarraPorcentaje
                etiqueta="Vienen una sola vez"
                valor={porcentaje(retorno.con_una_sola_ot, retorno.total_clientes)}
                detalle={`${retorno.con_una_sola_ot} de ${retorno.total_clientes} clientes`}
              />
            </>
          ) : (
            <p className="text-sm text-slate-400">Sin datos todavía.</p>
          )}
        </Tarjeta>

        <Tarjeta titulo="Captura de datos en el ingreso">
          {captura ? (
            <>
              <BarraPorcentaje
                etiqueta="Clientes con RUT"
                valor={porcentaje(captura.clientes_con_rut, captura.total_clientes)}
                detalle={`${captura.clientes_con_rut} de ${captura.total_clientes} clientes`}
              />
              <BarraPorcentaje
                etiqueta="OT con kilometraje registrado"
                valor={porcentaje(captura.trabajos_con_kilometraje, captura.total_trabajos)}
                detalle={`${captura.trabajos_con_kilometraje} de ${captura.total_trabajos} OT`}
              />
            </>
          ) : (
            <p className="text-sm text-slate-400">Sin datos todavía.</p>
          )}
        </Tarjeta>

        <Tarjeta titulo="Presupuestos por decisión">
          {presupuestos.length > 0 ? (
            <>
              {presupuestos.map((p) => (
                <BarraPorcentaje
                  key={p.decision}
                  etiqueta={ETIQUETA_DECISION[p.decision] || p.decision}
                  valor={porcentaje(p.cantidad, totalPresupuestos)}
                  detalle={`${p.cantidad} de ${totalPresupuestos} ítems`}
                />
              ))}
            </>
          ) : (
            <p className="text-sm text-slate-400">Sin ítems valorizados todavía.</p>
          )}
        </Tarjeta>

        <Tarjeta titulo="Retrabajos por técnico">
          {retrabajos.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1">Técnico</th>
                  <th className="py-1 text-right">Retrabajos</th>
                </tr>
              </thead>
              <tbody>
                {retrabajos.map((r) => (
                  <tr key={r.tecnico} className="border-t border-slate-100">
                    <td className="py-1 text-slate-800">{r.tecnico}</td>
                    <td className="py-1 text-right text-slate-600">{r.cantidad}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-medium">
                  <td className="py-1 text-slate-800">Total</td>
                  <td className="py-1 text-right text-slate-800">{totalRetrabajos}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-400">
              Sin retrabajos registrados todavía. Se marcan al crear un ingreso nuevo para un vehículo que ya
              tiene una OT anterior por el mismo problema.
            </p>
          )}
        </Tarjeta>
      </div>
    </div>
  )
}

export default Informes
