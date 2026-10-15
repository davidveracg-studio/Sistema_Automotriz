import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { invocarFuncion } from '../lib/invocarFuncion'
import FirmaCanvas from '../components/FirmaCanvas'

import DescuentoManoObra from '../components/DescuentoManoObra'
import { formatearPatente } from '../lib/patente'
import { calcularDescuentoManoObra, textoPorcentaje } from '../lib/descuento'
const ETIQUETA_AREA = {
  mano_obra: 'Mano de obra',
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes e insumos',
  servicios_externos: 'Servicios externos',
}

// Rubros de la OT, en el orden en que se muestran y se imprimen.
const PESTANAS_OT = ['mano_obra', 'repuestos', 'lubricantes_insumos', 'servicios_externos']

const ROLES_CON_ACCESO_MONTOS = ['socia', 'admin', 'encargado_presupuestos', 'jefe_taller']
const ROLES_QUE_ASIGNAN_TECNICO = ['admin', 'socia', 'jefe_taller']

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

// Paleta fija (clases completas, no armadas con template strings) para que
// Tailwind las detecte. El color de cada técnico sale de un hash de su
// nombre: la misma persona siempre queda con el mismo color, sin guardar nada.
const COLORES_AVATAR = [
  'bg-red-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
  'bg-pink-500',
]

function colorAvatar(texto) {
  let hash = 0
  for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) % COLORES_AVATAR.length
  return COLORES_AVATAR[hash]
}

