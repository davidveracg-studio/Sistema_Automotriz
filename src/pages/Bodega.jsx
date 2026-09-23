import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

const ETIQUETA_MOTIVO = {
  compra: 'Compra',
  ajuste: 'Ajuste',
  devolucion: 'Devolución',
}

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return '—'
  return Number(numero).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function Bodega() {
  const { usuario } = useAuth()
  const [productos, setProductos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [mostrarNuevoProducto, setMostrarNuevoProducto] = useState(false)
  const [productoParaMovimiento, setProductoParaMovimiento] = useState(null)
  const [mostrarProveedores, setMostrarProveedores] = useState(false)

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const [{ data: productosData, error: errorProductos }, { data: proveedoresData, error: errorProveedores }] =
        await Promise.all([
          supabase
            .from('productos')
            .select('id, codigo, nombre, categoria, unidad_medida, costo_promedio, stock_actual, stock_minimo')
            .eq('activo', true)
            .order('nombre'),
          supabase.from('proveedores').select('id, nombre, contacto, telefono, email').eq('activo', true).order('nombre'),
        ])

      if (errorProductos) {
        setError(errorProductos.message)
        return
      }
      if (errorProveedores) {
        setError(errorProveedores.message)
        return
      }
      setProductos(productosData || [])
      setProveedores(proveedoresData || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Bodega</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMostrarProveedores(true)}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Proveedores
          </button>
          <button
            type="button"
            onClick={() => setMostrarNuevoProducto(true)}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Nuevo producto
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Stock</th>
              <th className="px-3 py-2">Costo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!cargando &&
              productos.map((p) => {
                const stockBajo = Number(p.stock_actual) <= Number(p.stock_minimo)
                return (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{p.codigo || '—'}</td>
                    <td className="px-3 py-2 text-slate-800">{p.nombre}</td>
                    <td className="px-3 py-2 text-slate-600">{p.categoria || '—'}</td>
                    <td className={`px-3 py-2 ${stockBajo ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                      {p.stock_actual} {p.unidad_medida}
                      {stockBajo && ' ⚠ bajo mínimo'}
                      <p className="text-xs text-slate-400">mínimo {p.stock_minimo}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{formatoMoneda(p.costo_promedio)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setProductoParaMovimiento(p)}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        Registrar movimiento
                      </button>
                    </td>
                  </tr>
                )
              })}
            {!cargando && productos.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Sin productos en el catálogo todavía.
                </td>
              </tr>
            )}
            {cargando && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mostrarNuevoProducto && (
        <FormularioProducto
          empresaId={usuario.empresa_id}
          onCancelar={() => setMostrarNuevoProducto(false)}
          onCreado={() => {
            setMostrarNuevoProducto(false)
            cargar()
          }}
        />
      )}

      {productoParaMovimiento && (
        <FormularioMovimiento
          empresaId={usuario.empresa_id}
          usuarioId={usuario.id}
          producto={productoParaMovimiento}
          proveedores={proveedores}
          onCancelar={() => setProductoParaMovimiento(null)}
          onRegistrado={() => {
            setProductoParaMovimiento(null)
            cargar()
          }}
        />
      )}

      {mostrarProveedores && (
        <PanelProveedores
          empresaId={usuario.empresa_id}
          proveedores={proveedores}
          onCerrar={() => setMostrarProveedores(false)}
          onCambio={cargar}
        />
      )}
    </div>
  )
}

function FormularioProducto({ empresaId, onCancelar, onCreado }) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('')
  const [unidadMedida, setUnidadMedida] = useState('unidad')
  const [stockInicial, setStockInicial] = useState('0')
  const [stockMinimo, setStockMinimo] = useState('0')
  const [costoInicial, setCostoInicial] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function manejarEnvio(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const { data: producto, error: errorInsercion } = await supabase
        .from('productos')
        .insert({
          empresa_id: empresaId,
          codigo: codigo || null,
          nombre,
          categoria: categoria || null,
          unidad_medida: unidadMedida,
          stock_minimo: Number(stockMinimo) || 0,
          costo_promedio: costoInicial ? Number(costoInicial) : null,
        })
        .select()
        .single()

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }

      const cantidadInicial = Number(stockInicial) || 0
      if (cantidadInicial > 0) {
        const { error: errorMovimiento } = await supabase.from('movimientos_stock').insert({
          empresa_id: empresaId,
          producto_id: producto.id,
          cantidad: cantidadInicial,
          costo_unitario: costoInicial ? Number(costoInicial) : null,
          motivo: 'ajuste',
          referencia: 'Stock inicial al crear el producto',
        })
        if (errorMovimiento) {
          setError(errorMovimiento.message)
          return
        }
      }

      onCreado()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/30 p-4">
      <form onSubmit={manejarEnvio} className="my-8 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Nuevo producto</h2>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Código (opcional)</label>
            <input
              value={codigo}
              onChange={(evento) => setCodigo(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Categoría (opcional)</label>
            <input
              value={categoria}
              onChange={(evento) => setCategoria(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
          <input
            required
            value={nombre}
            onChange={(evento) => setNombre(evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Unidad de medida</label>
            <input
              value={unidadMedida}
              onChange={(evento) => setUnidadMedida(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Costo unitario (opcional)</label>
            <input
              type="number"
              min="0"
              value={costoInicial}
              onChange={(evento) => setCostoInicial(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Stock inicial</label>
            <input
              type="number"
              min="0"
              value={stockInicial}
              onChange={(evento) => setStockInicial(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Stock mínimo</label>
            <input
              type="number"
              min="0"
              value={stockMinimo}
              onChange={(evento) => setStockMinimo(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

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

function FormularioMovimiento({ empresaId, usuarioId, producto, proveedores, onCancelar, onRegistrado }) {
  const [motivo, setMotivo] = useState('compra')
  const [direccion, setDireccion] = useState('entrada')
  const [cantidad, setCantidad] = useState('')
  const [costoUnitario, setCostoUnitario] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function manejarEnvio(evento) {
    evento.preventDefault()
    const cantidadNumero = Number(cantidad)
    if (!cantidadNumero || cantidadNumero <= 0) {
      setError('La cantidad debe ser mayor a cero.')
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const { error: errorInsercion } = await supabase.from('movimientos_stock').insert({
        empresa_id: empresaId,
        producto_id: producto.id,
        cantidad: direccion === 'entrada' ? cantidadNumero : -cantidadNumero,
        costo_unitario: costoUnitario ? Number(costoUnitario) : null,
        motivo,
        proveedor_id: motivo === 'compra' && proveedorId ? proveedorId : null,
        referencia: referencia || null,
        creado_por: usuarioId,
      })

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      onRegistrado()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/30 p-4">
      <form onSubmit={manejarEnvio} className="my-8 w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Registrar movimiento</h2>
        <p className="mb-4 text-sm text-slate-500">
          {producto.nombre} · stock actual: {producto.stock_actual} {producto.unidad_medida}
        </p>

        <div className="mb-3 flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={direccion === 'entrada'} onChange={() => setDireccion('entrada')} />
            Entrada
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={direccion === 'salida'} onChange={() => setDireccion('salida')} />
            Salida
          </label>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Motivo</label>
          <select
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {Object.entries(ETIQUETA_MOTIVO).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>

        {motivo === 'compra' && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Proveedor (opcional)</label>
            <select
              value={proveedorId}
              onChange={(evento) => setProveedorId(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin especificar</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Cantidad</label>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={cantidad}
              onChange={(evento) => setCantidad(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Costo unitario (opcional)</label>
            <input
              type="number"
              min="0"
              value={costoUnitario}
              onChange={(evento) => setCostoUnitario(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Referencia (opcional)</label>
          <input
            value={referencia}
            onChange={(evento) => setReferencia(evento.target.value)}
            placeholder="N° de factura, motivo del ajuste…"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

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
            disabled={guardando}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PanelProveedores({ empresaId, proveedores, onCerrar, onCambio }) {
  const [creando, setCreando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [contacto, setContacto] = useState('')
  const [telefono, setTelefono] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function crearProveedor(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const { error: errorInsercion } = await supabase.from('proveedores').insert({
        empresa_id: empresaId,
        nombre,
        contacto: contacto || null,
        telefono: telefono || null,
      })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setNombre('')
      setContacto('')
      setTelefono('')
      setCreando(false)
      onCambio()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    // items-start (no items-center): la lista de proveedores no tiene límite
    // (se trae completa, sin paginar) y con varios proveedores el panel supera
    // el alto de pantalla -mismo bug de FormularioNuevaCita en Agenda.jsx:
    // con items-center, el contenido centrado se desplaza hacia arriba con un
    // offset NEGATIVO que overflow-y-auto no puede alcanzar (scrollTop no baja
    // de 0). Confirmado en el navegador con una lista larga de proveedores.
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="my-8 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Proveedores</h2>
          <button type="button" onClick={onCerrar} className="text-sm text-slate-500 underline hover:text-slate-700">
            Cerrar
          </button>
        </div>

        <ul className="mb-4 divide-y divide-slate-100 rounded border border-slate-200">
          {proveedores.map((p) => (
            <li key={p.id} className="px-3 py-2 text-sm">
              <p className="text-slate-800">{p.nombre}</p>
              <p className="text-xs text-slate-500">{[p.contacto, p.telefono, p.email].filter(Boolean).join(' · ')}</p>
            </li>
          ))}
          {proveedores.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">Sin proveedores todavía.</li>}
        </ul>

        {!creando ? (
          <button
            type="button"
            onClick={() => setCreando(true)}
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            + Proveedor nuevo
          </button>
        ) : (
          <form onSubmit={crearProveedor} className="border-t border-slate-100 pt-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <input
                required
                placeholder="Nombre"
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Contacto"
                value={contacto}
                onChange={(evento) => setContacto(evento.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Teléfono"
                value={telefono}
                onChange={(evento) => setTelefono(evento.target.value)}
                className="col-span-2 rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={guardando}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Crear proveedor'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default Bodega
