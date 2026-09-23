import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

function normalizarPatenteLocal(patente) {
  return (patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function ClienteDetalle() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { usuario } = useAuth()
  const [cliente, setCliente] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [vehiculos, setVehiculos] = useState([])
  const [mostrarFormularioVehiculo, setMostrarFormularioVehiculo] = useState(false)

  async function cargarCliente() {
    try {
      const { data, error: errorConsulta } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (errorConsulta) {
        setError(errorConsulta.message)
      } else {
        setCliente(data)
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function cargarVehiculos() {
    try {
      const { data, error: errorConsulta } = await supabase
        .from('clientes_vehiculos')
        .select('es_propietario, es_conductor, vehiculos(id, patente, marca, modelo, anio, kilometraje)')
        .eq('cliente_id', id)

      if (!errorConsulta) {
        setVehiculos(data || [])
      }
    } catch {
      // La lista de vehículos es secundaria en esta pantalla; si falla la
      // conexión, cargarCliente() ya deja el error visible.
    }
  }

  useEffect(() => {
    setCargando(true)
    Promise.all([cargarCliente(), cargarVehiculos()]).finally(() => setCargando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function guardarCambios(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)

    try {
      const { error: errorActualizar } = await supabase
        .from('clientes')
        .update({
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          razon_social: cliente.razon_social,
          rut: cliente.rut,
          telefono: cliente.telefono,
          email: cliente.email,
          direccion: cliente.direccion,
          notas: cliente.notas,
        })
        .eq('id', id)

      if (errorActualizar) {
        setError(errorActualizar.message)
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  function actualizarCampo(campo, valor) {
    setCliente((actual) => ({ ...actual, [campo]: valor }))
  }

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>
  if (!cliente) return <div className="p-6 text-slate-500">No se encontró el cliente.</div>

  return (
    <div className="p-6">
      <button
        type="button"
        onClick={() => navegar('/clientes')}
        className="mb-4 text-sm text-slate-500 hover:underline"
      >
        ← Volver a clientes
      </button>

      <h1 className="mb-4 text-xl font-semibold text-slate-900">
        {cliente.tipo === 'empresa' ? cliente.razon_social : `${cliente.nombre} ${cliente.apellido || ''}`}
      </h1>

      <form onSubmit={guardarCambios} className="mb-8 grid max-w-2xl grid-cols-2 gap-3 rounded border border-slate-200 bg-white p-4">
        {cliente.tipo === 'empresa' ? (
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Razón social</label>
            <input
              value={cliente.razon_social || ''}
              onChange={(evento) => actualizarCampo('razon_social', evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
              <input
                value={cliente.nombre || ''}
                onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Apellido</label>
              <input
                value={cliente.apellido || ''}
                onChange={(evento) => actualizarCampo('apellido', evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">RUT</label>
          <input
            value={cliente.rut || ''}
            onChange={(evento) => actualizarCampo('rut', evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
          <input
            value={cliente.telefono || ''}
            onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
          <input
            value={cliente.email || ''}
            onChange={(evento) => actualizarCampo('email', evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Dirección</label>
          <input
            value={cliente.direccion || ''}
            onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-700">Notas</label>
          <textarea
            value={cliente.notas || ''}
            onChange={(evento) => actualizarCampo('notas', evento.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

        <div className="col-span-2">
          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      <div className="max-w-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Vehículos</h2>
          <button
            type="button"
            onClick={() => setMostrarFormularioVehiculo(true)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Agregar vehículo
          </button>
        </div>

        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Patente</th>
                <th className="px-3 py-2">Marca / Modelo</th>
                <th className="px-3 py-2">Año</th>
                <th className="px-3 py-2">Kilometraje</th>
              </tr>
            </thead>
            <tbody>
              {vehiculos.map(({ vehiculos: vehiculo }) => (
                <tr key={vehiculo.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{vehiculo.patente}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {vehiculo.marca} {vehiculo.modelo}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{vehiculo.anio || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{vehiculo.kilometraje ?? '—'}</td>
                </tr>
              ))}
              {vehiculos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    Este cliente todavía no tiene vehículos registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {mostrarFormularioVehiculo && (
        <FormularioNuevoVehiculo
          clienteId={id}
          empresaId={usuario.empresa_id}
          onCancelar={() => setMostrarFormularioVehiculo(false)}
          onVinculado={() => {
            setMostrarFormularioVehiculo(false)
            cargarVehiculos()
          }}
        />
      )}
    </div>
  )
}

function FormularioNuevoVehiculo({ clienteId, empresaId, onCancelar, onVinculado }) {
  const [patente, setPatente] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [anio, setAnio] = useState('')
  const [kilometraje, setKilometraje] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [vehiculoExistente, setVehiculoExistente] = useState(null)

  async function vincularVehiculoExistente(vehiculoId) {
    setGuardando(true)
    setError(null)

    try {
      const { error: errorVinculo } = await supabase
        .from('clientes_vehiculos')
        .insert({ cliente_id: clienteId, vehiculo_id: vehiculoId, es_propietario: true })

      if (errorVinculo) {
        setError(errorVinculo.message)
        return
      }
      onVinculado()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarEnvio(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    setVehiculoExistente(null)

    try {
      const { data: nuevoVehiculo, error: errorInsercion } = await supabase
        .from('vehiculos')
        .insert({
          empresa_id: empresaId,
          patente,
          marca,
          modelo,
          anio: anio ? Number(anio) : null,
          kilometraje: kilometraje ? Number(kilometraje) : null,
        })
        .select()
        .single()

      if (errorInsercion) {
        // 23505 = violación de índice único (patente ya existe en esta empresa).
        if (errorInsercion.code === '23505') {
          const patenteNorm = normalizarPatenteLocal(patente)
          const { data: existente } = await supabase
            .from('vehiculos')
            .select('id, patente, marca, modelo')
            .eq('empresa_id', empresaId)
            .eq('patente_norm', patenteNorm)
            .maybeSingle()

          setVehiculoExistente(existente || null)
          setError('Ya existe un vehículo con esa patente en este taller.')
        } else {
          setError(errorInsercion.message)
        }
        return
      }

      const { error: errorVinculo } = await supabase
        .from('clientes_vehiculos')
        .insert({ cliente_id: clienteId, vehiculo_id: nuevoVehiculo.id, es_propietario: true })

      if (errorVinculo) {
        setError(errorVinculo.message)
        return
      }
      onVinculado()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={manejarEnvio} className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Agregar vehículo</h2>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Patente</label>
          <input
            required
            value={patente}
            onChange={(evento) => setPatente(evento.target.value)}
            placeholder="GH TY 34"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase"
          />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Marca</label>
            <input
              required
              value={marca}
              onChange={(evento) => setMarca(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Modelo</label>
            <input
              required
              value={modelo}
              onChange={(evento) => setModelo(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Año</label>
            <input
              type="number"
              value={anio}
              onChange={(evento) => setAnio(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Kilometraje</label>
            <input
              type="number"
              value={kilometraje}
              onChange={(evento) => setKilometraje(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{error}</p>
            {vehiculoExistente && (
              <button
                type="button"
                onClick={() => vincularVehiculoExistente(vehiculoExistente.id)}
                className="mt-2 rounded bg-amber-700 px-3 py-1 text-white hover:bg-amber-800"
              >
                Vincular {vehiculoExistente.patente} ({vehiculoExistente.marca} {vehiculoExistente.modelo}) a este
                cliente
              </button>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ClienteDetalle
