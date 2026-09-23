import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

const ETIQUETA_ESTADO = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
  no_asistio: 'No asistió',
}

const ESTADOS_QUE_OCUPAN_CUPO = ['agendada', 'confirmada']
const PASO_BLOQUE_MINUTOS = 30

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function horaAMinutos(hora) {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

function minutosAHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0')
  const m = String(minutos % 60).padStart(2, '0')
  return `${h}:${m}`
}

// new Date('YYYY-MM-DD') se interpreta como medianoche UTC: en Chile
// (UTC-3/-4) eso puede caer en el día calendario ANTERIOR y dar el
// dia_semana equivocado. Se arma la fecha con componentes locales en vez de
// parsear el string ISO directo -mismo gotcha ya evitado en otras partes de
// la app, documentado acá porque es la primera vez que se necesita el
// día de la semana, no solo mostrar la fecha-.
function diaSemanaDe(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number)
  return new Date(anio, mes - 1, dia).getDay()
}

function generarBloques(apertura, cierre) {
  const bloques = []
  let actual = horaAMinutos(apertura)
  const fin = horaAMinutos(cierre)
  while (actual < fin) {
    bloques.push(minutosAHora(actual))
    actual += PASO_BLOQUE_MINUTOS
  }
  return bloques
}

// Ocupación de una isla en un bloque puntual, por solapamiento de horario
// -mismo criterio que citas_cupos_disponibles (0010_agenda_duracion.sql):
// sin hora/duración = ocupa hasta el cierre del día calendario-.
function citasEnBloque(citasIsla, bloque) {
  const inicioBloque = horaAMinutos(bloque)
  const finBloque = inicioBloque + PASO_BLOQUE_MINUTOS
  return citasIsla.filter((c) => {
    if (!ESTADOS_QUE_OCUPAN_CUPO.includes(c.estado)) return false
    const inicio = c.hora ? horaAMinutos(c.hora) : 0
    const fin = c.duracion_estimada_minutos != null ? inicio + c.duracion_estimada_minutos : 24 * 60
    return inicio < finBloque && inicioBloque < fin
  })
}

function bloqueEnCorte(bloque, corte) {
  if (!corte?.inicio || !corte?.fin) return false
  const minuto = horaAMinutos(bloque)
  return minuto >= horaAMinutos(corte.inicio) && minuto < horaAMinutos(corte.fin)
}

function nombreVisible(cliente) {
  if (!cliente) return ''
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoFechaCorta(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number)
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-CL', { weekday: 'long', day: '2-digit', month: '2-digit' })
}

