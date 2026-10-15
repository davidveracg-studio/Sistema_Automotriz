import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { invocarFuncion } from '../lib/invocarFuncion'
import { formatearPatente } from '../lib/patente'
import {
  bloqueEnCorte,
  citasEnBloque,
  cuposEnBloque,
  diaSemanaDe,
  etiquetaDeRango,
  etiquetaLarga,
  generarBloques,
  horaAMinutos,
  hoyLocalISO,
  moverFecha,
  NIVEL_DE_VISTA,
  nombreVisible,
  personalDeIsla,
  rangoDeVista,
  usaPersonal,
  validarReagendamiento,
} from '../lib/agenda'
import { armarPersonal } from '../lib/personal'
import PanelEquipo from '../components/agenda/PanelEquipo'
import TarjetaCita, { ETIQUETA_ESTADO } from '../components/agenda/TarjetaCita'
import VistaAnio from '../components/agenda/VistaAnio'
import VistaMes from '../components/agenda/VistaMes'
import VistaSemana from '../components/agenda/VistaSemana'

const VISTAS = [
  { clave: 'dia', etiqueta: 'Día' },
  { clave: 'semana', etiqueta: 'Semana' },
  { clave: 'mes', etiqueta: 'Mes' },
  { clave: 'anio', etiqueta: 'Año' },
]
const CLAVE_VISTA = 'agendaVista'

// La vista elegida se recuerda en este navegador; sin elección, el día.
function vistaInicial() {
  try {
    const guardada = localStorage.getItem(CLAVE_VISTA)
    if (VISTAS.some((vista) => vista.clave === guardada)) return guardada
  } catch {
    // Sin localStorage se parte en la vista de día.
  }
  return 'dia'
}

const ROLES_QUE_ADMINISTRAN_EQUIPO = ['admin', 'socia', 'jefe_taller']

// Cuántos técnicos hay disponibles para una isla ese día. Quien agenda solo ve la
// cantidad: a qué técnico va cada trabajo lo decide el jefe de taller en ClickUp.
function TecnicosDeIsla({ personal, islaId, fecha, horarios }) {
  const equipo = personalDeIsla(personal, islaId, fecha, horarios)
  if (equipo.length === 0) return <>sin técnicos</>
  const disponibles = equipo.filter((persona) => persona.trabaja).length
  return (
    <>
      {disponibles} de {equipo.length} técnico{equipo.length === 1 ? '' : 's'} disponible{disponibles === 1 ? '' : 's'}
    </>
  )
}

const BOTON_NAVEGACION =
  'grid h-9 w-9 place-items-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-deep'

