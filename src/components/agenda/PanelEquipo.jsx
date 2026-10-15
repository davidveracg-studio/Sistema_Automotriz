import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { hoyLocalISO } from '../../lib/agenda'
import { MOTIVOS_AUSENCIA, NOMBRES_DIA, ORDEN_DIAS, horaCorta, resumenAusencia, resumenHorario } from '../../lib/personal'

const CAMPO = 'rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800'
const BOTON = 'rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'
const BOTON_PRIMARIO = 'rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50'

function formularioAusenciaVacio(personalId) {
  const hoy = hoyLocalISO()
  return { personalId, desde: hoy, hasta: hoy, soloHoras: false, horaDesde: '09:00', horaHasta: '13:00', motivo: MOTIVOS_AUSENCIA[0] }
}

// Horario semanal de trabajo de una persona, partiendo del horario del taller.
function diasIniciales(horariosPersona, horariosTaller) {
  const dias = {}
  for (let dia = 0; dia <= 6; dia++) {
    const propio = horariosPersona.find((h) => h.dia_semana === dia)
    const taller = horariosTaller.find((h) => h.dia_semana === dia)
    const base = horariosPersona.length > 0 ? propio : taller
    dias[dia] = {
      trabaja: Boolean(base),
      inicio: horaCorta(propio?.hora_inicio || taller?.hora_apertura || '08:30'),
      fin: horaCorta(propio?.hora_fin || taller?.hora_cierre || '18:00'),
    }
  }
  return dias
}