// Iniciales al estilo ClickUp: primera letra del nombre y del apellido. Sin
// cruce con un usuario del CRM, tarea.clickup_asignado_nombre trae el correo
// de ClickUp -se usan sus dos primeras letras como respaldo.
function inicialesTecnico(nombre) {
  if (nombre.includes('@')) return nombre.slice(0, 2).toUpperCase()
  const partes = nombre.trim().split(/\s+/)
  return partes.length === 1 ? partes[0].slice(0, 2).toUpperCase() : (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

// Columna "Técnico" de Mano de obra: un círculo con las iniciales, igual que
// el avatar de asignado de ClickUp. El nombre completo va en el title.
function AvatarTecnico({ nombre }) {
  if (!nombre) {
    return (
      <span
        title="Sin asignar"
        className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-slate-300 text-[10px] font-semibold text-slate-400"
      >
        ?
      </span>
    )
  }
  return (
    <span
      title={nombre}
      className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white ${colorAvatar(nombre)}`}
    >
      {inicialesTecnico(nombre)}
    </span>
  )
}

// "Marcar ejecutada" + observación editable de una tarea de mano de obra. Solo
// se muestra a quien puede ejecutarla: el jefe de taller/admin/socia (cualquier
// tarea) o el propio técnico asignado (solo la suya). Empuja el cambio a
// ClickUp también -ver clickup-tarea-.
// El check de la izquierda ES el control para terminar la tarea -no un botón
// aparte-. Al tocarlo se pide la observación (obligatoria: sin observación no
// se puede terminar) y recién ahí se guarda y se completa en un solo paso.
// Una tarea sin precio en el aviso de "Cierre": si quien mira tiene acceso a
// montos, puede ponerle precio ahí mismo; si no, solo ve el nombre.
function FilaValorizarPendiente({ tarea, puedeValorizar, onGuardar }) {
  const [precio, setPrecio] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(evento) {
    evento.preventDefault()
    setGuardando(true)
    await onGuardar(tarea, precio)
    setGuardando(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>{tarea.descripcion}</span>
      {puedeValorizar && (
        <form onSubmit={guardar} className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            value={precio}
            onChange={(evento) => setPrecio(evento.target.value)}
            placeholder="Precio"
            className="w-24 rounded border border-amber-300 px-2 py-0.5 text-xs"
          />
          <button type="submit" disabled={guardando || !precio} className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white disabled:opacity-50">
            Guardar
          </button>
        </form>
      )}
    </li>
  )
}

function ControlTareaTecnico({ tarea, nombreTecnico, onCompletar, onGuardarObservacion }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(tarea.observaciones_tecnico || '')
  const [guardando, setGuardando] = useState(false)
  const [faltaObservacion, setFaltaObservacion] = useState(false)

  function tocarCheck() {
    if (tarea.completada) return
    setEditando(true)
    setFaltaObservacion(false)
  }

  async function guardar(evento) {
    evento.preventDefault()
    setGuardando(true)
    await onGuardarObservacion(texto.trim() || null)
    setGuardando(false)
    setEditando(false)
  }

  async function guardarYCompletar() {
    const valor = texto.trim()
    if (!valor) {
      setFaltaObservacion(true)
      return
    }
    setGuardando(true)
    await onGuardarObservacion(valor)
    await onCompletar()
    setGuardando(false)
    setEditando(false)
  }

  return (
    <div className="mt-1">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <button
          type="button"
          onClick={tocarCheck}
          disabled={tarea.completada}
          title={tarea.completada ? 'Ejecutada' : 'Marcar ejecutada'}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
            tarea.completada ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent hover:border-emerald-500'
          }`}
        >
          ✓
        </button>
        {nombreTecnico || 'Sin asignar'} · {tarea.estado}
      </p>

      {editando ? (
        <form onSubmit={guardar} className="mt-1">
          <div className="flex items-start gap-1.5">
            <textarea
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value)
                if (evento.target.value.trim()) setFaltaObservacion(false)
              }}
              rows={2}
              autoFocus
              className={`w-full rounded border px-2 py-1 text-xs ${faltaObservacion ? 'border-red-400' : 'border-slate-300'}`}
              placeholder="Observación de la tarea (ej. venta cruzada, hallazgo)"
            />
            <div className="flex shrink-0 flex-col gap-1">
              {!tarea.completada && (
                <button
                  type="button"
                  disabled={guardando}
                  onClick={guardarYCompletar}
                  className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Guardar y marcar ejecutada
                </button>
              )}
              <button type="submit" disabled={guardando} className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50">
                Solo guardar
              </button>
              <button
                type="button"
                onClick={() => {
                  setTexto(tarea.observaciones_tecnico || '')
                  setEditando(false)
                  setFaltaObservacion(false)
                }}
                className="text-xs text-slate-500 underline"
              >
                Cancelar
              </button>
            </div>
          </div>
          {faltaObservacion && <p className="mt-1 text-xs text-red-600">Escribe una observación para poder marcar la tarea como ejecutada.</p>}
        </form>
      ) : (
        <button type="button" onClick={() => setEditando(true)} className="mt-1 block text-left text-xs text-slate-500 hover:text-slate-800">
          {tarea.observaciones_tecnico ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">{tarea.observaciones_tecnico}</span>
          ) : (
            <span className="underline">Agregar observación</span>
          )}
        </button>
      )}
    </div>
  )
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
  const [observacionesAsesor, setObservacionesAsesor] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [textoObservacion, setTextoObservacion] = useState('')
  const [guardandoObservacion, setGuardandoObservacion] = useState(false)
  const [textoObservacionAsesor, setTextoObservacionAsesor] = useState('')
  const [guardandoObservacionAsesor, setGuardandoObservacionAsesor] = useState(false)
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
  const [pestana, setPestana] = useState('mano_obra')
  const [detalleTexto, setDetalleTexto] = useState('')
  const [cantidadDetalle, setCantidadDetalle] = useState('1')
  const [productoDetalle, setProductoDetalle] = useState('')
  const [provistoPorCliente, setProvistoPorCliente] = useState(false)
  const [guardandoDetalle, setGuardandoDetalle] = useState(false)
  const [confirmarEliminarDetalle, setConfirmarEliminarDetalle] = useState(null)
  const [eliminandoDetalle, setEliminandoDetalle] = useState(false)

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
        { data: observacionesAsesorData },
      ] = await Promise.all([
        supabase
          .from('trabajos_taller')
          .select('id, numero_ot, tipo_ingreso, estado, categoria_servicio, descuento_mano_obra_pct, clickup_task_id, numero_documento_facturacion, tipo_documento, estado_pago, fecha_vencimiento_pago, fecha_entrega, vehiculo_id, bloqueada_en, reabierta_en, clientes(nombre, apellido, razon_social, rut, tipo, telefono, telefono_norm), vehiculos(patente, marca, modelo, anio, kilometraje, tipo_carroceria, tipo_combustible)')
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('tareas_taller')
          .select('id, descripcion, estado, completada, tecnico_id, clickup_asignado_nombre, observaciones_tecnico, usuarios(nombre_completo)')
          .eq('trabajo_id', id)
          .order('orden'),
        // Siempre por la vista, nunca por la tabla: acá costo/precio salen en
        // NULL solos si el usuario no tiene tiene_acceso_montos().
        supabase
          .from('ot_detalle_con_permiso')
          .select('id, area, tarea_taller_id, codigo, detalle, cantidad, costo_unitario, precio_unitario, total_linea, verificado, decision, motivo_rechazo, fecha_postergado, presupuesto_id, hallazgo_precio_referencial, producto_id, producto_nombre, producto_stock_actual, producto_unidad_medida, provisto_por_cliente')
          .eq('trabajo_id', id)
          .order('creado_en'),
        supabase.from('presupuestos_taller').select('id, correlativo, estado, creado_en').eq('trabajo_id', id).order('creado_en', { ascending: false }),
        supabase.from('usuarios').select('id, nombre_completo').eq('rol', 'tecnico').eq('activo', true),
        supabase.from('productos').select('id, codigo, nombre, stock_actual, unidad_medida').eq('activo', true).order('nombre'),
        supabase
          .from('observaciones_postventa')
          .select('id, texto, creado_en, usuarios(nombre_completo)')
          .eq('trabajo_id', id)
          .order('creado_en', { ascending: false }),
        supabase
          .from('observaciones_asesor')
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
      setObservacionesAsesor(observacionesAsesorData || [])
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

  async function eliminarDetalle(itemId) {
    setEliminandoDetalle(true)
    setError(null)
    try {
      const { error: errorEliminar } = await supabase.from('ot_detalle').delete().eq('id', itemId)
      if (errorEliminar) {
        setError(errorEliminar.message)
        return
      }
      setConfirmarEliminarDetalle(null)
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setEliminandoDetalle(false)
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

  // Le pone precio a una tarea que llegó sin valorizar (directo de ClickUp/
  // Kanban, o agregada "a mano" sin el catálogo): crea la línea de
  // ot_detalle si todavía no existe, o solo le completa el precio si ya
  // existía sin él. Sin esto, quedaría fuera de la Orden de Egreso.
  async function valorizarTareaPendiente(tarea, precioTexto) {
    const precio = Number(precioTexto)
    if (!precioTexto || Number.isNaN(precio) || precio < 0) return
    setError(null)
    try {
      const itemExistente = detalle.find((d) => d.tarea_taller_id === tarea.id)
      const { error: errorGuardar } = itemExistente
        ? await supabase.from('ot_detalle').update({ precio_unitario: precio }).eq('id', itemExistente.id)
        : await supabase.from('ot_detalle').insert({
            trabajo_id: id,
            area: 'mano_obra',
            tarea_taller_id: tarea.id,
            detalle: tarea.descripcion,
            cantidad: 1,
            precio_unitario: precio,
          })
      if (errorGuardar) {
        setError(errorGuardar.message)
        return
      }
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

  // Asignar/completar/observación empujan el cambio a ClickUp también (ver
  // clickup-tarea); acá solo se llama y se refleja el resultado en la tabla.
  async function asignarTecnicoATarea(tareaId, tecnicoId) {
    const anterior = tareas.find((t) => t.id === tareaId)
    setTareas((actual) => actual.map((t) => (t.id === tareaId ? { ...t, tecnico_id: tecnicoId || null, clickup_asignado_nombre: null } : t)))
    try {
      await invocarFuncion('clickup-tarea', { body: { accion: 'asignar', tarea_taller_id: tareaId, tecnico_id: tecnicoId } })
      await cargarTodo()
    } catch (excepcion) {
      setTareas((actual) => actual.map((t) => (t.id === tareaId ? anterior : t)))
      setError(excepcion.message)
    }
  }

  async function completarTareaTecnico(tareaId) {
    const anterior = tareas.find((t) => t.id === tareaId)
    setTareas((actual) => actual.map((t) => (t.id === tareaId ? { ...t, completada: true } : t)))
    try {
      await invocarFuncion('clickup-tarea', { body: { accion: 'completar', tarea_taller_id: tareaId } })
      await cargarTodo()
    } catch (excepcion) {
      setTareas((actual) => actual.map((t) => (t.id === tareaId ? anterior : t)))
      setError(excepcion.message)
    }
  }

  async function guardarObservacionTecnico(tareaId, texto) {
    const anterior = tareas.find((t) => t.id === tareaId)
    setTareas((actual) => actual.map((t) => (t.id === tareaId ? { ...t, observaciones_tecnico: texto } : t)))
    try {
      await invocarFuncion('clickup-tarea', { body: { accion: 'observacion', tarea_taller_id: tareaId, observacion: texto } })
    } catch (excepcion) {
      setTareas((actual) => actual.map((t) => (t.id === tareaId ? anterior : t)))
      setError(excepcion.message)
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

  // Una tarea de mano de obra creada directo en ClickUp/Kanban (o "a mano" sin
  // el catálogo) no trae precio solo -ver ot_detalle.tarea_taller_id-. Sin
  // esto, quedaría fuera de la Orden de Egreso en silencio: se exige
  // valorizarla antes de poder cerrar la OT. Quien no tiene acceso a montos
  // ve precio_unitario en NULL siempre (ot_detalle_con_permiso lo oculta), así
  // que para esa persona solo se puede exigir que la línea EXISTA, no que
  // tenga precio -el valor real se lo confirma alguien con acceso.
  const tareasSinValorizar = tareas.filter((tarea) => {
    const item = detalle.find((d) => d.tarea_taller_id === tarea.id)
    if (!item) return true
    return tieneAccesoMontos && item.precio_unitario == null
  })

  async function cerrarTrabajo(evento) {
    evento.preventDefault()
    if (tareasSinValorizar.length > 0) {
      setError('Hay tareas de mano de obra sin precio: valorízalas antes de marcar como entregado (ver "Cierre" más abajo).')
      return
    }
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

  async function agregarObservacionAsesor(evento) {
    evento.preventDefault()
    if (!textoObservacionAsesor.trim()) return
    setGuardandoObservacionAsesor(true)
    setError(null)
    try {
      const { error: errorInsercion } = await supabase
        .from('observaciones_asesor')
        .insert({ trabajo_id: id, autor_id: usuario.id, texto: textoObservacionAsesor.trim() })
      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      setTextoObservacionAsesor('')
      await cargarTodo()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardandoObservacionAsesor(false)
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
  const esManoObra = pestana === 'mano_obra'
  const itemsPestana = detalle.filter((item) => item.area === pestana)
  const totalesOt = calcularDescuentoManoObra(
    detalle.filter((item) => item.decision === 'aceptado'),
    trabajo.descuento_mano_obra_pct
  )

  // Al cambiar de pestaña, el formulario de ítems queda apuntando a ese rubro.
  function elegirPestana(clave) {
    setPestana(clave)
    if (clave !== 'mano_obra') setAreaDetalle(clave)
  }
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
            OT {trabajo.numero_ot} — {formatearPatente(trabajo.vehiculos?.patente)}
          </h1>
          <p className="text-sm text-slate-500">
            {trabajo.vehiculos?.marca} {trabajo.vehiculos?.modelo} {trabajo.vehiculos?.anio || ''} ·{' '}
            {nombreCliente(trabajo.clientes)} · Estado: {trabajo.estado}
          </p>
        </div>
        <div className="flex items-start gap-2 text-right">
          <Link
            to={`/trabajos/${id}/ingreso`}
            className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Orden de ingreso
          </Link>
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

      <section className="mb-6 max-w-4xl rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Observaciones del asesor</h2>
        {observacionesAsesor.length > 0 && (
          <ul className="mb-3 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">
            {observacionesAsesor.map((observacion) => (
              <li key={observacion.id} className="px-3 py-2 text-sm">
                <p className="whitespace-pre-line text-slate-800">{observacion.texto}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {observacion.usuarios?.nombre_completo || 'Sin autor'} · {new Date(observacion.creado_en).toLocaleString('es-CL')}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={agregarObservacionAsesor} className="flex flex-wrap items-start gap-2">
          <textarea
            required
            value={textoObservacionAsesor}
            onChange={(evento) => setTextoObservacionAsesor(evento.target.value)}
            rows={2}
            placeholder="Ej. cliente prefiere que lo llamen después de las 18:00, pidió el presupuesto por WhatsApp…"
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={guardandoObservacionAsesor}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardandoObservacionAsesor ? 'Guardando…' : 'Agregar'}
          </button>
        </form>
      </section>

      <section className="max-w-5xl">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Trabajo y valorización</h2>
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
          <div className="mb-3 space-y-1 text-sm text-slate-500">
            {presupuestos.map((p) => {
              const totalPresupuesto = calcularDescuentoManoObra(
                detalle.filter((item) => item.presupuesto_id === p.id),
                trabajo.descuento_mano_obra_pct
              ).total
              const telefonoCliente = trabajo?.clientes?.telefono_norm
              const linkWhatsapp = telefonoCliente
                ? `https://wa.me/${telefonoCliente.replace('+', '')}?text=${encodeURIComponent(
                    `Hola ${nombreCliente(trabajo?.clientes)}, te compartimos el presupuesto ${p.correlativo} para tu ${trabajo?.vehiculos?.marca} ${trabajo?.vehiculos?.modelo} (${formatearPatente(trabajo?.vehiculos?.patente)}). Total: ${formatoMoneda(totalPresupuesto)}. El detalle completo está en el documento adjunto. Quedamos atentos a tus consultas.`
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

        <div role="tablist" aria-label="Rubros de la OT" className="flex flex-wrap gap-1 border-b border-slate-200">
          {PESTANAS_OT.map((clave) => {
            const activa = pestana === clave
            const itemsRubro = detalle.filter((item) => item.area === clave)
            const subtotalRubro = calcularDescuentoManoObra(
              itemsRubro.filter((item) => item.decision === 'aceptado'),
              0
            ).totalBruto
            return (
              <button
                key={clave}
                type="button"
                role="tab"
                aria-selected={activa}
                onClick={() => elegirPestana(clave)}
                className={`-mb-px rounded-t border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-deep ${
                  activa ? 'border-slate-200 border-b-white bg-white text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {ETIQUETA_AREA[clave]}
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{itemsRubro.length}</span>
                {tieneAccesoPrecioVenta && subtotalRubro > 0 && <span className="ml-2 text-xs font-normal text-slate-400">{formatoMoneda(subtotalRubro)}</span>}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" className="rounded-b border border-t-0 border-slate-200 bg-white p-3">
          {esManoObra && !bloqueada && catalogoServicios.length > 0 && (
            <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
              <h3 className="mb-1 text-sm font-semibold text-slate-900">Agregar servicio del catálogo</h3>
              <p className="mb-3 text-xs text-slate-500">
                Precio de mano de obra calculado para {ETIQUETA_CARROCERIA[vehiculoCatalogo?.tipo_carroceria] || 'este vehículo'} ·{' '}
                {vehiculoCatalogo?.tipo_combustible === 'diesel' ? 'Diésel' : 'Bencina'}. Al elegir un servicio se agrega la tarea de mano de obra con su precio, y
                los repuestos típicos como ítems pendientes de presupuesto -editables o eliminables-.
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
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2">Cant.</th>
                  {!esManoObra && <th className="px-3 py-2">Verificado</th>}
                  {tieneAccesoMontos && <th className="px-3 py-2">Costo</th>}
                  {tieneAccesoPrecioVenta && <th className="px-3 py-2">Precio</th>}
                  {tieneAccesoPrecioVenta && <th className="px-3 py-2">Total</th>}
                  <th className="px-3 py-2">Decisión</th>
                  {esManoObra && <th className="px-3 py-2">Técnico</th>}
                </tr>
              </thead>
              <tbody>
                {itemsPestana.map((item) => {
                  const tarea = esManoObra ? tareas.find((t) => t.id === item.tarea_taller_id) : null
                  const nombreTecnico = tarea ? tarea.usuarios?.nombre_completo || tarea.clickup_asignado_nombre || null : null
                  const puedeEjecutarTarea =
                    tarea && !bloqueada && (ROLES_QUE_ASIGNAN_TECNICO.includes(usuario?.rol) || tarea.tecnico_id === usuario?.id)
                  return (
                    <tr key={item.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 text-slate-800">
                        {item.codigo && <span className="mr-1 font-mono text-xs text-slate-400">{item.codigo}</span>}
                        {item.detalle}
                        {tarea && !puedeEjecutarTarea && (
                          <p className="text-xs text-slate-500">
                            {nombreTecnico || 'Sin asignar'} · {tarea.estado}
                          </p>
                        )}
                        {puedeEjecutarTarea ? (
                          <ControlTareaTecnico
                            tarea={tarea}
                            nombreTecnico={nombreTecnico}
                            onCompletar={() => completarTareaTecnico(tarea.id)}
                            onGuardarObservacion={(texto) => guardarObservacionTecnico(tarea.id, texto)}
                          />
                        ) : (
                          tarea?.observaciones_tecnico && (
                            <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900" title="Escrita por el técnico -puede indicar una venta cruzada para ofrecer al cliente.">
                              <span className="font-semibold">Observación del técnico:</span> {tarea.observaciones_tecnico}
                            </p>
                          )
                        )}
                        {item.producto_nombre && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            Bodega: {item.producto_nombre} (stock {item.producto_stock_actual} {item.producto_unidad_medida})
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{item.cantidad}</td>
                      {!esManoObra && (
                        <td className="px-3 py-2">
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={item.verificado} disabled={bloqueada} onChange={() => alternarVerificado(item)} />
                            <span className={item.verificado ? 'text-green-600' : 'text-slate-400'}>{item.verificado ? 'Verificado' : 'Pendiente'}</span>
                          </label>
                        </td>
                      )}
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
                        <div className="flex items-start gap-1">
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
                        </div>
                        {!bloqueada &&
                          (confirmarEliminarDetalle === item.id ? (
                            <div className="mt-1 flex items-center gap-1 text-xs">
                              <button
                                type="button"
                                disabled={eliminandoDetalle}
                                onClick={() => eliminarDetalle(item.id)}
                                className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Confirmar
                              </button>
                              <button type="button" onClick={() => setConfirmarEliminarDetalle(null)} className="text-slate-500 hover:text-slate-700">
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmarEliminarDetalle(item.id)}
                              className="mt-1 text-xs text-slate-400 hover:text-red-600"
                            >
                              Eliminar
                            </button>
                          ))}
                      </td>
                      {esManoObra && (
                        <td className="px-3 py-2">
                          {!bloqueada && ROLES_QUE_ASIGNAN_TECNICO.includes(usuario?.rol) ? (
                            <select
                              value={tarea?.tecnico_id || ''}
                              onChange={(evento) => asignarTecnicoATarea(tarea.id, evento.target.value || null)}
                              className="rounded border border-slate-300 px-2 py-1 text-xs"
                            >
                              <option value="">Sin asignar</option>
                              {tecnicos.map((tecnico) => (
                                <option key={tecnico.id} value={tecnico.id}>
                                  {tecnico.nombre_completo}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <AvatarTecnico nombre={nombreTecnico} />
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
                {itemsPestana.length === 0 && (
                  <tr>
                    <td colSpan={4 + columnasMontos} className="px-3 py-6 text-center text-slate-400">
                      {esManoObra ? 'Sin tareas de mano de obra todavía.' : `Sin ${ETIQUETA_AREA[pestana].toLowerCase()} todavía.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {bloqueada ? (
            <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400">OT cerrada, no se pueden agregar {esManoObra ? 'tareas' : 'ítems'}.</p>
          ) : esManoObra ? (
            <form onSubmit={agregarTarea} className="mt-3 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_14rem_auto]">
              <input
                required
                value={descripcionTarea}
                onChange={(evento) => setDescripcionTarea(evento.target.value)}
                placeholder="Ej. Cambio de pastillas de freno delanteras"
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <select value={tecnicoTarea} onChange={(evento) => setTecnicoTarea(evento.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
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
                className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Agregar tarea
              </button>
            </form>
          ) : (
            <form onSubmit={agregarDetalle} className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
              {(pestana === 'repuestos' || pestana === 'lubricantes_insumos') && (
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  {!provistoPorCliente && productos.length > 0 && (
                    <select
                      value={productoDetalle}
                      onChange={(evento) => {
                        setProductoDetalle(evento.target.value)
                        const elegido = productos.find((p) => p.id === evento.target.value)
                        if (elegido) setDetalleTexto(elegido.nombre)
                      }}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Sin vincular a bodega</option>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo ? `${p.codigo} · ` : ''}
                          {p.nombre} (stock {p.stock_actual} {p.unidad_medida})
                        </option>
                      ))}
                    </select>
                  )}
                  <label className="flex items-center gap-2 text-xs text-slate-600">
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
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  required
                  value={detalleTexto}
                  onChange={(evento) => setDetalleTexto(evento.target.value)}
                  placeholder={pestana === 'servicios_externos' ? 'Ej. Rectificado de discos' : 'Ej. Filtro de aceite'}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min="1"
                  value={cantidadDetalle}
                  onChange={(evento) => setCantidadDetalle(evento.target.value)}
                  className="w-20 rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={guardandoDetalle}
                  className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Agregar ítem
                </button>
              </div>
            </form>
          )}

          {esManoObra && tieneAccesoPrecioVenta && (
            <DescuentoManoObra
              incrustado
              trabajoId={id}
              empresaId={usuario.empresa_id}
              porcentajeVigente={trabajo.descuento_mano_obra_pct}
              subtotalManoObra={calcularDescuentoManoObra(detalle.filter((item) => item.decision === 'aceptado'), 0).subtotalManoObra}
              bloqueada={bloqueada}
              rol={usuario?.rol}
              onCambio={cargarTodo}
            />
          )}
        </div>

        {tieneAccesoPrecioVenta && (
          <div className="mt-3 ml-auto w-full max-w-xs rounded border border-slate-300 bg-white text-sm">
            <div className="flex justify-between px-3 py-1.5">
              <span className="text-slate-600">Subtotal (aceptado)</span>
              <span>{formatoMoneda(totalesOt.totalBruto)}</span>
            </div>
            {totalesOt.descuento > 0 && (
              <div className="flex justify-between border-t border-slate-200 px-3 py-1.5">
                <span className="text-slate-600">Desc. M.O. ({textoPorcentaje(totalesOt.porcentaje)}%)</span>
                <span>-{formatoMoneda(totalesOt.descuento)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 bg-slate-100 px-3 py-1.5 font-bold">
              <span>Total de la OT</span>
              <span>{formatoMoneda(totalesOt.total)}</span>
            </div>
          </div>
        )}
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
          <>
            {tareasSinValorizar.length > 0 && (
              <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">
                  {tareasSinValorizar.length} tarea{tareasSinValorizar.length === 1 ? '' : 's'} de mano de obra sin precio -hay que
                  valorizarla{tareasSinValorizar.length === 1 ? '' : 's'} antes de poder marcar como entregado.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {tareasSinValorizar.map((tareaPendiente) => {
                    const propsFila = { tarea: tareaPendiente, puedeValorizar: tieneAccesoMontos, onGuardar: valorizarTareaPendiente }
                    return <FilaValorizarPendiente key={tareaPendiente.id} {...propsFila} />
                  })}
                </ul>
                {!tieneAccesoMontos && (
                  <p className="mt-2 text-xs">No tienes acceso para poner precios: pide a admin, socia, jefe de taller o encargado de presupuestos que las complete.</p>
                )}
              </div>
            )}
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
              disabled={cerrando || tareasSinValorizar.length > 0}
              title={tareasSinValorizar.length > 0 ? 'Hay tareas de mano de obra sin precio' : undefined}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {cerrando ? 'Cerrando…' : 'Marcar como entregado'}
            </button>
            </form>
          </>
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
