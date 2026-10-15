import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { GRUPOS, REPORTES, itemsVisibles, normalizarTexto } from '../lib/navegacion'
import { formatearPatente, normalizarPatente } from '../lib/patente'
import Icono from './Icono'

const MIN_CARACTERES = 2
const ESPERA_MS = 280
const SIN_ENTIDADES = { clientes: [], vehiculos: [], ots: [] }

// Los caracteres con significado en los filtros de PostgREST (coma, paréntesis,
// comodines) se quitan del texto antes de armar la consulta.
function limpiarParaFiltro(texto) {
  return texto.replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

function nombreCliente(cliente) {
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

// Buscador de la barra superior: pantallas y reportes (se filtran en el
// navegador según el rol) más clientes, vehículos y OT (se consultan en vivo).
// Atajos: Ctrl/Cmd + K o "/" para enfocarlo, flechas para moverse, Enter para
// abrir, Esc para cerrar.
function BuscadorGlobal() {
  const { usuario } = useAuth()
  const navegar = useNavigate()
  const rol = usuario?.rol

  const [texto, setTexto] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(0)
  const [entidades, setEntidades] = useState(SIN_ENTIDADES)
  const [buscando, setBuscando] = useState(false)
  const contenedor = useRef(null)
  const entrada = useRef(null)
  const solicitud = useRef(0)

  const paginas = useMemo(
    () =>
      GRUPOS.flatMap((grupo) =>
        itemsVisibles(grupo, rol).map((item) => ({
          tipo: 'Pantallas',
          etiqueta: item.label,
          detalle: grupo.titulo || 'Principal',
          to: item.to,
          icono: item.icono,
          indice: normalizarTexto(item.label),
        }))
      ),
    [rol]
  )

  const reportes = useMemo(
    () =>
      REPORTES.filter((reporte) => !reporte.roles || reporte.roles.includes(rol)).map((reporte) => ({
        tipo: 'Reportes y vistas',
        etiqueta: reporte.label,
        detalle: 'Reporte',
        to: reporte.to,
        icono: reporte.icono,
        indice: normalizarTexto(`${reporte.label} ${reporte.palabras}`),
      })),
    [rol]
  )

  const palabras = normalizarTexto(texto).split(/\s+/).filter(Boolean)
  const coincide = (opcion) => palabras.every((palabra) => opcion.indice.includes(palabra))
  const enPaginas = palabras.length ? paginas.filter(coincide).slice(0, 5) : []
  const enReportes = palabras.length ? reportes.filter(coincide).slice(0, 6) : reportes.slice(0, 5)

  const opciones = [
    ...enPaginas,
    ...enReportes,
    ...entidades.clientes.map((cliente) => ({
      tipo: 'Clientes',
      etiqueta: nombreCliente(cliente),
      detalle: [cliente.rut, cliente.telefono].filter(Boolean).join(' · ') || 'Cliente',
      to: `/clientes/${cliente.id}`,
      icono: 'clientes',
    })),
    ...entidades.vehiculos.map((vehiculo) => {
      const duenio = Array.isArray(vehiculo.clientes_vehiculos) ? vehiculo.clientes_vehiculos[0] : vehiculo.clientes_vehiculos
      return {
        tipo: 'Vehículos',
        etiqueta: `${formatearPatente(vehiculo.patente)} · ${vehiculo.marca} ${vehiculo.modelo}`,
        detalle: duenio ? 'Ver ficha del cliente' : 'Sin cliente vinculado',
        to: duenio ? `/clientes/${duenio.cliente_id}` : '/clientes',
        icono: 'trabajos',
      }
    }),
    ...entidades.ots.map((ot) => {
      const vehiculo = Array.isArray(ot.vehiculos) ? ot.vehiculos[0] : ot.vehiculos
      return {
        tipo: 'Órdenes de trabajo',
        etiqueta: `OT ${ot.numero_ot}`,
        detalle: vehiculo ? `${formatearPatente(vehiculo.patente)} · ${vehiculo.marca} ${vehiculo.modelo}` : 'Orden de trabajo',
        to: `/trabajos/${ot.id}`,
        icono: 'trabajos',
      }
    }),
  ]

  // Búsqueda en vivo, con espera para no consultar en cada tecla y con un
  // contador de solicitud para descartar respuestas que llegan tarde.
  useEffect(() => {
    const termino = limpiarParaFiltro(texto)
    if (termino.length < MIN_CARACTERES) {
      solicitud.current += 1
      setEntidades(SIN_ENTIDADES)
      setBuscando(false)
      return undefined
    }

    const idSolicitud = ++solicitud.current
    setBuscando(true)
    const temporizador = setTimeout(async () => {
      try {
        const patenteNorm = normalizarPatente(termino)
        const digitos = termino.replace(/[^0-9kK]/g, '')
        const filtroClientes = [
          `nombre.ilike.%${termino}%`,
          `apellido.ilike.%${termino}%`,
          `razon_social.ilike.%${termino}%`,
          `rut.ilike.%${termino}%`,
          `telefono.ilike.%${termino}%`,
          digitos.length >= 4 ? `rut_norm.ilike.%${digitos}%` : null,
        ]
          .filter(Boolean)
          .join(',')

        const [clientes, vehiculos, ots] = await Promise.all([
          supabase
            .from('clientes')
            .select('id, tipo, nombre, apellido, razon_social, rut, telefono')
            .is('eliminado_en', null)
            .or(filtroClientes)
            .limit(5),
          patenteNorm.length >= 2
            ? supabase
                .from('vehiculos')
                .select('id, patente, marca, modelo, clientes_vehiculos(cliente_id)')
                .is('eliminado_en', null)
                .or(`patente_norm.ilike.%${patenteNorm}%,marca.ilike.%${termino}%,modelo.ilike.%${termino}%`)
                .limit(5)
            : Promise.resolve({ data: [] }),
          /^\d{3,}$/.test(termino)
            ? supabase.from('trabajos_taller').select('id, numero_ot, vehiculos(patente, marca, modelo)').eq('numero_ot', Number(termino)).limit(3)
            : Promise.resolve({ data: [] }),
        ])
        if (idSolicitud !== solicitud.current) return
        setEntidades({ clientes: clientes.data || [], vehiculos: vehiculos.data || [], ots: ots.data || [] })
      } catch {
        if (idSolicitud === solicitud.current) setEntidades(SIN_ENTIDADES)
      } finally {
        if (idSolicitud === solicitud.current) setBuscando(false)
      }
    }, ESPERA_MS)

    return () => clearTimeout(temporizador)
  }, [texto])

  useEffect(() => {
    setActivo(0)
  }, [texto, entidades])

  // Atajos globales y cierre al hacer clic fuera.
  useEffect(() => {
    function alTeclear(evento) {
      const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(evento.target?.tagName || '') || evento.target?.isContentEditable
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault()
        entrada.current?.focus()
        setAbierto(true)
      } else if (evento.key === '/' && !enCampo) {
        evento.preventDefault()
        entrada.current?.focus()
        setAbierto(true)
      }
    }
    function alPulsar(evento) {
      if (contenedor.current && !contenedor.current.contains(evento.target)) setAbierto(false)
    }
    document.addEventListener('keydown', alTeclear)
    document.addEventListener('mousedown', alPulsar)
    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.removeEventListener('mousedown', alPulsar)
    }
  }, [])

  function ir(opcion) {
    if (!opcion) return
    navegar(opcion.to)
    setAbierto(false)
    setTexto('')
    entrada.current?.blur()
  }

  function alTeclearEnCampo(evento) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      setAbierto(true)
      setActivo((valor) => (opciones.length ? (valor + 1) % opciones.length : 0))
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      setActivo((valor) => (opciones.length ? (valor - 1 + opciones.length) % opciones.length : 0))
    } else if (evento.key === 'Enter') {
      evento.preventDefault()
      ir(opciones[activo])
    } else if (evento.key === 'Escape') {
      setAbierto(false)
      entrada.current?.blur()
    }
  }

  const termino = limpiarParaFiltro(texto)
  const sinResultados = termino.length >= MIN_CARACTERES && !buscando && opciones.length === 0

  let seccionAnterior = null
  return (
    <div ref={contenedor} className="relative w-full max-w-xl">
      <label htmlFor="buscador-global" className="sr-only">
        Buscar clientes, patentes, órdenes de trabajo y reportes
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icono nombre="buscar" />
        </span>
        <input
          id="buscador-global"
          ref={entrada}
          type="text"
          role="combobox"
          aria-expanded={abierto}
          aria-controls="lista-buscador"
          aria-autocomplete="list"
          aria-activedescendant={abierto && opciones.length ? `opcion-buscador-${activo}` : undefined}
          autoComplete="off"
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value)
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={alTeclearEnCampo}
          placeholder="Buscar clientes, patentes, OT, reportes…"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-10 pr-16 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-deep focus:bg-white focus:ring-1 focus:ring-deep"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 sm:block">
          Ctrl K
        </kbd>
      </div>

      {abierto && (
        <div
          id="lista-buscador"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          {opciones.map((opcion, indice) => {
            const encabezado = opcion.tipo !== seccionAnterior ? opcion.tipo : null
            seccionAnterior = opcion.tipo
            const seleccionada = indice === activo
            return (
              <div key={`${opcion.tipo}-${opcion.to}-${opcion.etiqueta}-${indice}`}>
                {encabezado && (
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {palabras.length === 0 && opcion.tipo === 'Reportes y vistas' ? 'Sugerencias' : encabezado}
                  </div>
                )}
                <div
                  id={`opcion-buscador-${indice}`}
                  role="option"
                  aria-selected={seleccionada}
                  onMouseEnter={() => setActivo(indice)}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onClick={() => ir(opcion)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${
                    seleccionada ? 'bg-deep/10 text-slate-900' : 'text-slate-700'
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500">
                    <Icono nombre={opcion.icono} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{opcion.etiqueta}</span>
                    <span className="block truncate text-xs text-slate-500">{opcion.detalle}</span>
                  </span>
                </div>
              </div>
            )
          })}

          {buscando && <div className="px-3 py-2 text-xs text-slate-500">Buscando…</div>}
          {sinResultados && <div className="px-3 py-4 text-center text-sm text-slate-500">Sin resultados para «{termino}».</div>}
          {!termino && <div className="px-3 pb-1 pt-2 text-[11px] text-slate-400">Escribe un nombre, RUT, teléfono, patente o número de OT.</div>}
        </div>
      )}
    </div>
  )
}

export default BuscadorGlobal
