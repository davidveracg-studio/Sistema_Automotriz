import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  CATEGORIAS_PLANO,
  CELDA,
  COLUMNAS,
  FILAS,
  ORDEN_PALETA,
  PLANO_BASE,
  TIPOS_PLANO,
  buscarHueco,
  buscarIslaPorNombre,
  contarPorCategoria,
  formatoTranscurrido,
  islaNombreDeItem,
  nombreCliente,
  orientacionLarga,
  posicionValida,
} from '../lib/plano'

import { formatearPatente } from '../lib/patente'
import Kanban from '../components/taller/Kanban'
const ROLES_EDITORES = ['admin', 'socia', 'jefe_taller']
const REFRESCO_MS = 60000

const SELECT_OT =
  'id, numero_ot, estado, clickup_estado_actual, estado_cambiado_en, clickup_task_id, clickup_prioridad, clickup_fecha_programada, clickup_fecha_con_hora, clickup_detalle_en, vehiculos(patente, marca, modelo), clientes(tipo, nombre, apellido, razon_social)'

// PostgREST devuelve un objeto o un arreglo de uno según cómo infiera la relación.
function uno(valor) {
  return Array.isArray(valor) ? valor[0] : valor
}

const RAYADO =
  'repeating-linear-gradient(45deg, rgba(100,116,139,0.18) 0 2px, transparent 2px 8px)'

// Dibujo interno de cada tipo de figura, sin capturar el mouse: solo da
// contexto visual (rieles del elevador, pozo, círculo del neumático...).
function Decoracion({ elemento }) {
  const vertical = orientacionLarga(elemento) === 'vertical'
  const lado = Math.min(elemento.ancho, elemento.alto) * CELDA
  const centrada = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }

  const rieles = (clase) => (
    <>
      <div
        className={`absolute rounded ${clase}`}
        style={vertical ? { left: '20%', width: '8%', top: '12%', height: '76%' } : { top: '20%', height: '8%', left: '12%', width: '76%' }}
      />
      <div
        className={`absolute rounded ${clase}`}
        style={vertical ? { left: '72%', width: '8%', top: '12%', height: '76%' } : { top: '72%', height: '8%', left: '12%', width: '76%' }}
      />
    </>
  )

  switch (elemento.tipo) {
    case 'isla_elevador':
      return <div className="pointer-events-none absolute inset-0">{rieles('bg-red-700/45')}</div>
    case 'isla_simple':
      return (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-[18%] rounded-xl border-2 border-dashed border-red-500/50" />
        </div>
      )
    case 'isla_pozo':
      return (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded border border-slate-700/60 bg-slate-800/40"
            style={vertical ? { left: '34%', width: '32%', top: '12%', height: '76%' } : { top: '34%', height: '32%', left: '12%', width: '76%' }}
          />
        </div>
      )
    case 'alineadora': {
      const puntos = vertical
        ? [[24, 22], [76, 22], [24, 78], [76, 78]]
        : [[22, 24], [22, 76], [78, 24], [78, 76]]
      return (
        <div className="pointer-events-none absolute inset-0">
          {rieles('bg-slate-800/40')}
          {puntos.map(([izq, arr]) => (
            <div
              key={`${izq}-${arr}`}
              className="absolute h-2.5 w-2.5 rounded-full bg-slate-900/70"
              style={{ left: `${izq}%`, top: `${arr}%`, transform: 'translate(-50%, -50%)' }}
            />
          ))}
        </div>
      )
    }
    case 'vulcanizacion':
      return (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-full border-[5px] border-red-700/45"
            style={{ ...centrada, width: lado * 0.5, height: lado * 0.5 }}
          />
          <div className="absolute rounded-full bg-red-700/40" style={{ ...centrada, width: lado * 0.14, height: lado * 0.14 }} />
        </div>
      )
    case 'pulmon':
      return (
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: RAYADO }}>
          <div className="absolute inset-1 rounded border border-dashed border-green-600/60" />
        </div>
      )
    case 'desabolladura_pintura':
      return (
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: RAYADO }}>
          <div className="absolute inset-1.5 rounded border-2 border-red-400/60" />
        </div>
      )
    case 'lavado':
      return (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-full border-2 border-dashed border-red-500/50"
            style={{ ...centrada, width: lado * 0.7, height: lado * 0.7 }}
          />
        </div>
      )
    case 'recepcion_ingreso':
      return (
        <div className="pointer-events-none absolute inset-0">
          <span className="absolute bottom-0 right-1 text-lg font-bold leading-none text-orange-500/50">P</span>
        </div>
      )
    case 'oficina':
      return (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute bottom-2 right-2 h-3 w-10 rounded bg-slate-500/30" />
          <div className="absolute bottom-6 right-5 h-3 w-3 rounded-full bg-slate-500/40" />
        </div>
      )
    default:
      return null
  }
}

