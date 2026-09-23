import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return '—'
  return Number(numero).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

function nombreVisible(cliente) {
  if (!cliente) return ''
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function PuntoVenta() {
  const { usuario } = useAuth()
  const [productos, setProductos] = useState([])
  const [ventaActual, setVentaActual] = useState(null)
  const [lineas, setLineas] = useState([])
  const [historial, setHistorial] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  // --- Agregar servicio ----------------------------------------------------
  const [detalleServicio, setDetalleServicio] = useState('')
  const [cantidadServicio, setCantidadServicio] = useState('1')
  const [precioServicio, setPrecioServicio] = useState('')

  // --- Agregar producto ------------------------------------------------------
  const [productoId, setProductoId] = useState('')
  const [cantidadProducto, setCantidadProducto] = useState('1')
  const [precioProducto, setPrecioProducto] = useState('')

  // --- Cierre / cobro ---------------------------------------------------------
  const [terminoCliente, setTerminoCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [cerrando, setCerrando] = useState(false)

  const [guardando, setGuardando] = useState(false)

  async function cargarProductos() {
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, stock_actual, unidad_medida')
      .eq('activo', true)
      .order('nombre')
    setProductos(data || [])
  }

  async function cargarLineas(ventaId) {
    if (!ventaId) {
      setLineas([])
      return
    }
    const { data, error: errorLineas } = await supabase
      .from('ventas_directas_detalle')
      .select('id, tipo, detalle, cantidad, precio_unitario, total_linea')
      .eq('venta_id', ventaId)
      .order('creado_en')
    if (errorLineas) {
      setError(errorLineas.message)
      return
    }
    setLineas(data || [])
  }

  async function cargarHistorial() {
    const { data } = await supabase
      .from('ventas_directas')
      .select(
        'id, numero_documento_facturacion, cerrada_en, clientes(nombre, apellido, razon_social), ventas_directas_detalle(total_linea)'
      )
      .eq('estado', 'cerrada')
      .order('cerrada_en', { ascending: false })
      .limit(10)
    setHistorial(data || [])
  }

  useEffect(() => {
    async function inicializar() {
      setCargando(true)
      try {
        await Promise.all([cargarProductos(), cargarHistorial()])
      } catch {
        setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    inicializar()
  }, [])

  async function asegurarVenta() {
    if (ventaActual) return ventaActual
    const { data, error: errorVenta } = await supabase
      .from('ventas_directas')
      .insert({ empresa_id: usuario.empresa_id, creado_por: usuario.id })
      .select()
      .single()
    if (errorVenta) {
      setError(errorVenta.message)
      return null
    }
    setVentaActual(data)
    return data
  }

  async function agregarServicio(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    try {
      const venta = await asegurarVenta()
      if (!venta) return

      const { error: errorInsercion } = await supabase.from('ventas_directas_detalle').insert({
        venta_id: venta.id,
        tipo: 'servicio',
        detalle: detalleServicio,
        cantidad: Number(cantidadServicio) || 1,
        precio_unitario: Number(precioServicio) || 0,
      })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setDetalleServicio('')
      setCantidadServicio('1')
      setPrecioServicio('')
      await cargarLineas(venta.id)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function agregarProducto(evento) {
    evento.preventDefault()
    const producto = productos.find((p) => p.id === productoId)
    if (!producto) return

    setGuardando(true)
    setError(null)
    try {
      const venta = await asegurarVenta()
      if (!venta) return

      const { error: errorInsercion } = await supabase.from('ventas_directas_detalle').insert({
        venta_id: venta.id,
        tipo: 'producto',
        producto_id: producto.id,
        detalle: producto.nombre,
        cantidad: Number(cantidadProducto) || 1,
        precio_unitario: Number(precioProducto) || 0,
      })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setProductoId('')
      setCantidadProducto('1')
      setPrecioProducto('')
      await Promise.all([cargarLineas(venta.id), cargarProductos()])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function quitarLinea(id) {
    setError(null)
    try {
      const { error: errorEliminar } = await supabase.from('ventas_directas_detalle').delete().eq('id', id)
      if (errorEliminar) {
        setError(errorEliminar.message)
        return
      }
      await Promise.all([cargarLineas(ventaActual.id), cargarProductos()])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function buscarCliente(evento) {
    evento.preventDefault()
    setError(null)
    try {
      const termino = terminoCliente.trim()
      const soloDigitos = termino.replace(/\D/g, '')
      let consulta = supabase
        .from('clientes')
        .select('id, tipo, nombre, apellido, razon_social, telefono')
        .is('eliminado_en', null)
        .limit(10)
      const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
      if (soloDigitos) condiciones.push(`telefono_norm.ilike.%${soloDigitos}%`)
      consulta = consulta.or(condiciones.join(','))

      const { data, error: errorConsulta } = await consulta
      if (errorConsulta) {
        setError(errorConsulta.message)
        return
      }
      setResultadosCliente(data || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function cerrarVenta(evento) {
    evento.preventDefault()
    if (!ventaActual || lineas.length === 0) return
    setCerrando(true)
    setError(null)
    try {
      const { error: errorCierre } = await supabase
        .from('ventas_directas')
        .update({
          estado: 'cerrada',
          cerrada_en: new Date().toISOString(),
          cliente_id: clienteSeleccionado?.id || null,
          numero_documento_facturacion: numeroDocumento || null,
        })
        .eq('id', ventaActual.id)
      if (errorCierre) {
        setError(errorCierre.message)
        return
      }
      setVentaActual(null)
      setLineas([])
      setClienteSeleccionado(null)
      setTerminoCliente('')
      setResultadosCliente([])
      setNumeroDocumento('')
      await cargarHistorial()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCerrando(false)
    }
  }

  const total = lineas.reduce((suma, l) => suma + Number(l.total_linea || 0), 0)

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Punto de venta</h1>
      <p className="mb-4 text-sm text-slate-500">
        Venta de mostrador sin orden de trabajo: servicios rápidos o productos de bodega como venta libre.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Agregar servicio rápido</h2>
          <form onSubmit={agregarServicio}>
            <input
              required
              value={detalleServicio}
              onChange={(evento) => setDetalleServicio(evento.target.value)}
              placeholder="Ej. Inflado de neumáticos"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="mb-2 flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={cantidadServicio}
                onChange={(evento) => setCantidadServicio(evento.target.value)}
                className="w-20 rounded border border-slate-300 px-3 py-2 text-sm"
                title="Cantidad"
              />
              <input
                required
                type="number"
                min="0"
                value={precioServicio}
                onChange={(evento) => setPrecioServicio(evento.target.value)}
                placeholder="Precio"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={guardando}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Agregar
            </button>
          </form>
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Agregar producto de bodega</h2>
          <form onSubmit={agregarProducto}>
            <select
              required
              value={productoId}
              onChange={(evento) => setProductoId(evento.target.value)}
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Elegir producto…</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} (stock {p.stock_actual} {p.unidad_medida})
                </option>
              ))}
            </select>
            <div className="mb-2 flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={cantidadProducto}
                onChange={(evento) => setCantidadProducto(evento.target.value)}
                className="w-20 rounded border border-slate-300 px-3 py-2 text-sm"
                title="Cantidad"
              />
              <input
                required
                type="number"
                min="0"
                value={precioProducto}
                onChange={(evento) => setPrecioProducto(evento.target.value)}
                placeholder="Precio"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={guardando}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Agregar
            </button>
          </form>
        </section>
      </div>

      <section className="mt-6 max-w-4xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Venta actual</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Detalle</th>
                <th className="px-3 py-2">Cant.</th>
                <th className="px-3 py-2">Precio</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea) => (
                <tr key={linea.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-800">{linea.detalle}</td>
                  <td className="px-3 py-2 text-slate-600">{linea.cantidad}</td>
                  <td className="px-3 py-2 text-slate-600">{formatoMoneda(linea.precio_unitario)}</td>
                  <td className="px-3 py-2 text-slate-800">{formatoMoneda(linea.total_linea)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => quitarLinea(linea.id)}
                      className="text-xs text-red-600 underline hover:text-red-800"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
              {lineas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Sin ítems todavía. Agrega un servicio o un producto arriba.
                  </td>
                </tr>
              )}
            </tbody>
            {lineas.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 font-medium">
                  <td className="px-3 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-slate-900">{formatoMoneda(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {lineas.length > 0 && (
          <form onSubmit={cerrarVenta} className="mt-4 rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-700">Cobrar</h3>

            {clienteSeleccionado ? (
              <div className="mb-2 flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span>{nombreVisible(clienteSeleccionado)}</span>
                <button
                  type="button"
                  onClick={() => setClienteSeleccionado(null)}
                  className="text-xs text-slate-500 underline hover:text-slate-700"
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <div className="mb-2">
                <div className="mb-1 flex gap-2">
                  <input
                    value={terminoCliente}
                    onChange={(evento) => setTerminoCliente(evento.target.value)}
                    placeholder="Cliente (opcional): nombre o teléfono"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={buscarCliente}
                    className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Buscar
                  </button>
                </div>
                {resultadosCliente.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {resultadosCliente.map((cliente) => (
                      <li key={cliente.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setClienteSeleccionado(cliente)
                            setResultadosCliente([])
                          }}
                          className="text-slate-700 underline hover:text-slate-900"
                        >
                          {nombreVisible(cliente)} {cliente.telefono ? `· ${cliente.telefono}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <input
              value={numeroDocumento}
              onChange={(evento) => setNumeroDocumento(evento.target.value)}
              placeholder="N° de documento (Dimasoft, opcional)"
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            <button
              type="submit"
              disabled={cerrando}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {cerrando ? 'Cerrando…' : `Cerrar venta · ${formatoMoneda(total)}`}
            </button>
          </form>
        )}
      </section>

      <section className="mt-8 max-w-4xl">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Ventas recientes</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Documento</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((venta) => (
                <tr key={venta.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">
                    {venta.cerrada_en ? new Date(venta.cerrada_en).toLocaleString('es-CL') : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-800">{nombreVisible(venta.clientes) || 'Sin identificar'}</td>
                  <td className="px-3 py-2 text-slate-600">{venta.numero_documento_facturacion || '—'}</td>
                  <td className="px-3 py-2 text-slate-800">
                    {formatoMoneda((venta.ventas_directas_detalle || []).reduce((s, d) => s + Number(d.total_linea || 0), 0))}
                  </td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    Sin ventas registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default PuntoVenta
