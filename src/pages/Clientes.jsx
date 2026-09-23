import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

const CAMPOS_LISTA = 'id, tipo, nombre, apellido, razon_social, rut, telefono, email'

function nombreVisible(cliente) {
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function Clientes() {
  const { usuario } = useAuth()
  const navegar = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [clientes, setClientes] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)

  async function buscar(evento) {
    evento?.preventDefault()
    setBuscando(true)
    setError(null)

    try {
      const termino = busqueda.trim()
      let consulta = supabase
        .from('clientes')
        .select(CAMPOS_LISTA)
        .is('eliminado_en', null)
        .order('creado_en', { ascending: false })
        .limit(50)

      if (termino) {
        const soloDigitos = termino.replace(/\D/g, '')
        const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
        if (soloDigitos) {
          condiciones.push(`rut_norm.ilike.%${soloDigitos}%`)
          condiciones.push(`telefono_norm.ilike.%${soloDigitos}%`)
        }
        consulta = consulta.or(condiciones.join(','))
      }

      const { data, error: errorConsulta } = await consulta

      if (errorConsulta) {
        setError(errorConsulta.message)
      } else {
        setClientes(data)
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
        <button
          type="button"
          onClick={() => setMostrarFormulario(true)}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Nuevo cliente
        </button>
      </div>

      <form onSubmit={buscar} className="mb-4 flex gap-2">
        <input
          type="text"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar por nombre, RUT o teléfono…"
          className="w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm"
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
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">RUT</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Correo</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((cliente) => (
              <tr
                key={cliente.id}
                onClick={() => navegar(`/clientes/${cliente.id}`)}
                className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2 font-medium text-slate-800">{nombreVisible(cliente)}</td>
                <td className="px-3 py-2 text-slate-600">{cliente.rut || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{cliente.telefono || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{cliente.email || '—'}</td>
              </tr>
            ))}
            {clientes.length === 0 && !buscando && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  Sin resultados. Busca por nombre, RUT o teléfono, o crea un cliente nuevo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mostrarFormulario && (
        <FormularioNuevoCliente
          empresaId={usuario.empresa_id}
          onCancelar={() => setMostrarFormulario(false)}
          onCreado={(cliente) => {
            setMostrarFormulario(false)
            navegar(`/clientes/${cliente.id}`)
          }}
        />
      )}
    </div>
  )
}

function FormularioNuevoCliente({ empresaId, onCancelar, onCreado }) {
  const [tipo, setTipo] = useState('persona')
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [rut, setRut] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [duplicados, setDuplicados] = useState([])
  const [revisandoDuplicados, setRevisandoDuplicados] = useState(false)
  const [confirmadoPeseADuplicados, setConfirmadoPeseADuplicados] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function revisarDuplicados() {
    const nombreParaComparar = tipo === 'empresa' ? razonSocial : `${nombre} ${apellido}`.trim()
    if (!rut && !telefono && !nombreParaComparar) return

    setRevisandoDuplicados(true)
    try {
      const { data, error: errorRpc } = await supabase.rpc('clientes_buscar_posibles_duplicados', {
        p_rut: rut || null,
        p_telefono: telefono || null,
        p_nombre: nombreParaComparar || null,
      })
      if (!errorRpc) {
        setDuplicados(data || [])
        setConfirmadoPeseADuplicados(false)
      }
    } catch {
      // Revisión de duplicados es una ayuda, no un paso obligatorio: si falla
      // la conexión, se deja pasar en silencio.
    } finally {
      setRevisandoDuplicados(false)
    }
  }

  async function manejarEnvio(evento) {
    evento.preventDefault()

    if (duplicados.length > 0 && !confirmadoPeseADuplicados) {
      return
    }

    setGuardando(true)
    setError(null)

    try {
      const { data, error: errorInsercion } = await supabase
        .from('clientes')
        .insert({
          empresa_id: empresaId,
          tipo,
          nombre: tipo === 'empresa' ? razonSocial : nombre,
          apellido: tipo === 'persona' ? apellido || null : null,
          razon_social: tipo === 'empresa' ? razonSocial : null,
          rut: rut || null,
          telefono: telefono || null,
          email: email || null,
        })
        .select()
        .single()

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }

      onCreado(data)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    // items-start + overflow-y-auto (no items-center sin overflow): la lista de
    // posibles duplicados no tiene límite visual -el RPC devuelve hasta 10- y con
    // varios duplicados el formulario supera el alto de pantalla. Este modal ni
    // siquiera tenía overflow-y-auto, así que sin este fix no hay forma de hacer
    // scroll: el botón "Guardar" queda inalcanzable, no solo el encabezado -peor
    // que el bug de FormularioNuevaCita en Agenda.jsx (con items-center +
    // overflow-y-auto, el contenido se centra con un offset NEGATIVO que
    // overflow-y-auto tampoco puede alcanzar). Confirmado en el navegador con 10
    // duplicados (el máximo real que devuelve clientes_buscar_posibles_duplicados).
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <form
        onSubmit={manejarEnvio}
        className="my-8 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg"
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Nuevo cliente</h2>

        <div className="mb-4 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={tipo === 'persona'} onChange={() => setTipo('persona')} />
            Persona
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={tipo === 'empresa'} onChange={() => setTipo('empresa')} />
            Empresa
          </label>
        </div>

        {tipo === 'persona' ? (
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
              <input
                required
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                onBlur={revisarDuplicados}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Apellido</label>
              <input
                value={apellido}
                onChange={(evento) => setApellido(evento.target.value)}
                onBlur={revisarDuplicados}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Razón social</label>
            <input
              required
              value={razonSocial}
              onChange={(evento) => setRazonSocial(evento.target.value)}
              onBlur={revisarDuplicados}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">RUT</label>
            <input
              value={rut}
              onChange={(evento) => setRut(evento.target.value)}
              onBlur={revisarDuplicados}
              placeholder="12.345.678-9"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Teléfono</label>
            <input
              value={telefono}
              onChange={(evento) => setTelefono(evento.target.value)}
              onBlur={revisarDuplicados}
              placeholder="+56 9 1234 5678"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Correo</label>
          <input
            type="email"
            value={email}
            onChange={(evento) => setEmail(evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {revisandoDuplicados && <p className="mb-3 text-xs text-slate-400">Revisando posibles duplicados…</p>}

        {duplicados.length > 0 && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-2 font-medium">Ya existen clientes parecidos:</p>
            <ul className="mb-2 space-y-1">
              {duplicados.map((posible) => (
                <li key={posible.id}>
                  {posible.nombre} {posible.apellido || posible.razon_social || ''} — {posible.rut || 'sin RUT'} —{' '}
                  {posible.telefono || 'sin teléfono'}
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmadoPeseADuplicados}
                onChange={(evento) => setConfirmadoPeseADuplicados(evento.target.checked)}
              />
              Igual es un cliente distinto, crear de todas formas.
            </label>
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
            disabled={guardando || (duplicados.length > 0 && !confirmadoPeseADuplicados)}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default Clientes