function Agenda() {
  const { usuario } = useAuth()
  const [vista, setVista] = useState(vistaInicial)
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [tiposIsla, setTiposIsla] = useState([])
  const [citas, setCitas] = useState([])
  const [horariosAtencion, setHorariosAtencion] = useState([])
  const [corteMediodia, setCorteMediodia] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [prellenado, setPrellenado] = useState(null)
  const [avisoClickUp, setAvisoClickUp] = useState(null)
  const [expandidas, setExpandidas] = useState(() => new Set())
  const [avisoReagendada, setAvisoReagendada] = useState(null)
  // Animación al cambiar de vista: 'acercar' hacia el día, 'alejar' hacia el año.
  const [animacion, setAnimacion] = useState(null)
  const [origenZoom, setOrigenZoom] = useState('50% 20%')
  const contenedorVista = useRef(null)
  const sincronizandoClickUp = useRef(false)
  const [recargas, setRecargas] = useState(0)
  const [mostrarEquipo, setMostrarEquipo] = useState(false)
  const [equipoBase, setEquipoBase] = useState({ personas: [], habilidades: [], horarios: [] })
  const [ausencias, setAusencias] = useState([])
  const [versionEquipo, setVersionEquipo] = useState(0)
  const puedeAdministrarEquipo = ROLES_QUE_ADMINISTRAN_EQUIPO.includes(usuario?.rol)
  const personal = useMemo(() => armarPersonal({ ...equipoBase, ausencias }), [equipoBase, ausencias])

  useEffect(() => {
    async function cargarBase() {
      try {
        const [
          { data: islas, error: errorIslas },
          { data: horarios, error: errorHorarios },
          { data: empresa, error: errorEmpresa },
          respPersonas,
          respHabilidades,
          respHorariosPersonal,
        ] =
          await Promise.all([
            supabase.from('tipos_isla').select('id, nombre, capacidad, orden, opera_en_corte').eq('activo', true).order('orden'),
            supabase.from('horario_atencion').select('dia_semana, hora_apertura, hora_cierre').eq('empresa_id', usuario.empresa_id),
            supabase.from('empresas').select('corte_mediodia_inicio, corte_mediodia_fin').eq('id', usuario.empresa_id).maybeSingle(),
            supabase.from('personal_taller').select('id, nombre, cargo, activo, orden').eq('activo', true).order('orden'),
            supabase.from('personal_habilidades').select('personal_id, tipo_isla_id'),
            supabase.from('personal_horarios').select('personal_id, dia_semana, hora_inicio, hora_fin'),
          ])
        if (errorIslas) throw errorIslas
        if (errorHorarios) throw errorHorarios
        if (errorEmpresa) throw errorEmpresa
        // El equipo es opcional: si no carga, la Agenda usa la capacidad fija de cada isla.
        if (!respPersonas.error && !respHabilidades.error && !respHorariosPersonal.error) {
          setEquipoBase({ personas: respPersonas.data || [], habilidades: respHabilidades.data || [], horarios: respHorariosPersonal.data || [] })
        }
        setTiposIsla(islas || [])
        setHorariosAtencion(horarios || [])
        setCorteMediodia(
          empresa?.corte_mediodia_inicio ? { inicio: empresa.corte_mediodia_inicio, fin: empresa.corte_mediodia_fin } : null
        )
      } catch (excepcion) {
        setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      }
    }
    if (usuario?.empresa_id) cargarBase()
  }, [usuario, versionEquipo])

  // Las ausencias que tocan el rango visible (vacaciones, licencias, permisos).
  useEffect(() => {
    async function cargarAusencias() {
      try {
        const { desde, hasta } = rangoDeVista(vista, fecha)
        const { data, error: errorAusencias } = await supabase
          .from('personal_ausencias')
          .select('personal_id, desde, hasta, hora_desde, hora_hasta')
          .lte('desde', hasta)
          .gte('hasta', desde)
        if (!errorAusencias) setAusencias(data || [])
      } catch {
        // Sin las ausencias se muestra la disponibilidad normal del equipo.
      }
    }
    if (usuario?.empresa_id) cargarAusencias()
  }, [usuario, vista, fecha, versionEquipo])

  // Cada cita agendada (a mano o por el bot) crea su tarjeta en ClickUp, en el
  // estado "agenda". La base marca las citas pendientes (clickup_pendiente) y la
  // función clickup-agendar-cita las procesa: se llama al guardar una cita y al
  // abrir la Agenda, así se reintentan las que fallaron. Nunca bloquea la
  // pantalla: si falla, la cita ya está guardada y solo se avisa.
  async function sincronizarClickUp() {
    if (sincronizandoClickUp.current) return
    sincronizandoClickUp.current = true
    try {
      const resultado = await invocarFuncion('clickup-agendar-cita', { body: {} })
      if (resultado?.errores?.length) {
        setAvisoClickUp(
          `No se pudo enviar ${resultado.errores.length} cita(s) a ClickUp (${resultado.errores[0].mensaje}). Se reintentará al abrir la Agenda.`
        )
      } else {
        setAvisoClickUp(null)
        // Recarga la lista para mostrar la marca "en ClickUp" de lo recién enviado.
        if (resultado?.procesadas > 0) setRecargas((n) => n + 1)
      }
    } catch (excepcion) {
      setAvisoClickUp(`La cita se guardó, pero no se pudo enviar a ClickUp: ${excepcion.message}`)
    } finally {
      sincronizandoClickUp.current = false
    }
  }

  // Carga las citas del rango que pide la vista: un día, una semana o la
  // grilla completa de un mes.
  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { desde, hasta } = rangoDeVista(vista, fecha)

      // El año solo necesita lo justo para colorear cada día, y puede pasar del
      // tope de 1000 filas por consulta: se pide por páginas.
      if (vista === 'anio') {
        let filas = []
        for (let inicio = 0; ; inicio += 1000) {
          const { data: pagina, error: errorPagina } = await supabase
            .from('citas')
            .select('id, tipo_isla_id, fecha, hora, duracion_estimada_minutos, estado, clickup_pendiente')
            .gte('fecha', desde)
            .lte('fecha', hasta)
            .order('fecha')
            .order('id')
            .range(inicio, inicio + 999)
          if (errorPagina) throw errorPagina
          filas = filas.concat(pagina || [])
          if (!pagina || pagina.length < 1000) break
        }
        setCitas(filas)
        if (filas.some((cita) => cita.clickup_pendiente)) sincronizarClickUp()
        return
      }

      const { data: citasRango, error: errorCitas } = await supabase
        .from('citas')
        // trabajos_taller!citas_trabajo_id_fkey: desde el Bloque "ingreso
        // desde cita" (2026-09-15) trabajos_taller.cita_id agregó una
        // SEGUNDA relación entre estas dos tablas (la inversa de
        // citas.trabajo_id). PostgREST ya no puede adivinar sola cuál
        // usar para el embed -hay que nombrar la restricción a mano-.
        .select(
          'id, tipo_isla_id, fecha, hora, duracion_estimada_minutos, descripcion, estado, catalogo_servicio_id, origen, clickup_task_id, clickup_pendiente, clientes(id, tipo, nombre, apellido, razon_social, telefono), vehiculos(id, patente, marca, modelo), catalogo_servicios(categoria, servicio), trabajo_id, trabajos_taller!citas_trabajo_id_fkey(numero_ot)'
        )
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha')
        .order('hora', { nullsFirst: true })

      if (errorCitas) throw errorCitas
      setCitas(citasRango || [])
      if ((citasRango || []).some((cita) => cita.clickup_pendiente)) sincronizarClickUp()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, vista, recargas])

  async function actualizarEstado(id, estado) {
    try {
      const { error: errorActualizar } = await supabase.from('citas').update({ estado }).eq('id', id)
      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  function abrirFormulario(prellenadoInicial) {
    setPrellenado(prellenadoInicial || null)
    setMostrarFormulario(true)
  }

  function cambiarVista(nuevaVista) {
    const actual = NIVEL_DE_VISTA[vista]
    const siguiente = NIVEL_DE_VISTA[nuevaVista]
    setAnimacion(siguiente > actual ? 'acercar' : siguiente < actual ? 'alejar' : null)
    setVista(nuevaVista)
    try {
      localStorage.setItem(CLAVE_VISTA, nuevaVista)
    } catch {
      // Sin localStorage la elección dura solo esta visita.
    }
  }

  // El acercamiento parte desde el punto donde se hizo clic (el día o el mes
  // elegido); si no hubo clic (botones de arriba), desde el centro superior.
  function fijarOrigenDelZoom(evento) {
    const caja = evento?.currentTarget?.getBoundingClientRect?.()
    const contenedor = contenedorVista.current?.getBoundingClientRect()
    if (caja && contenedor && contenedor.width > 0 && contenedor.height > 0) {
      const x = ((caja.left + caja.width / 2 - contenedor.left) / contenedor.width) * 100
      const y = ((caja.top + caja.height / 2 - contenedor.top) / contenedor.height) * 100
      setOrigenZoom(`${Math.min(100, Math.max(0, x)).toFixed(1)}% ${Math.min(100, Math.max(0, y)).toFixed(1)}%`)
    } else {
      setOrigenZoom('50% 20%')
    }
  }

  // Pinchar un día en la semana o el mes abre su detalle completo.
  function elegirDia(dia, evento) {
    fijarOrigenDelZoom(evento)
    setFecha(dia)
    cambiarVista('dia')
  }

  function elegirMes(primerDia, evento) {
    fijarOrigenDelZoom(evento)
    setFecha(primerDia)
    cambiarVista('mes')
  }

  // Reagendar: mover una cita vigente a otro día y/u hora, con las mismas reglas
  // que la grilla (horario de atención, corte de mediodía y cupo por bloque).
  // El cambio dispara solo la actualización de la tarjeta en ClickUp.
  async function reagendarCita(cita, nuevaFecha, nuevaHora) {
    try {
      const { data: delDia, error: errorDia } = await supabase
        .from('citas')
        .select('id, tipo_isla_id, hora, duracion_estimada_minutos, estado')
        .eq('fecha', nuevaFecha)
      if (errorDia) throw errorDia

      // Con personal registrado hay que ver quién está ausente ese día, que puede
      // quedar fuera del rango que se está mirando.
      let personalDestino = personal
      if (usaPersonal(personal)) {
        const { data: ausenciasDestino, error: errorAusencias } = await supabase
          .from('personal_ausencias')
          .select('personal_id, desde, hasta, hora_desde, hora_hasta')
          .lte('desde', nuevaFecha)
          .gte('hasta', nuevaFecha)
        if (errorAusencias) throw errorAusencias
        personalDestino = armarPersonal({ ...equipoBase, ausencias: ausenciasDestino || [] })
      }

      const ahora = new Date()
      const validacion = validarReagendamiento({
        cita,
        fecha: nuevaFecha,
        hora: nuevaHora,
        otrasCitasDelDia: delDia || [],
        isla: tiposIsla.find((isla) => isla.id === cita.tipo_isla_id),
        tiposIsla,
        personal: personalDestino,
        horarios: horariosAtencion,
        corte: corteMediodia,
        hoy: hoyLocalISO(),
        ahoraMinutos: ahora.getHours() * 60 + ahora.getMinutes(),
      })
      if (!validacion.ok) return validacion

      const { error: errorActualizar } = await supabase.from('citas').update({ fecha: nuevaFecha, hora: nuevaHora }).eq('id', cita.id)
      if (errorActualizar) throw errorActualizar

      const cliente = nombreVisible(cita.clientes) || 'La cita'
      setAvisoReagendada({ texto: `${cliente} quedó reagendada para el ${etiquetaLarga(nuevaFecha)} a las ${nuevaHora}.`, fecha: nuevaFecha })
      await cargar()
      return { ok: true, motivo: null }
    } catch (excepcion) {
      return { ok: false, motivo: excepcion.message || 'No se pudo reagendar. Revisa la conexión e intenta de nuevo.' }
    }
  }

  function alternarExpandida(id) {
    setExpandidas((previas) => {
      const siguientes = new Set(previas)
      if (siguientes.has(id)) siguientes.delete(id)
      else siguientes.add(id)
      return siguientes
    })
  }

  const nombreIsla = (id) => tiposIsla.find((isla) => isla.id === id)?.nombre
  const tarjeta = (c) => (
    <TarjetaCita
      key={c.id}
      cita={c}
      nombreIsla={nombreIsla(c.tipo_isla_id)}
      expandida={expandidas.has(c.id)}
      onAlternar={alternarExpandida}
      onCambiarEstado={actualizarEstado}
      onReagendar={reagendarCita}
    />
  )
  const citasDia = citas.filter((cita) => cita.fecha === fecha)
  const horarioDelDia = horariosAtencion.find((h) => h.dia_semana === diaSemanaDe(fecha))
  const conPersonal = usaPersonal(personal)
  const bloques = horarioDelDia ? generarBloques(horarioDelDia.hora_apertura, horarioDelDia.hora_cierre) : []

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Agenda</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm" role="group" aria-label="Vista de la agenda">
            {VISTAS.map((opcion) => (
              <button
                key={opcion.clave}
                type="button"
                aria-pressed={vista === opcion.clave}
                onClick={() => cambiarVista(opcion.clave)}
                className={`rounded-md px-3 py-1.5 font-medium ${vista === opcion.clave ? 'bg-deep text-white' : 'text-slate-600 hover:bg-mist'}`}
              >
                {opcion.etiqueta}
              </button>
            ))}
          </div>
          {puedeAdministrarEquipo && (
            <button
              type="button"
              onClick={() => setMostrarEquipo(true)}
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Equipo
            </button>
          )}
          <button
            type="button"
            onClick={() => abrirFormulario(null)}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Nueva cita
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Anterior" onClick={() => setFecha(moverFecha(vista, fecha, -1))} className={BOTON_NAVEGACION}>
          ‹
        </button>
        <button
          type="button"
          onClick={() => setFecha(hoyLocalISO())}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Hoy
        </button>
        <button type="button" aria-label="Siguiente" onClick={() => setFecha(moverFecha(vista, fecha, 1))} className={BOTON_NAVEGACION}>
          ›
        </button>
        <label className="ml-2 text-sm font-medium text-slate-700" htmlFor="agenda-fecha">
          Fecha
        </label>
        <input
          id="agenda-fecha"
          type="date"
          value={fecha}
          onChange={(evento) => evento.target.value && setFecha(evento.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-sm font-medium capitalize text-slate-600">{etiquetaDeRango(vista, fecha)}</span>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {avisoReagendada && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>{avisoReagendada.texto}</span>
          {avisoReagendada.fecha !== fecha && (
            <button type="button" onClick={(evento) => elegirDia(avisoReagendada.fecha, evento)} className="font-medium underline">
              Ver ese día
            </button>
          )}
          <button type="button" onClick={() => setAvisoReagendada(null)} className="ml-auto text-xs text-emerald-700 underline">
            Cerrar
          </button>
        </p>
      )}
      {avisoClickUp && (
        <p role="status" className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {avisoClickUp}
        </p>
      )}

      <div
        ref={contenedorVista}
        key={vista}
        className={`overflow-x-clip ${animacion === 'acercar' ? 'agenda-acercar' : animacion === 'alejar' ? 'agenda-alejar' : ''}`}
        style={{ transformOrigin: origenZoom }}
      >
      {vista === 'anio' && (
        <VistaAnio
          fecha={fecha}
          citas={citas}
          tiposIsla={tiposIsla}
          horarios={horariosAtencion}
          corteMediodia={corteMediodia}
          personal={personal}
          onElegirDia={elegirDia}
          onElegirMes={elegirMes}
        />
      )}

      {vista === 'semana' && (
        <VistaSemana
          fecha={fecha}
          citas={citas}
          tiposIsla={tiposIsla}
          horarios={horariosAtencion}
          corteMediodia={corteMediodia}
          personal={personal}
          expandidas={expandidas}
          onAlternar={alternarExpandida}
          onCambiarEstado={actualizarEstado}
          onReagendar={reagendarCita}
          onElegirDia={elegirDia}
        />
      )}

      {vista === 'mes' && (
        <VistaMes
          fecha={fecha}
          citas={citas}
          tiposIsla={tiposIsla}
          horarios={horariosAtencion}
          corteMediodia={corteMediodia}
          personal={personal}
          onElegirDia={elegirDia}
        />
      )}

      {vista === 'dia' && (
        <>
          {!horarioDelDia ? (
            <p className="mb-6 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              El taller no atiende este día.
            </p>
          ) : (
            <div className="mb-6 overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-50 px-2 py-2 text-left font-medium text-slate-500">Hora</th>
                    {tiposIsla.map((isla) => (
                      <th key={isla.id} className="border-l border-slate-100 bg-slate-50 px-2 py-2 text-left font-medium text-slate-700">
                        {isla.nombre}
                        <span className="block font-normal text-slate-400">
                          {conPersonal ? (
                            <TecnicosDeIsla personal={personal} islaId={isla.id} fecha={fecha} horarios={horariosAtencion} />
                          ) : (
                            `capacidad ${isla.capacidad}`
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bloques.map((bloque) => {
                    const enCorteGeneral = bloqueEnCorte(bloque, corteMediodia)
                    const cupos = cuposEnBloque({ tiposIsla, citasDia, personal, horarios: horariosAtencion, fecha, minuto: horaAMinutos(bloque) })
                    return (
                      <tr key={bloque} className={enCorteGeneral ? 'bg-slate-50/60' : ''}>
                        <td className="sticky left-0 z-10 bg-white px-2 py-1 text-slate-500">{bloque}</td>
                        {tiposIsla.map((isla) => {
                          const cerradoAqui = enCorteGeneral && !isla.opera_en_corte
                          const citasIsla = citasDia.filter((c) => c.tipo_isla_id === isla.id)
                          const cupo = cupos.get(isla.id)
                          const ocupantes = cerradoAqui ? [] : citasEnBloque(citasIsla, bloque)
                          const libres = cerradoAqui ? 0 : cupo.libres
                          const sinPersonal = conPersonal && cupo.capacidad === 0
                          const citasQueEmpiezanAqui = citasIsla.filter((c) => c.hora && c.hora.slice(0, 5) === bloque)
                          return (
                            <td
                              key={isla.id}
                              className={`min-w-[170px] border-l border-slate-100 px-2 py-1 align-top ${
                                cerradoAqui ? 'bg-slate-100' : libres <= 0 ? 'bg-red-50' : ''
                              }`}
                            >
                              {cerradoAqui ? (
                                <span className="text-[10px] text-slate-400">Cerrado (corte)</span>
                              ) : (
                                <>
                                  <span className={`text-[10px] ${libres <= 0 ? 'font-medium text-red-600' : 'text-slate-400'}`}>
                                    {ocupantes.length}/{cupo.capacidad} · {libres > 0 ? `${libres} libre${libres === 1 ? '' : 's'}` : sinPersonal ? 'sin personal' : 'completo'}
                                  </span>
                                  <div className="mt-0.5 space-y-1">
                                    {citasQueEmpiezanAqui.map(tarjeta)}
                                  </div>
                                  {libres > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => abrirFormulario({ tipoIslaId: isla.id, hora: bloque })}
                                      className="mt-0.5 block w-full rounded border border-dashed border-slate-200 py-0.5 text-[10px] text-slate-400 hover:border-slate-400 hover:text-slate-600"
                                    >
                                      + agendar
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Hora</th>
                  <th className="px-3 py-2">Isla</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Vehículo</th>
                  <th className="px-3 py-2">Motivo / observaciones</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {!cargando &&
                  citasDia.map((cita) => (
                    <tr key={cita.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-600">
                        {cita.hora || '—'}
                        {cita.duracion_estimada_minutos && (
                          <span className="text-xs text-slate-400"> ({cita.duracion_estimada_minutos} min)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{nombreIsla(cita.tipo_isla_id) || '—'}</td>
                      <td className="px-3 py-2 text-slate-800">
                        {nombreVisible(cita.clientes)}
                        <p className="text-xs text-slate-400">{cita.clientes?.telefono}</p>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {cita.vehiculos ? `${formatearPatente(cita.vehiculos.patente)} — ${cita.vehiculos.marca} ${cita.vehiculos.modelo}` : 'Sin definir'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {cita.descripcion || '—'}
                        {cita.origen === 'bot_whatsapp' && (
                          <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            agendada por WhatsApp
                          </span>
                        )}
                        {cita.clickup_task_id && (
                          <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">en ClickUp</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={cita.estado}
                          onChange={(evento) => actualizarEstado(cita.id, evento.target.value)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
                            <option key={valor} value={valor}>
                              {etiqueta}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {cita.trabajo_id && (
                          <Link to={`/trabajos/${cita.trabajo_id}`} className="text-xs text-slate-500 underline hover:text-slate-700">
                            OT {cita.trabajos_taller?.numero_ot}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                {!cargando && citasDia.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Sin citas agendadas para este día.
                    </td>
                  </tr>
                )}
                {cargando && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Cargando…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>

      {mostrarEquipo && puedeAdministrarEquipo && (
        <PanelEquipo
          empresaId={usuario.empresa_id}
          usuarioId={usuario.id}
          puedeEditar={puedeAdministrarEquipo}
          tiposIsla={tiposIsla}
          horariosTaller={horariosAtencion}
          onCambio={() => setVersionEquipo((n) => n + 1)}
          onCerrar={() => setMostrarEquipo(false)}
        />
      )}

      {mostrarFormulario && (
        <FormularioNuevaCita
          conPersonal={conPersonal}
          empresaId={usuario.empresa_id}
          usuarioId={usuario.id}
          tiposIsla={tiposIsla}
          fechaInicial={fecha}
          prellenado={prellenado}
          onCancelar={() => setMostrarFormulario(false)}
          onCreada={() => {
            setMostrarFormulario(false)
            cargar()
            sincronizarClickUp()
          }}
        />
      )}
    </div>
  )
}

function FormularioNuevaCita({ conPersonal, empresaId, usuarioId, tiposIsla, fechaInicial, prellenado, onCancelar, onCreada }) {
  const [fecha, setFecha] = useState(fechaInicial)
  const [tipoIslaId, setTipoIslaId] = useState(prellenado?.tipoIslaId || tiposIsla[0]?.id || '')
  const [hora, setHora] = useState(prellenado?.hora || '')
  const [duracionMinutos, setDuracionMinutos] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [cupos, setCupos] = useState(null)

  const [catalogoServicios, setCatalogoServicios] = useState([])
  const [categoriaCatalogo, setCategoriaCatalogo] = useState('')
  const [servicioCatalogoId, setServicioCatalogoId] = useState('')
  const [buscandoHorarios, setBuscandoHorarios] = useState(false)
  const [horariosSugeridos, setHorariosSugeridos] = useState(null)

  const [terminoCliente, setTerminoCliente] = useState('')
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [resultadosCliente, setResultadosCliente] = useState([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [creandoClienteNuevo, setCreandoClienteNuevo] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [apellidoNuevo, setApellidoNuevo] = useState('')
  const [telefonoNuevo, setTelefonoNuevo] = useState('')

  const [vehiculosCliente, setVehiculosCliente] = useState([])
  const [vehiculoId, setVehiculoId] = useState('')

  const [forzarSobrecupo, setForzarSobrecupo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function cargarCatalogo() {
      try {
        const { data } = await supabase
          .from('catalogo_servicios')
          .select('id, segmento, categoria, servicio')
          .eq('activo', true)
          .order('segmento')
          .order('categoria')
          .order('servicio')
        setCatalogoServicios(data || [])
      } catch {
        // El buscador de horario por catálogo es una ayuda opcional: si no
        // carga, el formulario manual sigue funcionando igual.
      }
    }
    cargarCatalogo()
  }, [])

  useEffect(() => {
    async function cargarCupos() {
      if (!tipoIslaId || !fecha) return
      try {
        const { data, error: errorCupos } = await supabase.rpc('citas_cupos_disponibles', {
          p_tipo_isla_id: tipoIslaId,
          p_fecha: fecha,
          p_hora: hora || null,
          p_duracion_minutos: duracionMinutos ? Number(duracionMinutos) : null,
        })
        if (!errorCupos) setCupos(data)
      } catch {
        // El cálculo de cupos es una ayuda visual, no bloquea el guardado.
      }
    }
    cargarCupos()
    setForzarSobrecupo(false)
  }, [tipoIslaId, fecha, hora, duracionMinutos])

  async function buscarHorariosDisponibles() {
    if (!servicioCatalogoId) return
    setBuscandoHorarios(true)
    setHorariosSugeridos(null)
    setError(null)
    try {
      const { data: islaId, error: errorIsla } = await supabase.rpc('catalogo_isla_para_servicio', {
        p_servicio_id: servicioCatalogoId,
      })
      if (errorIsla) throw errorIsla
      if (!islaId) {
        setError('No pudimos ubicar ese servicio en ninguna isla del taller. Agenda a mano.')
        return
      }

      const { data: horasMo, error: errorHoras } = await supabase.rpc('catalogo_horas_servicio', {
        p_servicio_id: servicioCatalogoId,
        p_tipo_vehiculo: vehiculoId ? vehiculosCliente.find((v) => v.id === vehiculoId)?.tipo_carroceria : null,
        p_combustible: null,
      })
      if (errorHoras) throw errorHoras
      const duracion = horasMo ? Math.round(Number(horasMo) * 60) : 60

      const { data: horarios, error: errorHorarios } = await supabase.rpc('citas_buscar_horarios', {
        p_tipo_isla_id: islaId,
        p_duracion_minutos: duracion,
        p_fecha_desde: fecha,
        p_limite: 6,
      })
      if (errorHorarios) throw errorHorarios

      setTipoIslaId(islaId)
      setDuracionMinutos(String(duracion))
      setHorariosSugeridos(horarios || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo buscar horarios disponibles.')
    } finally {
      setBuscandoHorarios(false)
    }
  }

  function elegirHorarioSugerido(sugerido) {
    setFecha(sugerido.fecha)
    setHora(sugerido.hora.slice(0, 5))
    setHorariosSugeridos(null)
  }

  async function buscarCliente(evento) {
    evento.preventDefault()
    setBuscandoCliente(true)
    setError(null)
    try {
      const termino = terminoCliente.trim()
      const soloDigitos = termino.replace(/\D/g, '')
      let consulta = supabase
        .from('clientes')
        .select('id, tipo, nombre, apellido, razon_social, rut, telefono')
        .is('eliminado_en', null)
        .limit(10)

      const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
      if (soloDigitos) {
        condiciones.push(`rut_norm.ilike.%${soloDigitos}%`)
        condiciones.push(`telefono_norm.ilike.%${soloDigitos}%`)
      }
      consulta = consulta.or(condiciones.join(','))

      const { data, error: errorConsulta } = await consulta
      if (errorConsulta) {
        setError(errorConsulta.message)
        return
      }
      setResultadosCliente(data || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setBuscandoCliente(false)
    }
  }

  async function elegirCliente(cliente) {
    setClienteSeleccionado(cliente)
    setResultadosCliente([])
    setCreandoClienteNuevo(false)
    setVehiculoId('')
    try {
      const { data, error: errorVehiculos } = await supabase
        .from('clientes_vehiculos')
        .select('vehiculos(id, patente, marca, modelo, tipo_carroceria)')
        .eq('cliente_id', cliente.id)
      if (!errorVehiculos) {
        setVehiculosCliente((data || []).map((v) => v.vehiculos).filter(Boolean))
      }
    } catch {
      // Sin vehículos vinculados no impide agendar; se completa al ingresar de verdad.
    }
  }

  async function crearClienteNuevo() {
    setError(null)
    setGuardando(true)
    try {
      const { data, error: errorInsercion } = await supabase
        .from('clientes')
        .insert({
          empresa_id: empresaId,
          tipo: 'persona',
          nombre: nombreNuevo,
          apellido: apellidoNuevo || null,
          telefono: telefonoNuevo || null,
        })
        .select()
        .single()

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      await elegirCliente(data)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarEnvio(evento) {
    evento.preventDefault()
    if (!clienteSeleccionado) return

    setGuardando(true)
    setError(null)
    try {
      const { error: errorInsercion } = await supabase.from('citas').insert({
        empresa_id: empresaId,
        tipo_isla_id: tipoIslaId,
        cliente_id: clienteSeleccionado.id,
        vehiculo_id: vehiculoId || null,
        catalogo_servicio_id: servicioCatalogoId || null,
        fecha,
        hora: hora || null,
        duracion_estimada_minutos: duracionMinutos ? Number(duracionMinutos) : null,
        descripcion: descripcion || null,
        creado_por: usuarioId,
      })

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      onCreada()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  const sinCupo = cupos !== null && cupos <= 0

  // Agrupa el catálogo por segmento (isla) -> categoría, mismo criterio que
  // el selector de "Agregar servicio del catálogo" de la ficha de la OT.
  const categoriasPorSegmento = new Map()
  for (const s of catalogoServicios) {
    if (!categoriasPorSegmento.has(s.segmento)) categoriasPorSegmento.set(s.segmento, new Set())
    categoriasPorSegmento.get(s.segmento).add(s.categoria)
  }
  const serviciosDeCategoria = catalogoServicios.filter((s) => s.categoria === categoriaCatalogo)

  return (
    // items-start (no items-center): el formulario creció con el buscador
    // por catálogo y ahora puede ser más alto que la pantalla -con
    // items-center, un contenido más alto que el contenedor queda centrado
    // usando desplazamiento NEGATIVO, y overflow-y-auto no puede hacer
    // scroll hasta ahí (scrollTop no baja de 0): la parte de arriba del
    // formulario quedaba inalcanzable. Encontrado probando el flujo
    // completo en el navegador, no evidente solo mirando el código.
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <form onSubmit={manejarEnvio} className="my-8 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Nueva cita</h2>

        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-sm font-medium text-slate-700">Buscar por servicio (opcional)</p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <select
              value={categoriaCatalogo}
              onChange={(evento) => {
                setCategoriaCatalogo(evento.target.value)
                setServicioCatalogoId('')
              }}
              className="rounded border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">Categoría…</option>
              {[...categoriasPorSegmento.entries()].map(([segmento, categorias]) => (
                <optgroup key={segmento} label={segmento}>
                  {[...categorias].map((categoria) => (
                    <option key={categoria} value={categoria}>
                      {categoria}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              value={servicioCatalogoId}
              onChange={(evento) => setServicioCatalogoId(evento.target.value)}
              disabled={!categoriaCatalogo}
              className="rounded border border-slate-300 px-2 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">Servicio…</option>
              {serviciosDeCategoria.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.servicio}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={buscarHorariosDisponibles}
            disabled={!servicioCatalogoId || buscandoHorarios}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {buscandoHorarios ? 'Buscando…' : 'Buscar próximos horarios disponibles'}
          </button>
          {horariosSugeridos && horariosSugeridos.length === 0 && (
            <p className="mt-2 text-xs text-amber-700">Sin horarios disponibles pronto para ese servicio. Prueba con la isla/hora manual.</p>
          )}
          {horariosSugeridos && horariosSugeridos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {horariosSugeridos.map((h) => (
                <button
                  key={`${h.fecha}-${h.hora}`}
                  type="button"
                  onClick={() => elegirHorarioSugerido(h)}
                  className="rounded border border-deep/30 bg-deep/5 px-2 py-1 text-xs text-deep hover:bg-deep/10"
                >
                  {etiquetaLarga(h.fecha)} {h.hora.slice(0, 5)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Fecha</label>
          <input
            type="date"
            required
            value={fecha}
            onChange={(evento) => setFecha(evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Isla</label>
          <select
            required
            value={tipoIslaId}
            onChange={(evento) => setTipoIslaId(evento.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            {tiposIsla.map((isla) => (
              <option key={isla.id} value={isla.id}>
                {conPersonal ? isla.nombre : `${isla.nombre} (capacidad ${isla.capacidad})`}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Hora (opcional)</label>
            <input
              type="time"
              value={hora}
              onChange={(evento) => setHora(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Duración en minutos (opcional)</label>
            <input
              type="number"
              min="1"
              value={duracionMinutos}
              onChange={(evento) => setDuracionMinutos(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mb-3">
          {cupos !== null && (
            <p className={`text-xs ${sinCupo ? 'text-amber-700' : 'text-slate-500'}`}>
              {sinCupo
                ? `Sin cupos disponibles a esa hora (${cupos < 0 ? `${-cupos} sobre capacidad` : '0 disponibles'}).`
                : `${cupos} cupo(s) disponible(s) a esa hora.`}
            </p>
          )}
        </div>

        {sinCupo && (
          <label className="mb-3 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            <input type="checkbox" checked={forzarSobrecupo} onChange={(e) => setForzarSobrecupo(e.target.checked)} />
            Igual agendar (sobrecupo)
          </label>
        )}

        <div className="mb-3 border-t border-slate-100 pt-3">
          <label className="mb-1 block text-sm font-medium text-slate-700">Cliente</label>
          {clienteSeleccionado ? (
            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span>{nombreVisible(clienteSeleccionado)}</span>
              <button
                type="button"
                onClick={() => {
                  setClienteSeleccionado(null)
                  setVehiculosCliente([])
                  setVehiculoId('')
                }}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <div className="mb-2 flex gap-2">
                <input
                  type="text"
                  value={terminoCliente}
                  onChange={(evento) => setTerminoCliente(evento.target.value)}
                  placeholder="Buscar por nombre, RUT o teléfono"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={buscarCliente}
                  disabled={buscandoCliente}
                  className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Buscar
                </button>
              </div>
              {resultadosCliente.length > 0 && (
                <ul className="mb-2 space-y-1 text-sm">
                  {resultadosCliente.map((cliente) => (
                    <li key={cliente.id}>
                      <button
                        type="button"
                        onClick={() => elegirCliente(cliente)}
                        className="text-slate-700 underline hover:text-slate-900"
                      >
                        {nombreVisible(cliente)} {cliente.telefono ? `· ${cliente.telefono}` : ''}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!creandoClienteNuevo ? (
                <button
                  type="button"
                  onClick={() => setCreandoClienteNuevo(true)}
                  className="text-sm text-slate-500 underline hover:text-slate-700"
                >
                  + Cliente nuevo
                </button>
              ) : (
                <div className="border-t border-slate-100 pt-2">
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <input
                      placeholder="Nombre"
                      value={nombreNuevo}
                      onChange={(evento) => setNombreNuevo(evento.target.value)}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="Apellido"
                      value={apellidoNuevo}
                      onChange={(evento) => setApellidoNuevo(evento.target.value)}
                      className="rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="Teléfono"
                      value={telefonoNuevo}
                      onChange={(evento) => setTelefonoNuevo(evento.target.value)}
                      className="col-span-2 rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={crearClienteNuevo}
                    disabled={!nombreNuevo || guardando}
                    className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Crear y continuar
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {clienteSeleccionado && vehiculosCliente.length > 0 && (
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Vehículo (opcional)</label>
            <select
              value={vehiculoId}
              onChange={(evento) => setVehiculoId(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin definir todavía</option>
              {vehiculosCliente.map((vehiculo) => (
                <option key={vehiculo.id} value={vehiculo.id}>
                  {formatearPatente(vehiculo.patente)} — {vehiculo.marca} {vehiculo.modelo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Detalle (opcional)</label>
          <textarea
            value={descripcion}
            onChange={(evento) => setDescripcion(evento.target.value)}
            rows={2}
            placeholder="Ej: cambio de aceite, ruido en freno delantero"
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
            disabled={guardando || !clienteSeleccionado || (sinCupo && !forzarSobrecupo)}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Agendar'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default Agenda
