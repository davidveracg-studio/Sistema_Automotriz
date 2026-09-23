import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { invocarFuncion } from '../lib/invocarFuncion'
import FirmaCanvas from '../components/FirmaCanvas'

const ETIQUETA_AREA = {
  mano_obra: 'Mano de obra',
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes e insumos',
  servicios_externos: 'Servicios externos',
}

const ROLES_CON_ACCESO_MONTOS = ['socia', 'admin', 'encargado_presupuestos', 'jefe_taller']

const ETIQUETA_DECISION = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  postergado: 'Postergado',
}

const ETIQUETA_CARROCERIA = {
  sedan: 'Sedán',
  hatchback: 'Hatchback',
  suv: 'SUV',
  furgon: 'Furgón',
  pickup: 'Pick up',
}

function formatoMoneda(numero) {
  if (numero === null || numero === undefined) return '—'
  return numero.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}

// "El sistema avisa si el presupuesto final se aleja demasiado" del precio
// referencial que se mostró con el cliente presente durante el RADAR.
const UMBRAL_DIVERGENCIA_PRECIO = 0.2

function precioSeAlejaDelReferencial(item) {
  if (item.hallazgo_precio_referencial == null || item.precio_unitario == null) return false
  if (item.hallazgo_precio_referencial === 0) return item.precio_unitario !== 0
  const diferencia = Math.abs(item.precio_unitario - item.hallazgo_precio_referencial) / item.hallazgo_precio_referencial
  return diferencia > UMBRAL_DIVERGENCIA_PRECIO
}

