import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

import { formatearPatente } from '../lib/patente'
function Trabajos() {
  const navegar = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [trabajos, setTrabajos] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState(null)

  async function buscar(evento) {
    evento.preventDefault()
    setBuscando(true)
    setError(null)

    try {
      const termino = busqueda.trim()
      // vehiculos!inner: para que el filtro por patente_norm de más abajo
      // realmente acote las filas de trabajos_taller (con un embed normal,
      // sin !inner, PostgREST filtra el contenido del embed pero no las
      // filas del resultado principal).
      let consulta = supabase
        .from('trabajos_taller')
        .select('id, numero_ot, tipo_ingreso, estado, fecha_ingreso, clientes(nombre, apellido, razon_social), vehiculos!inner(patente, marca, modelo, patente_norm)')
        .order('fecha_ingreso', { ascending: false })
        .limit(50)

      if (termino) {
        const soloNumero = termino.replace(/\D/g, '')
        if (soloNumero) {
          consulta = consulta.eq('numero_ot', Number(soloNumero))
        } else {
          consulta = consulta.eq('vehiculos.patente_norm', termino.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        }
      }

      const { data, error: errorConsulta } = await consulta
      if (errorConsulta) {
        setError(errorConsulta.message)
      } else {
        setTrabajos(data || [])
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  function nombreCliente(cliente) {
    if (!cliente) return '—'
    return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Trabajos</h1>

      <form onSubmit={buscar} className="mb-4 flex max-w-md gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="N° de OT o patente"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={buscando}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">OT</th>
              <th className="px-3 py-2">Vehículo</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {trabajos.map((trabajo) => (
              <tr
                key={trabajo.id}
                onClick={() => navegar(`/trabajos/${trabajo.id}`)}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2 font-medium text-slate-800">{trabajo.numero_ot}</td>
                <td className="px-3 py-2 text-slate-600">
                  {formatearPatente(trabajo.vehiculos?.patente)} — {trabajo.vehiculos?.marca} {trabajo.vehiculos?.modelo}
                </td>
                <td className="px-3 py-2 text-slate-600">{nombreCliente(trabajo.clientes)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {trabajo.tipo_ingreso === 'diagnostico' ? 'Diagnóstico' : 'Servicio agendado'}
                </td>
                <td className="px-3 py-2 text-slate-600">{trabajo.estado}</td>
              </tr>
            ))}
            {trabajos.length === 0 && !buscando && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Busca por número de OT o patente para ver los trabajos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Trabajos