// Equipo que atiende vehículos: la capacidad de la Agenda sale de quién está
// disponible en cada bloque (0048_agenda_por_personal.sql). Cualquiera del taller
// lo ve; administrar (habilidades, horarios, ausencias) es de admin, socia y jefe.
function PanelEquipo({ empresaId, usuarioId, puedeEditar, tiposIsla, horariosTaller, onCambio, onCerrar }) {
  const [personas, setPersonas] = useState([])
  const [habilidades, setHabilidades] = useState([])
  const [horarios, setHorarios] = useState([])
  const [ausencias, setAusencias] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [nuevaPersona, setNuevaPersona] = useState({ nombre: '', cargo: '' })
  const [formAusencia, setFormAusencia] = useState(null)
  const [edicionHorario, setEdicionHorario] = useState(null)
  const [confirmarBaja, setConfirmarBaja] = useState(null)

  const cargar = useCallback(async () => {
    try {
      const [respPersonas, respHabilidades, respHorarios, respAusencias] = await Promise.all([
        supabase.from('personal_taller').select('id, nombre, cargo, orden').eq('activo', true).order('orden').order('nombre'),
        supabase.from('personal_habilidades').select('personal_id, tipo_isla_id'),
        supabase.from('personal_horarios').select('id, personal_id, dia_semana, hora_inicio, hora_fin'),
        supabase
          .from('personal_ausencias')
          .select('id, personal_id, desde, hasta, hora_desde, hora_hasta, motivo')
          .gte('hasta', hoyLocalISO())
          .order('desde'),
      ])
      const primerError = respPersonas.error || respHabilidades.error || respHorarios.error || respAusencias.error
      if (primerError) throw primerError
      setPersonas(respPersonas.data || [])
      setHabilidades(respHabilidades.data || [])
      setHorarios(respHorarios.data || [])
      setAusencias(respAusencias.data || [])
      setError(null)
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cargar el equipo. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Ejecuta un cambio en la base y refresca este panel y la Agenda.
  async function aplicar(accion) {
    setOcupado(true)
    setError(null)
    try {
      await accion()
      await cargar()
      onCambio()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo guardar. Revisa la conexión e intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  function cambiarHabilidad(personalId, tipoIslaId, activa) {
    aplicar(async () => {
      if (activa) {
        const { error: errorInsert } = await supabase
          .from('personal_habilidades')
          .insert({ personal_id: personalId, tipo_isla_id: tipoIslaId, empresa_id: empresaId })
        if (errorInsert) throw errorInsert
      } else {
        const { error: errorDelete } = await supabase
          .from('personal_habilidades')
          .delete()
          .eq('personal_id', personalId)
          .eq('tipo_isla_id', tipoIslaId)
        if (errorDelete) throw errorDelete
      }
    })
  }

  function agregarPersona(evento) {
    evento.preventDefault()
    const nombre = nuevaPersona.nombre.trim()
    if (!nombre) return
    aplicar(async () => {
      const orden = personas.reduce((mayor, persona) => Math.max(mayor, persona.orden || 0), 0) + 1
      const { error: errorInsert } = await supabase
        .from('personal_taller')
        .insert({ empresa_id: empresaId, nombre, cargo: nuevaPersona.cargo.trim() || null, orden })
      if (errorInsert) throw errorInsert
      setNuevaPersona({ nombre: '', cargo: '' })
    })
  }

  function darDeBaja(personalId) {
    aplicar(async () => {
      const { error: errorUpdate } = await supabase.from('personal_taller').update({ activo: false }).eq('id', personalId)
      if (errorUpdate) throw errorUpdate
      setConfirmarBaja(null)
    })
  }

  function agregarAusencia(evento) {
    evento.preventDefault()
    const f = formAusencia
    if (f.hasta < f.desde) {
      setError('La fecha de término no puede ser anterior a la de inicio.')
      return
    }
    if (f.soloHoras && f.horaHasta <= f.horaDesde) {
      setError('La hora de término debe ser posterior a la de inicio.')
      return
    }
    aplicar(async () => {
      const { error: errorInsert } = await supabase.from('personal_ausencias').insert({
        empresa_id: empresaId,
        personal_id: f.personalId,
        desde: f.desde,
        hasta: f.hasta,
        hora_desde: f.soloHoras ? f.horaDesde : null,
        hora_hasta: f.soloHoras ? f.horaHasta : null,
        motivo: f.motivo,
        creado_por: usuarioId,
      })
      if (errorInsert) throw errorInsert
      setFormAusencia(null)
    })
  }

  function eliminarAusencia(id) {
    aplicar(async () => {
      const { error: errorDelete } = await supabase.from('personal_ausencias').delete().eq('id', id)
      if (errorDelete) throw errorDelete
    })
  }

  function guardarHorario(evento) {
    evento.preventDefault()
    const { personalId, dias } = edicionHorario
    const filas = ORDEN_DIAS.filter((dia) => dias[dia].trabaja).map((dia) => ({
      empresa_id: empresaId,
      personal_id: personalId,
      dia_semana: dia,
      hora_inicio: dias[dia].inicio,
      hora_fin: dias[dia].fin,
    }))
    if (filas.length === 0) {
      setError('Marca al menos un día de trabajo, o usa el horario de atención del taller.')
      return
    }
    if (filas.some((fila) => fila.hora_fin <= fila.hora_inicio)) {
      setError('En cada día, la hora de término debe ser posterior a la de inicio.')
      return
    }
    aplicar(async () => {
      const { error: errorDelete } = await supabase.from('personal_horarios').delete().eq('personal_id', personalId)
      if (errorDelete) throw errorDelete
      const { error: errorInsert } = await supabase.from('personal_horarios').insert(filas)
      if (errorInsert) throw errorInsert
      setEdicionHorario(null)
    })
  }

  function usarHorarioDelTaller(personalId) {
    aplicar(async () => {
      const { error: errorDelete } = await supabase.from('personal_horarios').delete().eq('personal_id', personalId)
      if (errorDelete) throw errorDelete
      setEdicionHorario(null)
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Equipo y disponibilidad">
      <div className="my-4 w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Equipo y disponibilidad</h2>
            <p className="text-sm text-slate-500">
              La Agenda ofrece cupos según quién está disponible en cada bloque. Una persona atiende una cosa a la vez.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className={BOTON}>
            Cerrar
          </button>
        </div>

        {error && <p className="my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!puedeEditar && <p className="my-2 text-xs text-slate-500">Solo administración y jefatura de taller pueden modificar el equipo.</p>}

        {cargando ? (
          <p className="py-6 text-center text-sm text-slate-500">Cargando el equipo…</p>
        ) : (
          <div className="mt-3 space-y-3">
            {personas.length === 0 && (
              <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Todavía no hay personas registradas: la Agenda usa la capacidad fija de cada isla.
              </p>
            )}

            {personas.map((persona) => {
              const suyas = habilidades.filter((h) => h.personal_id === persona.id).map((h) => h.tipo_isla_id)
              const horariosPersona = horarios.filter((h) => h.personal_id === persona.id)
              const ausenciasPersona = ausencias.filter((a) => a.personal_id === persona.id)
              const editandoHorario = edicionHorario?.personalId === persona.id
              const registrandoAusencia = formAusencia?.personalId === persona.id
              return (
                <section key={persona.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{persona.nombre}</h3>
                      {persona.cargo && <p className="text-xs text-slate-500">{persona.cargo}</p>}
                    </div>
                    {puedeEditar &&
                      (confirmarBaja === persona.id ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button type="button" disabled={ocupado} onClick={() => darDeBaja(persona.id)} className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50">
                            Confirmar baja
                          </button>
                          <button type="button" onClick={() => setConfirmarBaja(null)} className={BOTON}>
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmarBaja(persona.id)} className="text-xs text-slate-500 hover:text-red-600">
                          Dar de baja
                        </button>
                      ))}
                  </div>

                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Atiende</p>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {tiposIsla.map((isla) => (
                        <label key={isla.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={suyas.includes(isla.id)}
                            disabled={!puedeEditar || ocupado}
                            onChange={(evento) => cambiarHabilidad(persona.id, isla.id, evento.target.checked)}
                          />
                          {isla.nombre}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Horario</p>
                    <p className="text-sm text-slate-700">{resumenHorario(horariosPersona)}</p>
                    {puedeEditar && !editandoHorario && (
                      <div className="mt-1 flex gap-2">
                        <button type="button" onClick={() => setEdicionHorario({ personalId: persona.id, dias: diasIniciales(horariosPersona, horariosTaller) })} className={BOTON}>
                          Editar horario
                        </button>
                        {horariosPersona.length > 0 && (
                          <button type="button" disabled={ocupado} onClick={() => usarHorarioDelTaller(persona.id)} className={BOTON}>
                            Usar el del taller
                          </button>
                        )}
                      </div>
                    )}
                    {editandoHorario && (
                      <form onSubmit={guardarHorario} className="mt-2 space-y-1 rounded bg-slate-50 p-2">
                        {ORDEN_DIAS.map((dia) => {
                          const d = edicionHorario.dias[dia]
                          const cambiar = (campo, valor) =>
                            setEdicionHorario((previo) => ({ ...previo, dias: { ...previo.dias, [dia]: { ...previo.dias[dia], [campo]: valor } } }))
                          return (
                            <div key={dia} className="flex flex-wrap items-center gap-2 text-sm">
                              <label className="flex w-32 items-center gap-1.5 text-slate-700">
                                <input type="checkbox" checked={d.trabaja} onChange={(evento) => cambiar('trabaja', evento.target.checked)} />
                                {NOMBRES_DIA[dia]}
                              </label>
                              {d.trabaja ? (
                                <>
                                  <input type="time" step="1800" value={d.inicio} onChange={(evento) => cambiar('inicio', evento.target.value)} aria-label={`Inicio ${NOMBRES_DIA[dia]}`} className={CAMPO} />
                                  <span className="text-slate-400">a</span>
                                  <input type="time" step="1800" value={d.fin} onChange={(evento) => cambiar('fin', evento.target.value)} aria-label={`Término ${NOMBRES_DIA[dia]}`} className={CAMPO} />
                                </>
                              ) : (
                                <span className="text-xs text-slate-400">No trabaja</span>
                              )}
                            </div>
                          )
                        })}
                        <div className="flex gap-2 pt-1">
                          <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>
                            Guardar horario
                          </button>
                          <button type="button" onClick={() => setEdicionHorario(null)} className={BOTON}>
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ausencias (vacaciones, licencias, permisos)</p>
                    {ausenciasPersona.length === 0 ? (
                      <p className="text-sm text-slate-400">Sin ausencias registradas.</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {ausenciasPersona.map((ausencia) => (
                          <li key={ausencia.id} className="flex items-center justify-between gap-2 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                            <span>
                              {resumenAusencia(ausencia)}
                              {ausencia.motivo ? ` · ${ausencia.motivo}` : ''}
                            </span>
                            {puedeEditar && (
                              <button type="button" disabled={ocupado} onClick={() => eliminarAusencia(ausencia.id)} className="text-xs text-amber-800 underline">
                                Quitar
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {puedeEditar && !registrandoAusencia && (
                      <button type="button" onClick={() => setFormAusencia(formularioAusenciaVacio(persona.id))} className={`${BOTON} mt-1`}>
                        Registrar ausencia
                      </button>
                    )}
                    {registrandoAusencia && (
                      <form onSubmit={agregarAusencia} className="mt-2 space-y-2 rounded bg-slate-50 p-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1 text-slate-700">
                            Desde
                            <input type="date" required value={formAusencia.desde} min={hoyLocalISO()} onChange={(evento) => setFormAusencia({ ...formAusencia, desde: evento.target.value, hasta: formAusencia.hasta < evento.target.value ? evento.target.value : formAusencia.hasta })} className={CAMPO} />
                          </label>
                          <label className="flex items-center gap-1 text-slate-700">
                            Hasta
                            <input type="date" required value={formAusencia.hasta} min={formAusencia.desde} onChange={(evento) => setFormAusencia({ ...formAusencia, hasta: evento.target.value })} className={CAMPO} />
                          </label>
                          <select value={formAusencia.motivo} onChange={(evento) => setFormAusencia({ ...formAusencia, motivo: evento.target.value })} aria-label="Motivo" className={CAMPO}>
                            {MOTIVOS_AUSENCIA.map((motivo) => (
                              <option key={motivo} value={motivo}>
                                {motivo}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 text-slate-700">
                          <input type="checkbox" checked={formAusencia.soloHoras} onChange={(evento) => setFormAusencia({ ...formAusencia, soloHoras: evento.target.checked })} />
                          Solo unas horas de cada día
                        </label>
                        {formAusencia.soloHoras && (
                          <div className="flex items-center gap-2">
                            <input type="time" step="1800" value={formAusencia.horaDesde} onChange={(evento) => setFormAusencia({ ...formAusencia, horaDesde: evento.target.value })} aria-label="Hora de inicio" className={CAMPO} />
                            <span className="text-slate-400">a</span>
                            <input type="time" step="1800" value={formAusencia.horaHasta} onChange={(evento) => setFormAusencia({ ...formAusencia, horaHasta: evento.target.value })} aria-label="Hora de término" className={CAMPO} />
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>
                            Guardar ausencia
                          </button>
                          <button type="button" onClick={() => setFormAusencia(null)} className={BOTON}>
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </section>
              )
            })}

            {puedeEditar && (
              <form onSubmit={agregarPersona} className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-3">
                <label className="text-xs font-medium text-slate-600">
                  Nueva persona
                  <input type="text" required maxLength={80} value={nuevaPersona.nombre} onChange={(evento) => setNuevaPersona({ ...nuevaPersona, nombre: evento.target.value })} placeholder="Nombre y apellido" className={`${CAMPO} mt-0.5 block`} />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Cargo
                  <input type="text" maxLength={80} value={nuevaPersona.cargo} onChange={(evento) => setNuevaPersona({ ...nuevaPersona, cargo: evento.target.value })} placeholder="Ej. Mecánico master" className={`${CAMPO} mt-0.5 block`} />
                </label>
                <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>
                  Agregar
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PanelEquipo