function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function TrabajoDetalle() {
  const { id } = useParams()
  const { usuario } = useAuth()
  const tieneAccesoMontos = ROLES_CON_ACCESO_MONTOS.includes(usuario?.rol)
  const tieneAccesoPrecioVenta = tieneAccesoMontos || usuario?.rol === 'asesor'
  const columnasMontos = (tieneAccesoMontos ? 1 : 0) + (tieneAccesoPrecioVenta ? 2 : 0)

  const puedeAdministrar = usuario?.rol === 'admin' || usuario?.rol === 'socia'

  const [trabajo, setTrabajo] = useState(null)
  const [tareas, setTareas] = useState([])
  const [detalle, setDetalle] = useState([])
  const [presupuestos, setPresupuestos] = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [productos, setProductos] = useState([])
  const [observaciones, setObservaciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [textoObservacion, setTextoObservacion] = useState('')
  const [guardandoObservacion, setGuardandoObservacion] = useState(false)
  const [cambiandoBloqueo, setCambiandoBloqueo] = useState(false)

  const [descripcionTarea, setDescripcionTarea] = useState('')
  const [tecnicoTarea, setTecnicoTarea] = useState('')
  const [guardandoTarea, setGuardandoTarea] = useState(false)

  const [catalogoServicios, setCatalogoServicios] = useState([])
  const [categoriaCatalogo, setCategoriaCatalogo] = useState('')
  const [servicioCatalogo, setServicioCatalogo] = useState('')
  const [tecnicoCatalogo, setTecnicoCatalogo] = useState('')
  const [agregandoServicioCatalogo, setAgregandoServicioCatalogo] = useState(false)

  const [areaDetalle, setAreaDetalle] = useState('repuestos')
  const [detalleTexto, setDetalleTexto] = useState('')
  const [cantidadDetalle, setCantidadDetalle] = useState('1')
  const [productoDetalle, setProductoDetalle] = useState('')
  const [provistoPorCliente, setProvistoPorCliente] = useState(false)
  const [guardandoDetalle, setGuardandoDetalle] = useState(false)

  const [generandoPresupuesto, setGenerandoPresupuesto] = useState(false)
  const [numeroDocumento, setNumeroDocumento] = useState('')
  const [tipoDocumento, setTipoDocumento] = useState('')
  const [estadoPago, setEstadoPago] = useState('pagado')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [retiradoPorNombre, setRetiradoPorNombre] = useState('')
  const [retiradoPorRut, setRetiradoPorRut] = useState('')
  const [retiradoPorContacto, setRetiradoPorContacto] = useState('')
  const [comentarioEgreso, setComentarioEgreso] = useState('')
  const [observacionesCierre, setObservacionesCierre] = useState('')
  const [kilometrajeEgreso, setKilometrajeEgreso] = useState('')
  const [avisoKmEgreso, setAvisoKmEgreso] = useState(null)
  const [firmaEgresoPng, setFirmaEgresoPng] = useState(null)
  const [datosEgresoPrecargados, setDatosEgresoPrecargados] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  const [sincronizando, setSincronizando] = useState(false)
  const [resultadoSync, setResultadoSync] = useState(null)
  const [errorSync, setErrorSync] = useState(null)

  async function cargarTodo() {
    try {
      const [
        { data: trabajoData, error: errorTrabajo },
        { data: tareasData },
        { data: detalleData },
        { data: presupuestosData },
        { data: tecnicosData },
        { data: productosData },
        { data: observacionesData },
      ] = await Promise.all([
        supabase
          .from('trabajos_taller')
          .select('id, numero_ot, tipo_ingreso, estado, categoria_servicio, clickup_task_id, numero_documento_facturacion, tipo_documento, estado_pago, fecha_vencimiento_pago, fecha_entrega, vehiculo_id, bloqueada_en, reabierta_en, clientes(nombre, apellido, razon_social, rut, tipo, telefono, telefono_norm), vehiculos(patente, marca, modelo, anio, kilometraje, tipo_carroceria, tipo_combustible)')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('tareas_taller')
          .select('id, descripcion, estado, tecnico_id, clickup_asignado_nombre, usuarios(nombre_completo)')
          .eq('trabajo_id', id)
          .order('orden'),
        // Siempre por la vista, nunca por la tabla: acá costo/precio salen en
        // NULL solos si el usuario no tiene tiene_acceso_montos().
        supabase
          .from('ot_detalle_con_permiso')
          .select('id, area, detalle, cantidad, costo_unitario, precio_unitario, total_linea, verificado, decision, motivo_rechazo, fecha_postergado, presupuesto_id, hallazgo_precio_referencial, producto_id, producto_nombre, producto_stock_actual, producto_unidad_medida, provisto_por_cliente')
          .eq('trabajo_id', id)
          .order('creado_en'),
        supabase.from('presupuestos_taller').select('id, correlativo, estado, creado_en').eq('trabajo_id', id).order('creado_en', { ascending: false }),
        supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'tecnico').eq('activo', true),
        supabase.from('productos').select('id, nombre, stock_actual, unidad_medida').eq('activo', true).order('nombre'),
        supabase
          .from('observaciones_postventa')
          .select('id, texto, creado_en, usuarios(nombre_completo)')
          .eq('trabajo_id', id)
          .order('creado_en', { ascending: false }),
      ])

      if (errorTrabajo) {
        setError(errorTrabajo.message)
      } else {
        setTrabajo(trabajoData)
        setNumeroDocumento(trabajoData?.numero_documento_facturacion || '')
      }
      setTareas(tareasData || [])
      setDetalle(detalleData || [])
      setPresupuestos(presupuestosData || [])
      setTecnicos(tecnicosData || [])
      setProductos(productosData || [])
      setObservaciones(observacionesData || [])
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

  // El catálogo de servicios/precios es de la empresa, no de esta OT
  // puntual: se carga una sola vez, no cada vez que cargarTodo() refresca
  // tareas/ítems después de una acción.
  useEffect(() => {
    async function cargarCatalogo() {
      const { data } = await supabase
        .from('catalogo_servicios')
        .select('id, segmento, categoria, servicio')
        .eq('activo', true)
        .order('segmento')
        .order('categoria')
        .order('servicio')
      setCatalogoServicios(data || [])
    }
    cargarCatalogo()
  }, [])

  // Precarga los datos de "quien retira" con el cliente registrado -el
  // asesor los corrige si en realidad retira otra persona (conductor)-,
  // solo una vez para no pisar lo que el asesor ya haya escrito.
  useEffect(() => {
    if (trabajo && !datosEgresoPrecargados) {
      setRetiradoPorNombre(nombreCliente(trabajo.clientes))
      setRetiradoPorRut(trabajo.clientes?.rut || '')
      setRetiradoPorContacto(trabajo.clientes?.telefono || '')
      setDatosEgresoPrecargados(true)
    }
  }, [trabajo, datosEgresoPrecargados])

  async function agregarTarea(evento) {
    evento.preventDefault()
    setGuardandoTarea(true)
    try {
      const { error: errorInsercion } = await supabase.from('tareas_taller').insert({
        trabajo_id: id,
        descripcion: descripcionTarea,
        tecnico_id: tecnicoTarea || null,
        orden: tareas.length,
      })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setDescripcionTarea('')
      setTecnicoTarea('')
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardandoTarea(false)
    }
  }

  async function agregarServicioCatalogo(evento) {
    evento.preventDefault()
    if (!servicioCatalogo) return
    setAgregandoServicioCatalogo(true)
    setError(null)
    try {
      const { error: errorRpc } = await supabase.rpc('agregar_servicio_catalogo', {
        p_trabajo_id: id,
        p_servicio_id: servicioCatalogo,
        p_tecnico_id: tecnicoCatalogo || null,
      })
      if (errorRpc) {
        setError(errorRpc.message)
        return
      }
      setServicioCatalogo('')
      setTecnicoCatalogo('')
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setAgregandoServicioCatalogo(false)
    }
  }

  async function agregarDetalle(evento) {
    evento.preventDefault()
    setGuardandoDetalle(true)
    try {
      const { error: errorInsercion } = await supabase.from('ot_detalle').insert({
        trabajo_id: id,
        area: areaDetalle,
        detalle: detalleTexto,
        cantidad: Number(cantidadDetalle) || 1,
        producto_id: provistoPorCliente ? null : productoDetalle || null,
        provisto_por_cliente: provistoPorCliente,
      })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setDetalleTexto('')
      setCantidadDetalle('1')
      setProductoDetalle('')
      setProvistoPorCliente(false)
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardandoDetalle(false)
    }
  }

  async function actualizarPrecioItem(itemId, campo, valorTexto) {
    const valor = valorTexto === '' ? null : Number(valorTexto)
    if (valorTexto !== '' && Number.isNaN(valor)) return

    try {
      const { error: errorActualizar } = await supabase.from('ot_detalle').update({ [campo]: valor }).eq('id', itemId)
      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      // total_linea la calcula la base (columna generada): hay que volver a
      // leerla, no se puede actualizar en el estado local a mano.
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function alternarVerificado(item) {
    try {
      const { error: errorActualizar } = await supabase
        .from('ot_detalle')
        .update({ verificado: !item.verificado })
        .eq('id', item.id)
      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      // Si tiene producto vinculado, marcar verificado dispara el descuento
      // de stock en la base (trigger); recargar para ver el stock al día.
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function actualizarDecisionItem(itemId, cambios) {
    setDetalle((actual) => actual.map((item) => (item.id === itemId ? { ...item, ...cambios } : item)))
    try {
      const { error: errorActualizar } = await supabase.from('ot_detalle').update(cambios).eq('id', itemId)
      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      // fecha_postergado dispara la creación de la oportunidad en la base;
      // no hace falta hacer nada más acá, solo refrescar por si algo más
      // cambió (ej. el trigger).
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function generarPresupuesto() {
    setGenerandoPresupuesto(true)
    setError(null)
    try {
      const { data: presupuesto, error: errorPresupuesto } = await supabase
        .from('presupuestos_taller')
        .insert({ trabajo_id: id, creado_por: usuario.id, estado: 'enviado', fecha_envio: new Date().toISOString() })
        .select('id, correlativo')
        .single()

      if (errorPresupuesto) {
        setError(errorPresupuesto.message)
        return
      }

      const idsAIncluir = detalle.filter((item) => item.precio_unitario !== null && !item.presupuesto_id).map((item) => item.id)
      if (idsAIncluir.length > 0) {
        const { error: errorVinculo } = await supabase
          .from('ot_detalle')
          .update({ presupuesto_id: presupuesto.id })
          .in('id', idsAIncluir)
        if (errorVinculo) {
          setError(errorVinculo.message)
          return
        }
      }

      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGenerandoPresupuesto(false)
    }
  }

  async function cerrarTrabajo(evento) {
    evento.preventDefault()
    setCerrando(true)
    setError(null)
    try {
      const tipoDocumentoFinal = numeroDocumento ? tipoDocumento || null : null
      const esFacturaPendiente = tipoDocumentoFinal === 'factura' && estadoPago === 'pendiente'

      const { error: errorCierre } = await supabase
        .from('trabajos_taller')
        .update({
          estado: 'entregado',
          numero_documento_facturacion: numeroDocumento || null,
          tipo_documento: tipoDocumentoFinal,
          estado_pago: tipoDocumentoFinal === 'factura' ? estadoPago : tipoDocumentoFinal ? 'pagado' : null,
          fecha_vencimiento_pago: esFacturaPendiente ? fechaVencimiento || null : null,
          fecha_pago: esFacturaPendiente ? null : tipoDocumentoFinal ? new Date().toISOString() : null,
          fecha_entrega: new Date().toISOString(),
          entregado_por: usuario.id,
        })
        .eq('id', id)

      if (errorCierre) {
        setError(errorCierre.message)
        return
      }

      const kilometrajeEgresoNumero = kilometrajeEgreso ? Number(kilometrajeEgreso) : null

      const { error: errorEgreso } = await supabase.from('egresos_vehiculo').insert({
        trabajo_id: id,
        retirado_por_nombre: retiradoPorNombre || null,
        retirado_por_rut: retiradoPorRut || null,
        retirado_por_contacto: retiradoPorContacto || null,
        comentario: comentarioEgreso || null,
        observaciones_cierre: observacionesCierre || null,
        kilometraje_egreso: kilometrajeEgresoNumero,
        firma_png: firmaEgresoPng,
        firmado_en: firmaEgresoPng ? new Date().toISOString() : null,
      })

      if (errorEgreso) {
        setError(errorEgreso.message)
        return
      }

      if (kilometrajeEgresoNumero !== null && trabajo.vehiculo_id) {
        if (trabajo.vehiculos?.kilometraje && kilometrajeEgresoNumero < trabajo.vehiculos.kilometraje) {
          setAvisoKmEgreso(
            `El kilometraje de salida (${kilometrajeEgresoNumero}) es menor al último registrado (${trabajo.vehiculos.kilometraje}). Se guardó igual; revisa si hay un error de tipeo.`
          )
        }
        await supabase.from('vehiculos').update({ kilometraje: kilometrajeEgresoNumero }).eq('id', trabajo.vehiculo_id)
      }

      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCerrando(false)
    }
  }

  async function sincronizarConClickUp() {
    setSincronizando(true)
    setErrorSync(null)
    setResultadoSync(null)
    try {
      const resultado = await invocarFuncion('clickup-sincronizar', { body: { trabajo_id: id } })
      setResultadoSync(resultado)
      await cargarTodo()
    } catch (excepcion) {
      setErrorSync(excepcion.message)
    } finally {
      setSincronizando(false)
    }
  }

  async function reabrirOt() {
    setCambiandoBloqueo(true)
    setError(null)
    try {
      const { error: errorRpc } = await supabase.rpc('trabajo_reabrir', { p_trabajo_id: id })
      if (errorRpc) {
        setError(errorRpc.message)
        return
      }
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCambiandoBloqueo(false)
    }
  }

  async function bloquearOtDeNuevo() {
    setCambiandoBloqueo(true)
    setError(null)
    try {
      const { error: errorRpc } = await supabase.rpc('trabajo_bloquear', { p_trabajo_id: id })
      if (errorRpc) {
        setError(errorRpc.message)
        return
      }
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCambiandoBloqueo(false)
    }
  }

  async function agregarObservacionPostventa(evento) {
    evento.preventDefault()
    if (!textoObservacion.trim()) return
    setGuardandoObservacion(true)
    setError(null)
    try {
      const { error: errorInsercion } = await supabase
        .from('observaciones_postventa')
        .insert({ trabajo_id: id, autor_id: usuario.id, texto: textoObservacion.trim() })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setTextoObservacion('')
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardandoObservacion(false)
    }
  }

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>
  if (!trabajo) return <div className="p-6 text-slate-500">No se encontró el trabajo.</div>

  const bloqueada = !!trabajo.bloqueada_en
  const reabierta = trabajo.estado === 'entregado' && !bloqueada

  // Agrupa el catálogo por segmento (isla) -> categoría, para las dos
  // listas encadenadas (categoría primero, servicio filtrado después).
  const categoriasPorSegmento = new Map()
  for (const s of catalogoServicios) {
    if (!categoriasPorSegmento.has(s.segmento)) categoriasPorSegmento.set(s.segmento, new Set())
    categoriasPorSegmento.get(s.segmento).add(s.categoria)
  }
  const serviciosDeCategoria = catalogoServicios.filter((s) => s.categoria === categoriaCatalogo)
  const vehiculoCatalogo = trabajo.vehiculos

  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            OT {trabajo.numero_ot} — {trabajo.vehiculos?.patente}
          </h1>
          <p className="text-sm text-slate-500">
            {trabajo.vehiculos?.marca} {trabajo.vehiculos?.modelo} {trabajo.vehiculos?.anio || ''} ·{' '}
            {nombreCliente(trabajo.clientes)} · Estado: {trabajo.estado}
          </p>
        </div>
        <div className="flex items-start gap-2 text-right">
          <Link
            to={`/trabajos/${id}/radar`}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {trabajo.tipo_ingreso === 'diagnostico' ? 'RADAR' : 'Revisión del asesor'}
          </Link>
          <div>
            <button
              type="button"
              onClick={sincronizarConClickUp}
              disabled={sincronizando}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {sincronizando ? 'Sincronizando…' : 'Sincronizar con ClickUp'}
            </button>
            {trabajo.clickup_task_id && (
              <p className="mt-1 text-xs text-slate-400">Tarjeta ya creada en ClickUp</p>
            )}
          </div>
        </div>
      </div>

      {bloqueada && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">
          <p>OT cerrada, entregada el {new Date(trabajo.bloqueada_en).toLocaleString('es-CL')}. No se puede editar mano de obra, ítems ni valorización -solo agregar observaciones de postventa-.</p>
          {puedeAdministrar && (
            <button
              type="button"
              onClick={reabrirOt}
              disabled={cambiandoBloqueo}
              className="shrink-0 rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {cambiandoBloqueo ? 'Reabriendo…' : 'Reabrir OT'}
            </button>
          )}
        </div>
      )}
      {reabierta && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            OT reabierta{trabajo.reabierta_en ? ` el ${new Date(trabajo.reabierta_en).toLocaleString('es-CL')}` : ''} para
            corregir un error. Vuelve a bloquearla cuando termines.
          </p>
          {puedeAdministrar && (
            <button
              type="button"
              onClick={bloquearOtDeNuevo}
              disabled={cambiandoBloqueo}
              className="shrink-0 rounded border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {cambiandoBloqueo ? 'Bloqueando…' : 'Bloquear de nuevo'}
            </button>
          )}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {errorSync && <p className="mb-4 text-sm text-red-600">Error al sincronizar: {errorSync}</p>}
      {resultadoSync && (
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Sincronizado: {resultadoSync.tareas_sincronizadas} tarea(s), {resultadoSync.items_sincronizados} ítem(s) de
          control.
          {resultadoSync.errores?.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-800">
              {resultadoSync.errores.map((e, indice) => (
                <li key={indice}>
                  {e.operacion}: {e.mensaje}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!bloqueada && catalogoServicios.length > 0 && (
        <section className="mb-6 max-w-4xl rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Agregar servicio del catálogo</h2>
          <p className="mb-3 text-xs text-slate-500">
            Precio de mano de obra calculado para {ETIQUETA_CARROCERIA[vehiculoCatalogo?.tipo_carroceria] || 'este vehículo'} ·{' '}
            {vehiculoCatalogo?.tipo_combustible === 'diesel' ? 'Diésel' : 'Bencina'}. Al elegir un servicio se agrega la tarea
            de mano de obra con su precio, y los repuestos típicos como ítems pendientes de presupuesto -editables o
            eliminables-.
          </p>
          <form onSubmit={agregarServicioCatalogo} className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select
              value={categoriaCatalogo}
              onChange={(evento) => {
                setCategoriaCatalogo(evento.target.value)
                setServicioCatalogo('')
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Categoría…</option>
              {[...categoriasPorSegmento.entries()].map(([segmento, categorias]) => (
                <optgroup key={segmento} label={segmento}>
                  {[...categorias].sort().map((categoria) => (
                    <option key={categoria} value={categoria}>
                      {categoria}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={servicioCatalogo}
              onChange={(evento) => setServicioCatalogo(evento.target.value)}
              disabled={!categoriaCatalogo}
              className="rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">Servicio…</option>
              {serviciosDeCategoria.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.servicio}
                </option>
              ))}
            </select>
            <select
              value={tecnicoCatalogo}
              onChange={(evento) => setTecnicoCatalogo(evento.target.value)}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin asignar todavía</option>
              {tecnicos.map((tecnico) => (
                <option key={tecnico.id} value={tecnico.id}>
                  {tecnico.nombre_completo}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!servicioCatalogo || agregandoServicioCatalogo}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {agregandoServicioCatalogo ? 'Agregando…' : 'Agregar servicio'}
            </button>
          </form>
        </section>
      )}

      <div className="grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Mano de obra</h2>
          <ul className="mb-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {tareas.map((tarea) => (
              <li key={tarea.id} className="px-3 py-2 text-sm">
                <p className="text-slate-800">{tarea.descripcion}</p>
                <p className="text-xs text-slate-500">
                  {tarea.usuarios?.nombre_completo || tarea.clickup_asignado_nombre || 'Sin asignar'} · {tarea.estado}
                </p>
              </li>
            ))}
            {tareas.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">Sin tareas todavía.</li>}
          </ul>
          {bloqueada ? (
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
              OT cerrada, no se pueden agregar tareas.
            </p>
          ) : (
            <form onSubmit={agregarTarea} className="rounded border border-slate-200 bg-white p-3">
              <input
                required
                value={descripcionTarea}
                onChange={(evento) => setDescripcionTarea(evento.target.value)}
                placeholder="Ej. Cambio de pastillas de freno delanteras"
                className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={tecnicoTarea}
                onChange={(evento) => setTecnicoTarea(evento.target.value)}
                className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Sin asignar todavía</option>
                {tecnicos.map((tecnico) => (
                  <option key={tecnico.id} value={tecnico.id}>
                    {tecnico.nombre_completo}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={guardandoTarea}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Agregar tarea
              </button>
            </form>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Repuestos, insumos y servicios externos</h2>
          <ul className="mb-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
            {detalle
              .filter((item) => item.area !== 'mano_obra')
              .map((item) => (
                <li key={item.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-800">
                      {item.detalle} <span className="text-slate-400">× {item.cantidad}</span>
                    </span>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={item.verificado}
                        disabled={bloqueada}
                        onChange={() => alternarVerificado(item)}
                      />
                      <span className={item.verificado ? 'text-green-600' : 'text-slate-400'}>
                        {item.verificado ? 'Verificado' : ETIQUETA_AREA[item.area]}
                      </span>
                    </label>
                  </div>
                  {item.producto_nombre && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      Bodega: {item.producto_nombre} (stock {item.producto_stock_actual} {item.producto_unidad_medida})
                    </p>
                  )}
                  {item.provisto_por_cliente && (
                    <p className="mt-0.5 text-xs font-medium text-amber-700">Cliente lo trae · no se valoriza</p>
                  )}
                </li>
              ))}
            {detalle.filter((item) => item.area !== 'mano_obra').length === 0 && (
              <li className="px-3 py-3 text-sm text-slate-400">Sin ítems todavía.</li>
            )}
          </ul>
          {bloqueada ? (
            <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
              OT cerrada, no se pueden agregar ítems.
            </p>
          ) : (
            <form onSubmit={agregarDetalle} className="rounded border border-slate-200 bg-white p-3">
              <select
                value={areaDetalle}
                onChange={(evento) => setAreaDetalle(evento.target.value)}
                className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {Object.entries(ETIQUETA_AREA)
                  .filter(([valor]) => valor !== 'mano_obra')
                  .map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
              </select>
              {(areaDetalle === 'repuestos' || areaDetalle === 'lubricantes_insumos') && (
                <>
                  {!provistoPorCliente && productos.length > 0 && (
                    <select
                      value={productoDetalle}
                      onChange={(evento) => setProductoDetalle(evento.target.value)}
                      className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Sin vincular a bodega</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} (stock {p.stock_actual} {p.unidad_medida})
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={provistoPorCliente}
                      onChange={(evento) => {
                        setProvistoPorCliente(evento.target.checked)
                        if (evento.target.checked) setProductoDetalle('')
                      }}
                    />
                    El cliente trae este repuesto (no se valoriza)
                  </label>
                </>
              )}
              <div className="mb-2 flex gap-2">
                <input
                  required
                  value={detalleTexto}
                  onChange={(evento) => setDetalleTexto(evento.target.value)}
                  placeholder="Ej. Filtro de aceite"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min="1"
                  value={cantidadDetalle}
                  onChange={(evento) => setCantidadDetalle(evento.target.value)}
                  className="w-20 rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={guardandoDetalle}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Agregar ítem
              </button>
            </form>
          )}
        </section>
      </div>

      <section className="mt-8 max-w-4xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Valorización y negociación</h2>
          {tieneAccesoMontos && !bloqueada && (
            <button
              type="button"
              onClick={generarPresupuesto}
              disabled={generandoPresupuesto}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {generandoPresupuesto ? 'Generando…' : 'Generar presupuesto'}
            </button>
          )}
        </div>

        {presupuestos.length > 0 && (
          <div className="mb-2 space-y-1 text-sm text-slate-500">
            {presupuestos.map((p) => {
              const totalPresupuesto = detalle
                .filter((item) => item.presupuesto_id === p.id)
                .reduce((acumulado, item) => acumulado + (item.total_linea || 0), 0)
              const telefonoCliente = trabajo?.clientes?.telefono_norm
              const linkWhatsapp = telefonoCliente
                ? `https://wa.me/${telefonoCliente.replace('+', '')}?text=${encodeURIComponent(
                    `Hola ${nombreCliente(trabajo?.clientes)}, te compartimos el presupuesto ${p.correlativo} para tu ${trabajo?.vehiculos?.marca} ${trabajo?.vehiculos?.modelo} (${trabajo?.vehiculos?.patente}). Total: ${formatoMoneda(totalPresupuesto)}. El detalle completo está en el documento adjunto. Quedamos atentos a tus consultas.`
                  )}`
                : null
              return (
                <p key={p.id}>
                  <Link to={`/presupuestos/${p.id}`} className="underline hover:text-slate-700">
                    {p.correlativo} ({p.estado})
                  </Link>
                  {linkWhatsapp && (
                    <a
                      href={linkWhatsapp}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700"
                    >
                      WhatsApp
                    </a>
                  )}
                </p>
              )
            })}
          </div>
        )}

        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Área</th>
                <th className="px-3 py-2">Detalle</th>
                <th className="px-3 py-2">Cant.</th>
                {tieneAccesoMontos && <th className="px-3 py-2">Costo</th>}
                {tieneAccesoPrecioVenta && <th className="px-3 py-2">Precio</th>}
                {tieneAccesoPrecioVenta && <th className="px-3 py-2">Total</th>}
                <th className="px-3 py-2">Decisión</th>
              </tr>
            </thead>
            <tbody>
              {detalle.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-500">{ETIQUETA_AREA[item.area]}</td>
                  <td className="px-3 py-2 text-slate-800">{item.detalle}</td>
                  <td className="px-3 py-2 text-slate-600">{item.cantidad}</td>
                  {(tieneAccesoMontos || tieneAccesoPrecioVenta) &&
                    (item.provisto_por_cliente ? (
                      <td className="px-3 py-2 text-xs font-medium text-amber-700" colSpan={columnasMontos}>
                        Cliente lo trae · no se valoriza
                      </td>
                    ) : (
                      <>
                        {tieneAccesoMontos && (
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              defaultValue={item.costo_unitario ?? ''}
                              disabled={bloqueada}
                              onBlur={(evento) => actualizarPrecioItem(item.id, 'costo_unitario', evento.target.value)}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                            />
                          </td>
                        )}
                        {tieneAccesoPrecioVenta && (
                          <td className="px-3 py-2">
                            {tieneAccesoMontos ? (
                              <input
                                type="number"
                                defaultValue={item.precio_unitario ?? ''}
                                disabled={bloqueada}
                                onBlur={(evento) => actualizarPrecioItem(item.id, 'precio_unitario', evento.target.value)}
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                              />
                            ) : (
                              <span className="text-slate-800">{formatoMoneda(item.precio_unitario)}</span>
                            )}
                            {tieneAccesoMontos && item.hallazgo_precio_referencial != null && (
                              <p className={`mt-1 text-xs ${precioSeAlejaDelReferencial(item) ? 'font-medium text-amber-700' : 'text-slate-400'}`}>
                                Ref: {formatoMoneda(item.hallazgo_precio_referencial)}
                                {precioSeAlejaDelReferencial(item) && ' ⚠ se aleja del referencial'}
                              </p>
                            )}
                          </td>
                        )}
                        {tieneAccesoPrecioVenta && <td className="px-3 py-2 text-slate-800">{formatoMoneda(item.total_linea)}</td>}
                      </>
                    ))}
                  <td className="px-3 py-2">
                    <select
                      value={item.decision}
                      disabled={bloqueada}
                      onChange={(evento) => actualizarDecisionItem(item.id, { decision: evento.target.value })}
                      className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      {Object.entries(ETIQUETA_DECISION).map(([valor, etiqueta]) => (
                        <option key={valor} value={valor}>
                          {etiqueta}
                        </option>
                      ))}
                    </select>
                    {item.decision === 'rechazado' && (
                      <input
                        placeholder="Motivo"
                        defaultValue={item.motivo_rechazo || ''}
                        disabled={bloqueada}
                        onBlur={(evento) => actualizarDecisionItem(item.id, { motivo_rechazo: evento.target.value })}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    )}
                    {item.decision === 'postergado' && (
                      <input
                        type="date"
                        defaultValue={item.fecha_postergado || ''}
                        disabled={bloqueada}
                        onBlur={(evento) => actualizarDecisionItem(item.id, { fecha_postergado: evento.target.value || null })}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    )}
                  </td>
                </tr>
              ))}
              {detalle.length === 0 && (
                <tr>
                  <td colSpan={4 + columnasMontos} className="px-3 py-6 text-center text-slate-400">
                    Todavía no hay ítems para valorizar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8 max-w-md">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Cierre</h2>
        {trabajo.estado === 'entregado' ? (
          <div className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
            <p>
              Entregado
              {trabajo.numero_documento_facturacion &&
                ` · ${trabajo.tipo_documento === 'factura' ? 'Factura' : trabajo.tipo_documento === 'boleta' ? 'Boleta' : 'Documento'} ${trabajo.numero_documento_facturacion}`}
              {trabajo.fecha_entrega ? ` · ${new Date(trabajo.fecha_entrega).toLocaleString('es-CL')}` : ''}
            </p>
            {trabajo.tipo_documento === 'factura' && (
              <p className="mt-1">
                Pago: {trabajo.estado_pago === 'pendiente' ? `Pendiente, vence ${trabajo.fecha_vencimiento_pago || 'sin fecha'}` : 'Pagada'}
              </p>
            )}
            <Link to={`/trabajos/${id}/egreso`} className="mt-2 inline-block underline hover:text-green-700">
              Ver Orden de Egreso
            </Link>
          </div>
        ) : (
          <form onSubmit={cerrarTrabajo} className="rounded border border-slate-200 bg-white p-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">N° de documento (Dimasoft)</label>
            <input
              value={numeroDocumento}
              onChange={(evento) => setNumeroDocumento(evento.target.value)}
              placeholder="Boleta o factura emitida"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            {numeroDocumento && (
              <div className="mb-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Tipo de documento</label>
                <select
                  value={tipoDocumento}
                  onChange={(evento) => setTipoDocumento(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Selecciona…</option>
                  <option value="boleta">Boleta</option>
                  <option value="factura">Factura</option>
                </select>
              </div>
            )}

            {numeroDocumento && tipoDocumento === 'factura' && (
              <div className="mb-2 rounded border border-slate-200 p-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">Estado del pago</label>
                <div className="mb-2 flex gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={estadoPago === 'pagado'} onChange={() => setEstadoPago('pagado')} />
                    Pagada ahora
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={estadoPago === 'pendiente'} onChange={() => setEstadoPago('pendiente')} />
                    Pendiente
                  </label>
                </div>
                {estadoPago === 'pendiente' && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">Vence el</label>
                    <input
                      type="date"
                      value={fechaVencimiento}
                      onChange={(evento) => setFechaVencimiento(evento.target.value)}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-amber-700">Va a aparecer en Cuentas por cobrar hasta que se marque pagada.</p>
                  </div>
                )}
              </div>
            )}

            <div className="mb-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Kilometraje de salida</label>
              <input
                type="number"
                value={kilometrajeEgreso}
                onChange={(evento) => setKilometrajeEgreso(evento.target.value)}
                className="w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
              />
              {avisoKmEgreso && <p className="mt-1 text-xs text-amber-700">{avisoKmEgreso}</p>}
            </div>

            <div className="mb-2 grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Quien retira</label>
                <input
                  value={retiradoPorNombre}
                  onChange={(evento) => setRetiradoPorNombre(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">RUT</label>
                <input
                  value={retiradoPorRut}
                  onChange={(evento) => setRetiradoPorRut(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Contacto</label>
                <input
                  value={retiradoPorContacto}
                  onChange={(evento) => setRetiradoPorContacto(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <label className="mb-1 block text-sm font-medium text-slate-700">Observaciones de cierre</label>
            <textarea
              value={observacionesCierre}
              onChange={(evento) => setObservacionesCierre(evento.target.value)}
              rows={2}
              placeholder="Ej. hallazgos confirmados, pendientes para la próxima visita"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">Comentario</label>
            <textarea
              value={comentarioEgreso}
              onChange={(evento) => setComentarioEgreso(evento.target.value)}
              rows={2}
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">Firma de conformidad al retiro</label>
            <div className="mb-2">
              <FirmaCanvas onCambio={setFirmaEgresoPng} />
            </div>

            <button
              type="submit"
              disabled={cerrando}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {cerrando ? 'Cerrando…' : 'Marcar como entregado'}
            </button>
          </form>
        )}
      </section>

      <section className="mt-8 max-w-md">
        <h2 className="mb-2 text-lg font-semibold text-slate-900">Observaciones de postventa</h2>
        <ul className="mb-3 divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {observaciones.map((observacion) => (
            <li key={observacion.id} className="px-3 py-2 text-sm">
              <p className="text-slate-800 whitespace-pre-line">{observacion.texto}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {observacion.usuarios?.nombre_completo || 'Sin autor'} ·{' '}
                {new Date(observacion.creado_en).toLocaleString('es-CL')}
              </p>
            </li>
          ))}
          {observaciones.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-400">Sin observaciones todavía.</li>
          )}
        </ul>
        {trabajo.estado === 'entregado' ? (
          <form onSubmit={agregarObservacionPostventa} className="rounded border border-slate-200 bg-white p-3">
            <textarea
              required
              value={textoObservacion}
              onChange={(evento) => setTextoObservacion(evento.target.value)}
              rows={2}
              placeholder="Ej. cliente llamó por ruido en freno, se agendó revisión"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={guardandoObservacion}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardandoObservacion ? 'Guardando…' : 'Agregar observación'}
            </button>
          </form>
        ) : (
          <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">
            Las observaciones de postventa se agregan una vez que la OT esté entregada.
          </p>
        )}
      </section>
    </div>
  )
}

export default TrabajoDetalle