function Agenda() {
  const { usuario } = useAuth()
  const [fecha, setFecha] = useState(hoyISO())
  const [tiposIsla, setTiposIsla] = useState([])
  const [citas, setCitas] = useState([])
  const [horariosAtencion, setHorariosAtencion] = useState([])
  const [corteMediodia, setCorteMediodia] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [prellenado, setPrellenado] = useState(null)

  useEffect(() => {
    async function cargarBase() {
      try {
        const [{ data: islas, error: errorIslas }, { data: horarios, error: errorHorarios }, { data: empresa, error: errorEmpresa }] =
          await Promise.all([
            supabase.from('tipos_isla').select('id, nombre, capacidad, orden, opera_en_corte').eq('activo', true).order('orden'),
            supabase.from('horario_atencion').select('dia_semana, hora_apertura, hora_cierre').eq('empresa_id', usuario.empresa_id),
            supabase.from('empresas').select('corte_mediodia_inicio, corte_mediodia_fin').eq('id', usuario.empresa_id).maybeSingle(),
          ])
        if (errorIslas) throw errorIslas
        if (errorHorarios) throw errorHorarios
        if (errorEmpresa) throw errorEmpresa
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
  }, [usuario])

  async function cargar() {
    setCargando(true)
    setError(null)
    try {
      const { data: citasDia, error: errorCitas } = await supabase
        .from('citas')
        // trabajos_taller!citas_trabajo_id_fkey: desde el Bloque "ingreso
        // desde cita" (2026-09-15) trabajos_taller.cita_id agregó una
        // SEGUNDA relación entre estas dos tablas (la inversa de
        // citas.trabajo_id). PostgREST ya no puede adivinar sola cuál
        // usar para el embed -hay que nombrar la restricción a mano-.
        .select(
          'id, tipo_isla_id, fecha, hora, duracion_estimada_minutos, descripcion, estado, catalogo_servicio_id, origen, clientes(id, tipo, nombre, apellido, razon_social, telefono), vehiculos(id, patente, marca, modelo), trabajo_id, trabajos_taller!citas_trabajo_id_fkey(numero_ot)'
        )
        .eq('fecha', fecha)
        .order('hora', { nullsFirst: true })

      if (errorCitas) throw errorCitas
      setCitas(citasDia || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha])

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

  const horarioDelDia = horariosAtencion.find((h) => h.dia_semana === diaSemanaDe(fecha))
  const bloques = horarioDelDia ? generarBloques(horarioDelDia.hora_apertura, horarioDelDia.hora_cierre) : []

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Agenda</h1>
        <button
          type="button"
          onClick={() => abrirFormulario(null)}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Nueva cita
        </button>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm font-medium text-slate-700">Fecha</label>
        <input
          type="date"
          value={fecha}
          onChange={(evento) => setFecha(evento.target.value)}
          className="rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-sm capitalize text-slate-500">{formatoFechaCorta(fecha)}</span>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
                    <span className="block font-normal text-slate-400">capacidad {isla.capacidad}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloques.map((bloque) => {
                const enCorteGeneral = bloqueEnCorte(bloque, corteMediodia)
                return (
                  <tr key={bloque} className={enCorteGeneral ? 'bg-slate-50/60' : ''}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-1 text-slate-500">{bloque}</td>
                    {tiposIsla.map((isla) => {
                      const cerradoAqui = enCorteGeneral && !isla.opera_en_corte
                      const citasIsla = citas.filter((c) => c.tipo_isla_id === isla.id)
                      const ocupantes = cerradoAqui ? [] : citasEnBloque(citasIsla, bloque)
                      const libres = isla.capacidad - ocupantes.length
                      const citasQueEmpiezanAqui = citasIsla.filter((c) => c.hora === bloque)
                      return (
                        <td
                          key={isla.id}
                          className={`min-w-[140px] border-l border-slate-100 px-2 py-1 align-top ${
                            cerradoAqui ? 'bg-slate-100' : libres <= 0 ? 'bg-red-50' : ''
                          }`}
                        >
                          {cerradoAqui ? (
                            <span className="text-[10px] text-slate-400">Cerrado (corte)</span>
                          ) : (
                            <>
                              <span className={`text-[10px] ${libres <= 0 ? 'font-medium text-red-600' : 'text-slate-400'}`}>
                                {ocupantes.length}/{isla.capacidad}
                              </span>
                              {citasQueEmpiezanAqui.map((c) => (
                                <p
                                  key={c.id}
                                  title={c.descripcion || ''}
                                  className="mt-0.5 truncate rounded bg-deep/10 px-1 py-0.5 text-[10px] text-deep"
                                >
                                  {nombreVisible(c.clientes) || 'Cita'}
                                  {c.duracion_estimada_minutos ? ` (${c.duracion_estimada_minutos}m)` : ''}
                                </p>
                              ))}
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
              <th className="px-3 py-2">Detalle</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!cargando &&
              citas.map((cita) => (
                <tr key={cita.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-600">
                    {cita.hora || '—'}
                    {cita.duracion_estimada_minutos && (
                      <span className="text-xs text-slate-400"> ({cita.duracion_estimada_minutos} min)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {tiposIsla.find((i) => i.id === cita.tipo_isla_id)?.nombre || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-800">
                    {nombreVisible(cita.clientes)}
                    <p className="text-xs text-slate-400">{cita.clientes?.telefono}</p>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {cita.vehiculos ? `${cita.vehiculos.patente} — ${cita.vehiculos.marca} ${cita.vehiculos.modelo}` : 'Sin definir'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {cita.descripcion || '—'}
                    {cita.origen === 'bot_whatsapp' && (
                      <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        agendada por WhatsApp
                      </span>
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
                      <Link
                        to={`/trabajos/${cita.trabajo_id}`}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        OT {cita.trabajos_taller?.numero_ot}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            {!cargando && citas.length === 0 && (
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

      {mostrarFormulario && (
        <FormularioNuevaCita
          empresaId={usuario.empresa_id}
          usuarioId={usuario.id}
          tiposIsla={tiposIsla}
          fechaInicial={fecha}
          prellenado={prellenado}
          onCancelar={() => setMostrarFormulario(false)}
          onCreada={() => {
            setMostrarFormulario(false)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function FormularioNuevaCita({ empresaId, usuarioId, tiposIsla, fechaInicial, prellenado, onCancelar, onCreada }) {
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
                  {formatoFechaCorta(h.fecha)} {h.hora.slice(0, 5)}
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
                {isla.nombre} (capacidad {isla.capacidad})
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
                  {vehiculo.patente} — {vehiculo.marca} {vehiculo.modelo}
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