function FiguraPlano({
  elemento,
  caja,
  invalida,
  seleccionada,
  editando,
  ocupantes,
  tecnicoNombre,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSeleccionar,
  onTeclado,
}) {
  const config = TIPOS_PLANO[elemento.tipo]
  const ocupado = ocupantes.length > 0
  const anillo = invalida
    ? 'ring-2 ring-red-500'
    : seleccionada
      ? 'ring-2 ring-deep ring-offset-1'
      : ocupado && !editando
        ? 'ring-2 ring-amber-400'
        : ''

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${config.etiqueta}: ${elemento.nombre}`}
      onPointerDown={(evento) => onPointerDown(evento, elemento)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={() => onSeleccionar(elemento.id)}
      onKeyDown={(evento) => onTeclado(evento, elemento)}
      className={`absolute select-none overflow-hidden rounded-md border-2 outline-none ${config.clases} ${anillo} ${
        editando ? 'cursor-move touch-none' : 'cursor-pointer'
      } ${invalida ? 'opacity-70' : ''}`}
      style={{
        left: caja.x * CELDA,
        top: caja.y * CELDA,
        width: caja.ancho * CELDA,
        height: caja.alto * CELDA,
        ...(elemento.rotacion ? { transform: `rotate(${elemento.rotacion}deg)` } : {}),
      }}
    >
      <Decoracion elemento={{ ...elemento, ...caja }} />

      <div className="absolute left-1 right-1 top-0.5 truncate text-[10px] font-semibold leading-tight">{elemento.nombre}</div>

      {!editando && config.esPuesto && (
        <div className="absolute inset-x-1 bottom-1 top-4 overflow-hidden text-[10px] leading-tight">
          {ocupantes.length === 0 ? (
            <span className="text-slate-500/80">Libre</span>
          ) : (
            ocupantes.map((ocupacion) => {
              const ot = uno(ocupacion.trabajos_taller)
              const vehiculo = uno(ot?.vehiculos)
              return (
                <div key={ocupacion.id} className="mb-0.5 rounded bg-white/85 px-1 py-0.5 shadow-sm">
                  <div className="font-bold">{formatearPatente(vehiculo?.patente) || `OT ${ot?.numero_ot}`}</div>
                  <div className="truncate text-slate-600">{vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : ''}</div>
                  <div className="truncate text-slate-500">
                    {ot?.clickup_estado_actual || ot?.estado} · {formatoTranscurrido(ot?.estado_cambiado_en)}
                  </div>
                </div>
              )
            })
          )}
          {tecnicoNombre && <div className="truncate text-slate-600">Téc: {tecnicoNombre}</div>}
        </div>
      )}

      {editando && seleccionada && !elemento.rotacion && (
        <div
          data-manija="redimensionar"
          className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize rounded-tl bg-deep"
          title="Arrastra para cambiar el tamaño"
        />
      )}
    </div>
  )
}

function CampoNumero({ etiqueta, valor, minimo, onConfirmar }) {
  return (
    <label className="block">
      <span className="label">{etiqueta}</span>
      <input
        key={valor}
        type="number"
        min={minimo}
        defaultValue={valor}
        onBlur={(evento) => {
          const numero = Number(evento.target.value)
          if (Number.isInteger(numero) && numero !== valor) onConfirmar(numero)
          else evento.target.value = valor
        }}
        className="input"
      />
    </label>
  )
}

function Taller() {
  const { usuario } = useAuth()
  const puedeEditar = ROLES_EDITORES.includes(usuario?.rol)

  const [elementos, setElementos] = useState([])
  const [ocupacion, setOcupacion] = useState([])
  const [trabajos, setTrabajos] = useState([])
  const [tiposIsla, setTiposIsla] = useState([])
  const [tecnicos, setTecnicos] = useState([])
  const [tareas, setTareas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [actualizadoEn, setActualizadoEn] = useState(null)

  const [vista, setVista] = useState('kanban')
  const [estadosClickup, setEstadosClickup] = useState([])
  const [modo, setModo] = useState('vivo')
  const [seleccionadoId, setSeleccionadoId] = useState(null)
  const [previa, setPrevia] = useState(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState(false)
  const [otParaUbicar, setOtParaUbicar] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const arrastreRef = useRef(null)
  const editando = modo === 'editar'

  const cargar = useCallback(async (mostrarCargando = true) => {
    if (mostrarCargando) setCargando(true)
    try {
      const [respElementos, respOcupacion, respTrabajos, respTipos, respUsuarios, respTareas, respEstados] = await Promise.all([
        supabase.from('plano_elementos').select('*').order('creado_en'),
        supabase
          .from('plano_ocupacion')
          .select(`id, elemento_id, trabajo_id, desde, trabajos_taller(${SELECT_OT})`),
        supabase
          .from('trabajos_taller')
          .select(SELECT_OT)
          .not('estado', 'in', '(entregado,anulado)')
          .order('numero_ot', { ascending: false })
          .limit(300),
        supabase.from('tipos_isla').select('id, nombre, capacidad, orden').eq('activo', true).order('orden'),
        supabase.from('usuarios').select('id, nombre_completo, rol').eq('activo', true).order('nombre_completo'),
        supabase
          .from('tareas_taller')
          .select('id, trabajo_id, descripcion, estado, completada, tecnico_id, clickup_asignado_nombre, trabajos_taller!inner(estado)')
          .filter('trabajos_taller.estado', 'not.in', '(entregado,anulado)'),
        supabase.from('clickup_estados').select('clickup_status_id, nombre, orden, tipo, color').order('orden'),
      ])

      const primerError =
        respElementos.error || respOcupacion.error || respTrabajos.error || respTipos.error || respUsuarios.error || respTareas.error
      if (primerError) {
        setError(primerError.message)
        return
      }

      setError(null)
      setElementos(respElementos.data || [])
      setEstadosClickup(respEstados.data || [])
      setOcupacion(respOcupacion.data || [])
      setTrabajos(respTrabajos.data || [])
      setTiposIsla(respTipos.data || [])
      setTecnicos(respUsuarios.data || [])
      setTareas(respTareas.data || [])
      setActualizadoEn(new Date())
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // El refresco automático solo corre en el modo en vivo: en el editor pisaría
  // lo que la persona está moviendo.
  useEffect(() => {
    if (editando) return undefined
    const intervalo = setInterval(() => cargar(false), REFRESCO_MS)
    return () => clearInterval(intervalo)
  }, [editando, cargar])

  const seleccionado = elementos.find((elemento) => elemento.id === seleccionadoId) || null

  const ocupantesPorElemento = new Map()
  for (const fila of ocupacion) {
    if (!ocupantesPorElemento.has(fila.elemento_id)) ocupantesPorElemento.set(fila.elemento_id, [])
    ocupantesPorElemento.get(fila.elemento_id).push(fila)
  }
  const ubicadas = new Map(ocupacion.map((fila) => [fila.trabajo_id, fila.elemento_id]))
  const otsSinPuesto = trabajos.filter((ot) => !ubicadas.has(ot.id))

  const nombreTecnico = (id) => tecnicos.find((t) => t.id === id)?.nombre_completo || null
  const tecnicosDeElemento = (elemento) => {
    if (elemento.tecnico_id) return nombreTecnico(elemento.tecnico_id)
    const nombres = new Set()
    for (const fila of ocupantesPorElemento.get(elemento.id) || []) {
      for (const tarea of tareas) {
        if (tarea.trabajo_id !== fila.trabajo_id) continue
        const nombre = tarea.tecnico_id ? nombreTecnico(tarea.tecnico_id) : tarea.clickup_asignado_nombre
        if (nombre) nombres.add(nombre)
      }
    }
    return [...nombres].join(', ') || null
  }

  // ---- Escritura del plano ------------------------------------------------

  async function guardarCambios(id, cambios, recargar = false) {
    const anterior = elementos.find((elemento) => elemento.id === id)
    setElementos((previos) => previos.map((elemento) => (elemento.id === id ? { ...elemento, ...cambios } : elemento)))
    try {
      const { error: errorUpdate } = await supabase.from('plano_elementos').update(cambios).eq('id', id)
      if (errorUpdate) throw errorUpdate
      setError(null)
      if (recargar) await cargar(false)
    } catch (excepcion) {
      setError(excepcion.message)
      if (anterior) setElementos((previos) => previos.map((elemento) => (elemento.id === id ? anterior : elemento)))
    }
  }

  async function crearElemento(tipo) {
    const config = TIPOS_PLANO[tipo]
    const hueco = buscarHueco(config.ancho, config.alto, elementos)
    if (!hueco) {
      setError('No queda espacio libre en el plano para esta figura. Mueve o elimina alguna.')
      return
    }
    const cantidad = elementos.filter((elemento) => elemento.tipo === tipo).length + 1
    const isla = buscarIslaPorNombre(tiposIsla, config.islaNombre)
    setOcupado(true)
    try {
      const { data, error: errorInsert } = await supabase
        .from('plano_elementos')
        .insert({
          empresa_id: usuario.empresa_id,
          tipo,
          nombre: `${config.etiqueta} ${cantidad}`,
          x: hueco.x,
          y: hueco.y,
          ancho: config.ancho,
          alto: config.alto,
          capacidad_vehiculos: config.capacidad ?? 1,
          tipo_isla_id: isla ? isla.id : null,
        })
        .select()
        .single()
      if (errorInsert) throw errorInsert
      setError(null)
      await cargar(false)
      setSeleccionadoId(data.id)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  async function cargarPlanoBase() {
    const filas = PLANO_BASE.map((item) => {
      const config = TIPOS_PLANO[item.tipo]
      const isla = buscarIslaPorNombre(tiposIsla, islaNombreDeItem(item))
      return {
        empresa_id: usuario.empresa_id,
        tipo: item.tipo,
        nombre: item.nombre,
        x: item.x,
        y: item.y,
        ancho: item.ancho ?? config.ancho,
        alto: item.alto ?? config.alto,
        rotacion: item.rotacion ?? 0,
        capacidad_vehiculos: config.capacidad ?? 1,
        tipo_isla_id: isla ? isla.id : null,
      }
    })
    setOcupado(true)
    try {
      const { error: errorInsert } = await supabase.from('plano_elementos').insert(filas)
      if (errorInsert) throw errorInsert
      setError(null)
      await cargar(false)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  async function eliminarSeleccionado() {
    if (!seleccionado) return
    setOcupado(true)
    try {
      const { error: errorDelete } = await supabase.from('plano_elementos').delete().eq('id', seleccionado.id)
      if (errorDelete) throw errorDelete
      setError(null)
      setSeleccionadoId(null)
      setConfirmarEliminar(false)
      await cargar(false)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  function girarSeleccionado() {
    if (!seleccionado) return
    const caja = { x: seleccionado.x, y: seleccionado.y, ancho: seleccionado.alto, alto: seleccionado.ancho }
    if (!posicionValida(caja, elementos, seleccionado.id)) {
      setError('No hay espacio para girar esta figura en su posición actual.')
      return
    }
    guardarCambios(seleccionado.id, { ancho: caja.ancho, alto: caja.alto })
  }

  function cambiarCaja(campo, valor) {
    if (!seleccionado) return
    const caja = { x: seleccionado.x, y: seleccionado.y, ancho: seleccionado.ancho, alto: seleccionado.alto, [campo]: valor }
    if ((campo === 'ancho' || campo === 'alto') && valor < 1) return
    if (!posicionValida(caja, elementos, seleccionado.id)) {
      setError('Esa posición o tamaño se sale del plano o pisa otra figura.')
      return
    }
    guardarCambios(seleccionado.id, { [campo]: valor })
  }

  // ---- Operación en vivo --------------------------------------------------

  async function ubicarOt(elemento, trabajoId) {
    if (!trabajoId) return
    const ocupantes = ocupantesPorElemento.get(elemento.id) || []
    const yaEstaAqui = ocupantes.some((fila) => fila.trabajo_id === trabajoId)
    if (!yaEstaAqui && ocupantes.length >= elemento.capacidad_vehiculos) {
      setError('Este puesto ya está completo. Libera un vehículo antes de ubicar otro.')
      return
    }
    setOcupado(true)
    try {
      const { error: errorDelete } = await supabase.from('plano_ocupacion').delete().eq('trabajo_id', trabajoId)
      if (errorDelete) throw errorDelete
      const { error: errorInsert } = await supabase.from('plano_ocupacion').insert({
        empresa_id: usuario.empresa_id,
        elemento_id: elemento.id,
        trabajo_id: trabajoId,
        asignado_por: usuario.id,
      })
      if (errorInsert) throw errorInsert
      setError(null)
      setOtParaUbicar('')
      await cargar(false)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  async function liberarOcupacion(id) {
    setOcupado(true)
    try {
      const { error: errorDelete } = await supabase.from('plano_ocupacion').delete().eq('id', id)
      if (errorDelete) throw errorDelete
      setError(null)
      await cargar(false)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setOcupado(false)
    }
  }

  // ---- Arrastre (mover / redimensionar) -----------------------------------

  function iniciarArrastre(evento, elemento) {
    if (!editando) return
    evento.stopPropagation()
    setSeleccionadoId(elemento.id)
    setConfirmarEliminar(false)
    const redimensiona = evento.target.dataset?.manija === 'redimensionar'
    evento.currentTarget.setPointerCapture(evento.pointerId)
    arrastreRef.current = {
      id: elemento.id,
      modo: redimensiona ? 'redimensionar' : 'mover',
      x0: evento.clientX,
      y0: evento.clientY,
      base: { x: elemento.x, y: elemento.y, ancho: elemento.ancho, alto: elemento.alto },
      caja: null,
      valida: true,
    }
  }

  function moverArrastre(evento) {
    const arrastre = arrastreRef.current
    if (!arrastre) return
    const dx = Math.round((evento.clientX - arrastre.x0) / CELDA)
    const dy = Math.round((evento.clientY - arrastre.y0) / CELDA)
    const caja =
      arrastre.modo === 'mover'
        ? { ...arrastre.base, x: arrastre.base.x + dx, y: arrastre.base.y + dy }
        : { ...arrastre.base, ancho: Math.max(1, arrastre.base.ancho + dx), alto: Math.max(1, arrastre.base.alto + dy) }
    arrastre.caja = caja
    arrastre.valida = posicionValida(caja, elementos, arrastre.id)
    setPrevia({ id: arrastre.id, ...caja, valida: arrastre.valida })
  }

  function terminarArrastre() {
    const arrastre = arrastreRef.current
    arrastreRef.current = null
    setPrevia(null)
    if (!arrastre || !arrastre.caja || !arrastre.valida) return
    const { base, caja } = arrastre
    if (base.x === caja.x && base.y === caja.y && base.ancho === caja.ancho && base.alto === caja.alto) return
    guardarCambios(arrastre.id, { x: caja.x, y: caja.y, ancho: caja.ancho, alto: caja.alto })
  }

  // Alternativa de teclado al arrastre: flechas mueven una celda.
  function manejarTeclado(evento, elemento) {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault()
      setSeleccionadoId(elemento.id)
      return
    }
    if (!editando) return
    const pasos = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const paso = pasos[evento.key]
    if (!paso) return
    evento.preventDefault()
    const caja = { x: elemento.x + paso[0], y: elemento.y + paso[1], ancho: elemento.ancho, alto: elemento.alto }
    if (posicionValida(caja, elementos, elemento.id)) guardarCambios(elemento.id, { x: caja.x, y: caja.y })
  }

  function cambiarModo(nuevoModo) {
    setModo(nuevoModo)
    setConfirmarEliminar(false)
    setPrevia(null)
    if (nuevoModo === 'vivo') cargar(false)
  }

  // ---- Render -------------------------------------------------------------

  function dibujarFigura(figura) {
    const enPrevia = previa && previa.id === figura.id
                  const caja = enPrevia ? previa : figura
                  return (
                    <FiguraPlano
                      key={figura.id}
                      elemento={figura}
                      caja={caja}
                      invalida={Boolean(enPrevia && !previa.valida)}
                      seleccionada={figura.id === seleccionadoId}
                      editando={editando}
                      ocupantes={ocupantesPorElemento.get(figura.id) || []}
                      tecnicoNombre={tecnicosDeElemento(figura)}
                      onPointerDown={iniciarArrastre}
                      onPointerMove={moverArrastre}
                      onPointerUp={terminarArrastre}
                      onSeleccionar={setSeleccionadoId}
                      onTeclado={manejarTeclado}
                    />
                  )
  }

  const puestos = elementos.filter((elemento) => TIPOS_PLANO[elemento.tipo]?.esPuesto)
  const puestosOcupados = puestos.filter((elemento) => (ocupantesPorElemento.get(elemento.id) || []).length > 0).length
  const porCategoria = contarPorCategoria(elementos)
  const ocupadosPorCategoria = contarPorCategoria(
    elementos.filter((elemento) => (ocupantesPorElemento.get(elemento.id) || []).length > 0)
  )

  const fondoGrilla = editando
    ? {
        backgroundImage:
          'linear-gradient(to right, rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.35) 1px, transparent 1px)',
        backgroundSize: `${CELDA}px ${CELDA}px`,
      }
    : {}

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Taller</h1>
          <p className="text-sm text-slate-500">
            {editando
              ? 'Editando el plano: los cambios se guardan al soltar. Cada cuadro mide 1 m.'
              : `${actualizadoEn ? `Actualizado ${actualizadoEn.toLocaleTimeString('es-CL')}` : ''} · se refresca solo cada minuto`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm" role="group" aria-label="Vista del taller">
            <button
              type="button"
              onClick={() => setVista('kanban')}
              aria-pressed={vista === 'kanban'}
              className={`rounded-md px-3 py-1.5 font-medium ${vista === 'kanban' ? 'bg-deep text-white' : 'text-slate-600 hover:bg-mist'}`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setVista('plano')}
              aria-pressed={vista === 'plano'}
              className={`rounded-md px-3 py-1.5 font-medium ${vista === 'plano' ? 'bg-deep text-white' : 'text-slate-600 hover:bg-mist'}`}
            >
              Plano
            </button>
          </div>

          {vista === 'plano' && puedeEditar && (
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm" role="group" aria-label="Modo del plano">
              <button
                type="button"
                onClick={() => cambiarModo('vivo')}
                aria-pressed={!editando}
                className={`rounded-md px-3 py-1.5 font-medium ${!editando ? 'bg-deep text-white' : 'text-slate-600 hover:bg-mist'}`}
              >
                En vivo
              </button>
              <button
                type="button"
                onClick={() => cambiarModo('editar')}
                aria-pressed={editando}
                className={`rounded-md px-3 py-1.5 font-medium ${editando ? 'bg-deep text-white' : 'text-slate-600 hover:bg-mist'}`}
              >
                Editar plano
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {vista === 'kanban' && !cargando && (
        <Kanban
          empresaId={usuario.empresa_id}
          usuario={usuario}
          puedeEditar={puedeEditar}
          trabajos={trabajos}
          tareas={tareas}
          elementos={elementos}
          ocupacion={ocupacion}
          tecnicos={tecnicos}
          estadosClickup={estadosClickup}
          onUbicar={ubicarOt}
          onLiberar={liberarOcupacion}
          onRecargar={() => cargar(false)}
        />
      )}
      {vista === 'kanban' && cargando && <p className="text-slate-500">Cargando…</p>}

      {vista === 'plano' && (
        <>
      {editando && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-500">Agregar</span>
          {ORDEN_PALETA.map((tipo) => (
            <button
              key={tipo}
              type="button"
              disabled={ocupado}
              onClick={() => crearElemento(tipo)}
              className={`rounded border-2 px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${TIPOS_PLANO[tipo].clases}`}
            >
              + {TIPOS_PLANO[tipo].etiqueta}
            </button>
          ))}
        </div>
      )}

      {!cargando && elementos.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          {Object.entries(CATEGORIAS_PLANO).map(([clave, categoria]) => (
            <span key={clave} className="flex items-center gap-2 text-slate-700">
              <span className={`h-3 w-6 rounded-sm border-2 ${categoria.muestra}`} />
              {categoria.etiqueta} ({porCategoria[clave]})
              {!editando && (
                <span className="text-xs text-slate-500">
                  · {ocupadosPorCategoria[clave]} con vehículo
                </span>
              )}
            </span>
          ))}
          <span className="ml-auto text-xs text-slate-500">
            {COLUMNAS} m x {FILAS} m · {(COLUMNAS * FILAS).toLocaleString('es-CL')} m²
          </span>
        </div>
      )}

      {cargando ? (
        <p className="text-slate-500">Cargando el plano…</p>
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border border-slate-300 bg-white">
                <div
                  className="relative"
                  style={{ width: COLUMNAS * CELDA, height: FILAS * CELDA, ...fondoGrilla }}
                  onPointerDown={(evento) => {
                    if (evento.target === evento.currentTarget) setSeleccionadoId(null)
                  }}
                >
                  {elementos.map(dibujarFigura)}
                </div>
              </div>

              {elementos.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="pointer-events-auto max-w-sm rounded-lg border border-dashed border-slate-300 bg-white/90 p-5 text-center">
                    <p className="font-medium text-slate-800">Todavía no hay un plano dibujado</p>
                    {puedeEditar ? (
                      <>
                        <p className="mt-1 text-sm text-slate-500">
                          Agrega figuras desde la barra superior en modo edición, o parte del plano base del taller (33 m x 65 m).
                        </p>
                        <div className="mt-3 flex justify-center gap-2">
                          {!editando && (
                            <button type="button" className="btn-ghost" onClick={() => cambiarModo('editar')}>
                              Editar plano
                            </button>
                          )}
                          <button type="button" className="btn-primary" disabled={ocupado} onClick={cargarPlanoBase}>
                            Cargar plano base del taller
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Pide al jefe de taller que lo dibuje.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {editando && (
              <p className="mt-2 text-xs text-slate-500">
                Arrastra una figura para moverla, o la esquina azul para cambiar su tamaño. Con una figura enfocada, las flechas la mueven una celda.
              </p>
            )}
          </div>

          <aside className="w-full shrink-0 space-y-4 xl:w-80">
            {seleccionado ? (
              <PanelElemento
                elemento={seleccionado}
                editando={editando}
                puedeEditar={puedeEditar}
                tiposIsla={tiposIsla}
                tecnicos={tecnicos}
                ocupantes={ocupantesPorElemento.get(seleccionado.id) || []}
                trabajos={trabajos}
                ubicadas={ubicadas}
                elementos={elementos}
                otParaUbicar={otParaUbicar}
                setOtParaUbicar={setOtParaUbicar}
                confirmarEliminar={confirmarEliminar}
                setConfirmarEliminar={setConfirmarEliminar}
                ocupado={ocupado}
                onGuardar={(cambios, recargar) => guardarCambios(seleccionado.id, cambios, recargar)}
                onCambiarCaja={cambiarCaja}
                onGirar={girarSeleccionado}
                onEliminar={eliminarSeleccionado}
                onUbicar={(trabajoId) => ubicarOt(seleccionado, trabajoId)}
                onLiberar={liberarOcupacion}
              />
            ) : (
              <>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-2 text-sm font-semibold text-slate-900">Resumen</h2>
                  <p className="text-sm text-slate-600">
                    {puestos.length} puesto{puestos.length === 1 ? '' : 's'} · {puestosOcupados} con vehículo ·{' '}
                    {puestos.length - puestosOcupados} libre{puestos.length - puestosOcupados === 1 ? '' : 's'}
                  </p>
                  <h3 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Puestos por tipo de isla
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {tiposIsla.map((isla) => {
                      const dibujados = elementos.filter((elemento) => elemento.tipo_isla_id === isla.id).length
                      return (
                        <li key={isla.id} className="flex justify-between text-slate-700">
                          <span>{isla.nombre}</span>
                          <span className="text-slate-500">
                            {dibujados} en el plano
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-2 text-xs text-slate-400">
                    La capacidad de la Agenda depende del equipo disponible (botón Equipo de la Agenda), no de los puestos: varios puestos quedan ocupados por vehículos que esperan un repuesto.
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h2 className="mb-2 text-sm font-semibold text-slate-900">
                    OT activas sin puesto ({otsSinPuesto.length})
                  </h2>
                  {otsSinPuesto.length === 0 ? (
                    <p className="text-sm text-slate-400">Todas las OT activas tienen puesto.</p>
                  ) : (
                    <ul className="max-h-72 space-y-1.5 overflow-auto text-sm">
                      {otsSinPuesto.map((ot) => {
                        const vehiculo = uno(ot.vehiculos)
                        return (
                          <li key={ot.id} className="rounded bg-slate-50 px-2 py-1.5">
                            <div className="font-medium text-slate-800">
                              OT {ot.numero_ot} · {formatearPatente(vehiculo?.patente)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {vehiculo ? `${vehiculo.marca} ${vehiculo.modelo}` : ''} · {nombreCliente(uno(ot.clientes))}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {!editando && puedeEditar && otsSinPuesto.length > 0 && (
                    <p className="mt-2 text-xs text-slate-400">Toca un puesto del plano para ubicar una OT en él.</p>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function PanelElemento({
  elemento,
  editando,
  puedeEditar,
  tiposIsla,
  tecnicos,
  ocupantes,
  trabajos,
  ubicadas,
  elementos,
  otParaUbicar,
  setOtParaUbicar,
  confirmarEliminar,
  setConfirmarEliminar,
  ocupado,
  onGuardar,
  onCambiarCaja,
  onGirar,
  onEliminar,
  onUbicar,
  onLiberar,
}) {
  const config = TIPOS_PLANO[elemento.tipo]
  const esPuesto = config.esPuesto
  const responsables = tecnicos.filter((t) => ['tecnico', 'detailer', 'jefe_taller'].includes(t.rol))
  const nombreElemento = (id) => elementos.find((e) => e.id === id)?.nombre

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{config.etiqueta}</div>
        <h2 className="text-base font-semibold text-slate-900">{elemento.nombre}</h2>
      </div>

      {editando ? (
        <div className="space-y-3">
          <label className="block">
            <span className="label">Nombre</span>
            <input
              key={elemento.nombre}
              type="text"
              maxLength={60}
              defaultValue={elemento.nombre}
              onBlur={(evento) => {
                const texto = evento.target.value.trim()
                if (texto && texto !== elemento.nombre) onGuardar({ nombre: texto })
                else evento.target.value = elemento.nombre
              }}
              className="input"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <CampoNumero etiqueta="Columna" valor={elemento.x} minimo={0} onConfirmar={(v) => onCambiarCaja('x', v)} />
            <CampoNumero etiqueta="Fila" valor={elemento.y} minimo={0} onConfirmar={(v) => onCambiarCaja('y', v)} />
            <CampoNumero etiqueta="Ancho (celdas)" valor={elemento.ancho} minimo={1} onConfirmar={(v) => onCambiarCaja('ancho', v)} />
            <CampoNumero etiqueta="Alto (celdas)" valor={elemento.alto} minimo={1} onConfirmar={(v) => onCambiarCaja('alto', v)} />
            <CampoNumero
              etiqueta="Rotación (grados)"
              valor={elemento.rotacion || 0}
              minimo={0}
              onConfirmar={(v) => {
                if (v >= 0 && v <= 359) onGuardar({ rotacion: v })
              }}
            />
          </div>

          {esPuesto && (
            <>
              <label className="block">
                <span className="label">Tipo de isla</span>
                <select
                  value={elemento.tipo_isla_id || ''}
                  onChange={(evento) => onGuardar({ tipo_isla_id: evento.target.value || null }, true)}
                  className="input"
                >
                  <option value="">Sin tipo</option>
                  {tiposIsla.map((isla) => (
                    <option key={isla.id} value={isla.id}>
                      {isla.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <CampoNumero
                etiqueta="Vehículos a la vez"
                valor={elemento.capacidad_vehiculos}
                minimo={1}
                onConfirmar={(v) => {
                  if (v >= 1 && v <= 20) onGuardar({ capacidad_vehiculos: v })
                }}
              />

              <label className="block">
                <span className="label">Técnico responsable</span>
                <select
                  value={elemento.tecnico_id || ''}
                  onChange={(evento) => onGuardar({ tecnico_id: evento.target.value || null })}
                  className="input"
                >
                  <option value="">Sin asignar (se deduce de las tareas de la OT)</option>
                  {responsables.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre_completo}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-ghost" onClick={onGirar}>
              Girar 90°
            </button>
            {confirmarEliminar ? (
              <>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={onEliminar}
                  className="btn bg-red-600 text-white hover:bg-red-700"
                >
                  Confirmar eliminar
                </button>
                <button type="button" className="btn-ghost" onClick={() => setConfirmarEliminar(false)}>
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirmarEliminar(true)}>
                Eliminar
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {esPuesto && (
            <div className="text-slate-600">
              Capacidad: {ocupantes.length} de {elemento.capacidad_vehiculos} vehículo
              {elemento.capacidad_vehiculos === 1 ? '' : 's'}
              {elemento.tecnico_id && (
                <div>Responsable: {tecnicos.find((t) => t.id === elemento.tecnico_id)?.nombre_completo}</div>
              )}
              {elemento.tipo_isla_id && (
                <div>Agenda: {tiposIsla.find((i) => i.id === elemento.tipo_isla_id)?.nombre}</div>
              )}
            </div>
          )}

          {esPuesto && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Ahora en este puesto</h3>
              {ocupantes.length === 0 ? (
                <p className="text-slate-400">Libre.</p>
              ) : (
                <ul className="space-y-2">
                  {ocupantes.map((fila) => {
                    const ot = uno(fila.trabajos_taller)
                    const vehiculo = uno(ot?.vehiculos)
                    return (
                      <li key={fila.id} className="rounded bg-slate-50 p-2">
                        <div className="font-medium text-slate-800">
                          OT {ot?.numero_ot} · {formatearPatente(vehiculo?.patente)} {vehiculo?.marca} {vehiculo?.modelo}
                        </div>
                        <div className="text-xs text-slate-500">{nombreCliente(uno(ot?.clientes))}</div>
                        <div className="mt-1 flex items-center justify-between text-xs">
                          <span className="rounded bg-slate-200 px-2 py-0.5 text-slate-700">
                            {ot?.clickup_estado_actual || ot?.estado}
                          </span>
                          <span className="text-slate-500">en puesto hace {formatoTranscurrido(fila.desde)}</span>
                        </div>
                        {puedeEditar && (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => onLiberar(fila.id)}
                            className="mt-1 text-xs text-slate-500 hover:text-red-600"
                          >
                            Liberar puesto
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {esPuesto && puedeEditar && (
            <div>
              <label className="label" htmlFor="ot-ubicar">
                Ubicar una OT aquí
              </label>
              <select id="ot-ubicar" value={otParaUbicar} onChange={(evento) => setOtParaUbicar(evento.target.value)} className="input">
                <option value="">Elige una OT activa…</option>
                {trabajos.map((ot) => {
                  const vehiculo = uno(ot.vehiculos)
                  const donde = ubicadas.get(ot.id)
                  return (
                    <option key={ot.id} value={ot.id}>
                      OT {ot.numero_ot} · {formatearPatente(vehiculo?.patente)}
                      {donde ? ` (en ${nombreElemento(donde) || 'otro puesto'})` : ''}
                    </option>
                  )
                })}
              </select>
              <button
                type="button"
                disabled={!otParaUbicar || ocupado}
                onClick={() => onUbicar(otParaUbicar)}
                className="btn-primary mt-2 w-full"
              >
                Ubicar en este puesto
              </button>
            </div>
          )}

          {!esPuesto && <p className="text-slate-400">Espacio administrativo, sin vehículos.</p>}
        </div>
      )}
    </div>
  )
}

export default Taller
