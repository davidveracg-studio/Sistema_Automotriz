import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { hoyLocalISO, primerDiaDelMes, ultimoDiaDelMes } from '../lib/agenda'
import { GRUPOS_TURNO, leerInformeEventos, normalizarRut } from '../lib/turnos'

const PESTANAS = [
  { clave: 'resumen', etiqueta: 'Resumen' },
  { clave: 'importar', etiqueta: 'Importar asistencia' },
  { clave: 'nomina', etiqueta: 'Nómina' },
]

const ETIQUETA_CLASIFICACION = {
  normal: 'Normal',
  incompleta: 'Marca incompleta',
  falta: 'Falta',
  jornada_extraordinaria: 'Jornada extraordinaria',
}

const COLOR_CLASIFICACION = {
  normal: 'bg-emerald-50 text-emerald-800',
  incompleta: 'bg-sky-50 text-sky-800',
  falta: 'bg-red-50 text-red-700',
  jornada_extraordinaria: 'bg-amber-50 text-amber-800',
}

const ETIQUETA_JUSTIFICATIVO = {
  licencia: 'Licencia médica',
  permiso_sin_goce: 'Permiso sin goce',
  dia_recuperado: 'Día recuperado',
  otro: 'Otro',
}

function formatoFecha(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-')
  return `${dia}-${mes}-${anio}`
}

function formatoHora(hora) {
  return hora ? hora.slice(0, 5) : '—'
}

// Turnos y asistencia (RRHH): rotación de grupos (Azul/Verde rotativos, Fijo
// L-V, Fijo M-S), importación del informe de eventos del reloj control y
// clasificación día a día (normal/falta/jornada extraordinaria). Solo admin,
// socia y jefe de taller -información cercana a remuneraciones.
function Turnos() {
  const { usuario } = useAuth()
  const [pestana, setPestana] = useState('resumen')
  const [personal, setPersonal] = useState([])
  const [cargandoPersonal, setCargandoPersonal] = useState(true)
  const [error, setError] = useState(null)

  const cargarPersonal = useCallback(async () => {
    setCargandoPersonal(true)
    try {
      const { data, error: errorPersonal } = await supabase
        .from('personal_turnos')
        .select('id, nombre_completo, rut, ficha_reloj, grupo, fecha_salida, activo, usuario_id')
        .order('nombre_completo')
      if (errorPersonal) throw errorPersonal
      setPersonal(data || [])
      setError(null)
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cargar la nómina. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargandoPersonal(false)
    }
  }, [])

  useEffect(() => {
    cargarPersonal()
  }, [cargarPersonal])

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Turnos y asistencia</h1>
      <p className="mb-4 text-sm text-slate-500">Rotación de grupos, importación del reloj control y jornadas fuera de turno.</p>

      <div role="tablist" aria-label="Secciones de turnos" className="flex flex-wrap gap-1 border-b border-slate-200">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={pestana === p.clave}
            onClick={() => setPestana(p.clave)}
            className={`-mb-px rounded-t border px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-deep ${
              pestana === p.clave ? 'border-slate-200 border-b-white bg-white text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="my-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div role="tabpanel" className="rounded-b border border-t-0 border-slate-200 bg-white p-4">
        {cargandoPersonal ? (
          <p className="text-slate-500">Cargando…</p>
        ) : pestana === 'resumen' ? (
          <PanelResumen empresaId={usuario.empresa_id} usuarioId={usuario.id} personal={personal} />
        ) : pestana === 'importar' ? (
          <PanelImportar empresaId={usuario.empresa_id} usuarioId={usuario.id} personal={personal} />
        ) : (
          <PanelNomina empresaId={usuario.empresa_id} personal={personal} onCambio={cargarPersonal} />
        )}
      </div>
    </div>
  )
}

// ---- Resumen: mensual por persona + detalle diario ------------------------
// El resumen mensual replica el informe que ya usaba el cliente
// (Resumen_Asistencia_Mensual): "Días con registro" cuenta todo lo que pasó
// el filtro de turnos_resumen_diario (esperado y/o con marca, incluidas las
// jornadas extraordinarias); "Trabajados" es todo menos falta; las faltas se
// desglosan por su justificativo (o "sin justificar").
function PanelResumen({ empresaId, usuarioId, personal }) {
  const [desde, setDesde] = useState(primerDiaDelMes(hoyLocalISO()))
  const [hasta, setHasta] = useState(ultimoDiaDelMes(hoyLocalISO()))
  const [filaPersonal, setFilaPersonal] = useState('')
  const [filas, setFilas] = useState([])
  const [justificativos, setJustificativos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [respRpc, respJustificativos] = await Promise.all([
        supabase.rpc('turnos_resumen_diario', { p_empresa_id: empresaId, p_desde: desde, p_hasta: hasta }),
        supabase.from('turnos_justificativos').select('id, personal_id, fecha, tipo, fecha_recuperacion, nota').gte('fecha', desde).lte('fecha', hasta),
      ])
      if (respRpc.error) throw respRpc.error
      if (respJustificativos.error) throw respJustificativos.error
      setFilas(respRpc.data || [])
      setJustificativos(respJustificativos.data || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cargar el resumen. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [empresaId, desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  const justificativoPorClave = useMemo(() => {
    const mapa = new Map()
    for (const j of justificativos) mapa.set(`${j.personal_id}-${j.fecha}`, j)
    return mapa
  }, [justificativos])

  const resumenPorPersona = useMemo(() => {
    const mapa = new Map()
    for (const fila of filas) {
      if (!mapa.has(fila.personal_id)) {
        mapa.set(fila.personal_id, {
          personal_id: fila.personal_id,
          nombre_completo: fila.nombre_completo,
          grupo: fila.grupo,
          dias_registro: 0,
          dias_trabajados: 0,
          dias_falta: 0,
          dias_licencia: 0,
          dias_permiso: 0,
          dias_recuperado: 0,
          dias_otro: 0,
          dias_sin_justificar: 0,
          dias_extraordinaria: 0,
          horas_extraordinaria: 0,
          horas: 0,
        })
      }
      const r = mapa.get(fila.personal_id)
      r.dias_registro++
      r.horas += Number(fila.horas_trabajadas) || 0
      if (fila.clasificacion !== 'falta') r.dias_trabajados++
      if (fila.clasificacion === 'jornada_extraordinaria') {
        r.dias_extraordinaria++
        r.horas_extraordinaria += Number(fila.horas_trabajadas) || 0
      }
      if (fila.clasificacion === 'falta') {
        r.dias_falta++
        const justificativo = justificativoPorClave.get(`${fila.personal_id}-${fila.fecha}`)
        if (!justificativo) r.dias_sin_justificar++
        else if (justificativo.tipo === 'licencia') r.dias_licencia++
        else if (justificativo.tipo === 'permiso_sin_goce') r.dias_permiso++
        else if (justificativo.tipo === 'dia_recuperado') r.dias_recuperado++
        else r.dias_otro++
      }
    }
    for (const r of mapa.values()) {
      r.porcentaje_asistencia = r.dias_registro > 0 ? Math.round((r.dias_trabajados / r.dias_registro) * 1000) / 10 : null
    }
    return [...mapa.values()].sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo))
  }, [filas, justificativoPorClave])

  const filasVisibles = filaPersonal ? filas.filter((f) => f.personal_id === filaPersonal) : filas

  async function guardarJustificativo(fila, tipo, fechaRecuperacion) {
    setError(null)
    try {
      if (!tipo) {
        const existente = justificativoPorClave.get(`${fila.personal_id}-${fila.fecha}`)
        if (existente) {
          const { error: errorDelete } = await supabase.from('turnos_justificativos').delete().eq('id', existente.id)
          if (errorDelete) throw errorDelete
        }
      } else {
        const { error: errorUpsert } = await supabase.from('turnos_justificativos').upsert(
          {
            empresa_id: empresaId,
            personal_id: fila.personal_id,
            fecha: fila.fecha,
            tipo,
            fecha_recuperacion: tipo === 'dia_recuperado' ? fechaRecuperacion || null : null,
            creado_por: usuarioId,
          },
          { onConflict: 'personal_id,fecha' }
        )
        if (errorUpsert) throw errorUpsert
      }
      await cargar()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo guardar el justificativo. Revisa la conexión e intenta de nuevo.')
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="block text-sm">
          <span className="label">Desde</span>
          <input type="date" value={desde} onChange={(evento) => setDesde(evento.target.value)} className="input" />
        </label>
        <label className="block text-sm">
          <span className="label">Hasta</span>
          <input type="date" value={hasta} onChange={(evento) => setHasta(evento.target.value)} className="input" />
        </label>
        <label className="block text-sm">
          <span className="label">Persona</span>
          <select value={filaPersonal} onChange={(evento) => setFilaPersonal(evento.target.value)} className="input">
            <option value="">Todas</option>
            {personal.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre_completo}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {cargando ? (
        <p className="text-slate-500">Cargando…</p>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Resumen del período</h2>
          <div className="mb-6 overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Persona</th>
                  <th className="px-3 py-2">Grupo</th>
                  <th className="px-3 py-2">Trabajados</th>
                  <th className="px-3 py-2">Faltas</th>
                  <th className="px-3 py-2">Licencia</th>
                  <th className="px-3 py-2">Permiso s/g</th>
                  <th className="px-3 py-2">Recuperado</th>
                  <th className="px-3 py-2">Sin justificar</th>
                  <th className="px-3 py-2">Jorn. extraord.</th>
                  <th className="px-3 py-2">Horas totales</th>
                  <th className="px-3 py-2">% Asistencia</th>
                </tr>
              </thead>
              <tbody>
                {resumenPorPersona.map((r) => (
                  <tr key={r.personal_id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{r.nombre_completo}</td>
                    <td className="px-3 py-2 text-slate-600">{GRUPOS_TURNO[r.grupo]}</td>
                    <td className="px-3 py-2 text-slate-600">{r.dias_trabajados}</td>
                    <td className="px-3 py-2 text-red-700">{r.dias_falta || ''}</td>
                    <td className="px-3 py-2 text-slate-500">{r.dias_licencia || ''}</td>
                    <td className="px-3 py-2 text-slate-500">{r.dias_permiso || ''}</td>
                    <td className="px-3 py-2 text-slate-500">{r.dias_recuperado || ''}</td>
                    <td className="px-3 py-2 font-medium text-red-700">{r.dias_sin_justificar || ''}</td>
                    <td className="px-3 py-2 font-medium text-amber-800">
                      {r.dias_extraordinaria > 0 ? `${r.dias_extraordinaria} (${r.horas_extraordinaria.toFixed(1)} h)` : ''}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.horas.toFixed(1)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.porcentaje_asistencia != null ? `${r.porcentaje_asistencia}%` : '—'}</td>
                  </tr>
                ))}
                {resumenPorPersona.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-slate-400">
                      Sin datos para este período. Importa la asistencia en la pestaña &quot;Importar asistencia&quot;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Detalle diario</h2>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Persona</th>
                  <th className="px-3 py-2">Turno esperado</th>
                  <th className="px-3 py-2">Marcas</th>
                  <th className="px-3 py-2">Horas</th>
                  <th className="px-3 py-2">Clasificación</th>
                  <th className="px-3 py-2">Justificativo</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.map((filaVisible) => {
                  const propsFila = {
                    fila: filaVisible,
                    justificativo: justificativoPorClave.get(`${filaVisible.personal_id}-${filaVisible.fecha}`) || null,
                    onGuardarJustificativo: guardarJustificativo,
                  }
                  return <FilaDetalle key={`${filaVisible.personal_id}-${filaVisible.fecha}`} {...propsFila} />
                })}
                {filasVisibles.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Sin filas para este filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// Una fila del detalle diario; si es "falta" permite asignarle un justificativo.
function FilaDetalle({ fila, justificativo, onGuardarJustificativo }) {
  const [editando, setEditando] = useState(false)
  const [tipo, setTipo] = useState(justificativo?.tipo || '')
  const [fechaRecuperacion, setFechaRecuperacion] = useState(justificativo?.fecha_recuperacion || '')

  async function guardar(evento) {
    evento.preventDefault()
    await onGuardarJustificativo(fila, tipo || null, fechaRecuperacion)
    setEditando(false)
  }

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2 text-slate-600">{formatoFecha(fila.fecha)}</td>
      <td className="px-3 py-2 text-slate-800">{fila.nombre_completo}</td>
      <td className="px-3 py-2 text-slate-500">{fila.es_feriado ? 'Feriado' : fila.turno_esperado ? 'Sí' : 'No'}</td>
      <td className="px-3 py-2 text-slate-500">
        {fila.cantidad_marcas > 0 ? (
          <>
            {formatoHora(fila.primera_marca)} – {formatoHora(fila.ultima_marca)} ({fila.cantidad_marcas})
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2 text-slate-600">{Number(fila.horas_trabajadas) > 0 ? fila.horas_trabajadas.toFixed(2) : '—'}</td>
      <td className="px-3 py-2">
        {fila.clasificacion && (
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR_CLASIFICACION[fila.clasificacion]}`}>
            {ETIQUETA_CLASIFICACION[fila.clasificacion]}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        {fila.clasificacion !== 'falta' ? (
          '—'
        ) : editando ? (
          <form onSubmit={guardar} className="flex flex-wrap items-center gap-1">
            <select value={tipo} onChange={(evento) => setTipo(evento.target.value)} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
              <option value="">Sin justificar</option>
              {Object.entries(ETIQUETA_JUSTIFICATIVO).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
            {tipo === 'dia_recuperado' && (
              <input
                type="date"
                value={fechaRecuperacion}
                onChange={(evento) => setFechaRecuperacion(evento.target.value)}
                aria-label="Fecha de recuperación"
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              />
            )}
            <button type="submit" className="rounded bg-slate-900 px-1.5 py-0.5 text-white">
              Guardar
            </button>
            <button type="button" onClick={() => setEditando(false)} className="text-slate-500 underline">
              Cancelar
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditando(true)} className="underline hover:text-slate-800">
            {justificativo
              ? `${ETIQUETA_JUSTIFICATIVO[justificativo.tipo]}${justificativo.fecha_recuperacion ? ` (${formatoFecha(justificativo.fecha_recuperacion)})` : ''}`
              : 'Sin justificar'}
          </button>
        )}
      </td>
    </tr>
  )
}

// ---- Importar asistencia ---------------------------------------------------
function PanelImportar({ empresaId, usuarioId, personal }) {
  const [analizando, setAnalizando] = useState(false)
  const [vista, setVista] = useState(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  async function elegirArchivo(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return
    setAnalizando(true)
    setError(null)
    setResultado(null)
    setVista(null)
    try {
      const XLSX = await import('xlsx')
      const buffer = await archivo.arrayBuffer()
      const libro = XLSX.read(buffer, { type: 'array' })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
      const { periodo, marcas, personas } = leerInformeEventos(filas)

      const porFicha = new Map(personal.map((p) => [p.ficha_reloj, p]))
      const porRut = new Map(personal.filter((p) => p.rut).map((p) => [normalizarRut(p.rut), p]))

      const marcasListas = []
      const fichasNoEncontradas = new Map()
      for (const marca of marcas) {
        const persona = porFicha.get(marca.ficha) || porRut.get(marca.rut)
        if (!persona) {
          fichasNoEncontradas.set(marca.ficha, { ficha: marca.ficha, rut: marca.rut, nombre: marca.nombre })
          continue
        }
        marcasListas.push({
          empresa_id: empresaId,
          personal_id: persona.id,
          fecha_real: marca.fecha_real,
          dia_trabajo: marca.dia_trabajo,
          hora: marca.hora,
          tipo: marca.tipo,
          estado_reloj: marca.estado_reloj,
          importado_por: usuarioId,
        })
      }

      setVista({
        periodo,
        totalMarcas: marcas.length,
        marcasListas,
        fichasNoEncontradas: [...fichasNoEncontradas.values()],
        personasEnArchivo: personas.length,
      })
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo leer el archivo. ¿Es el informe de eventos del reloj control (.xls)?')
    } finally {
      setAnalizando(false)
    }
  }

  async function confirmarImportacion() {
    if (!vista?.marcasListas?.length) return
    setImportando(true)
    setError(null)
    try {
      const LOTE = 500
      let agregadas = 0
      for (let inicio = 0; inicio < vista.marcasListas.length; inicio += LOTE) {
        const lote = vista.marcasListas.slice(inicio, inicio + LOTE)
        const { data, error: errorInsert } = await supabase
          .from('turnos_marcas')
          .upsert(lote, { onConflict: 'personal_id,fecha_real,hora,tipo', ignoreDuplicates: true })
          .select('id')
        if (errorInsert) throw errorInsert
        agregadas += data?.length || 0
      }
      setResultado({ agregadas, yaExistian: vista.marcasListas.length - agregadas })
      setVista(null)
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo importar. Revisa la conexión e intenta de nuevo.')
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-slate-600">
        Sube el &quot;Informe de eventos&quot; que exporta el reloj control (.xls). Se leen las marcas de entrada y salida (las anuladas por el
        reloj no se importan) y se cruzan con la nómina por ficha o RUT. Se puede volver a subir el mismo período sin duplicar.
      </p>

      <label className="mb-4 block rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500 hover:border-slate-400">
        <input type="file" accept=".xls,.xlsx" onChange={elegirArchivo} disabled={analizando} className="hidden" />
        {analizando ? 'Leyendo el archivo…' : 'Haz clic para elegir el archivo del reloj control (.xls)'}
      </label>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {resultado && (
        <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Listo: {resultado.agregadas} marca(s) nueva(s) importada(s)
          {resultado.yaExistian > 0 ? `, ${resultado.yaExistian} ya estaban importadas.` : '.'}
        </p>
      )}

      {vista && (
        <div className="rounded border border-slate-200 p-3 text-sm">
          {vista.periodo && <p className="mb-1 text-slate-600">Período del archivo: {vista.periodo}</p>}
          <p className="mb-1 text-slate-700">
            {vista.personasEnArchivo} persona(s) en el archivo · {vista.totalMarcas} marca(s) reales (sin anuladas) ·{' '}
            <span className="font-medium">{vista.marcasListas.length} se pueden importar</span>
          </p>
          {vista.fichasNoEncontradas.length > 0 && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
              <p className="font-medium">{vista.fichasNoEncontradas.length} persona(s) del archivo no están en la nómina:</p>
              <ul className="mt-1 list-disc pl-5">
                {vista.fichasNoEncontradas.map((f) => (
                  <li key={f.ficha}>
                    {f.nombre} (ficha {f.ficha}, RUT {f.rut})
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">Agrégalas en la pestaña &quot;Nómina&quot; con la misma ficha para que se importen sus marcas.</p>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={importando || vista.marcasListas.length === 0}
              onClick={confirmarImportacion}
              className="btn-primary"
            >
              {importando ? 'Importando…' : `Importar ${vista.marcasListas.length} marca(s)`}
            </button>
            <button type="button" onClick={() => setVista(null)} className="btn-ghost">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Nómina -----------------------------------------------------------------
function PanelNomina({ empresaId, personal, onCambio }) {
  const [nuevo, setNuevo] = useState({ nombre_completo: '', rut: '', ficha_reloj: '', grupo: 'azul' })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  async function guardarCampo(id, campo, valor) {
    setOcupado(true)
    setError(null)
    try {
      const { error: errorUpdate } = await supabase.from('personal_turnos').update({ [campo]: valor }).eq('id', id)
      if (errorUpdate) throw errorUpdate
      await onCambio()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo guardar. Revisa la conexión e intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  async function agregar(evento) {
    evento.preventDefault()
    if (!nuevo.nombre_completo.trim() || !nuevo.ficha_reloj.trim()) return
    setOcupado(true)
    setError(null)
    try {
      const { error: errorInsert } = await supabase.from('personal_turnos').insert({
        empresa_id: empresaId,
        nombre_completo: nuevo.nombre_completo.trim(),
        rut: nuevo.rut.trim() || null,
        ficha_reloj: nuevo.ficha_reloj.trim(),
        grupo: nuevo.grupo,
      })
      if (errorInsert) throw errorInsert
      setNuevo({ nombre_completo: '', rut: '', ficha_reloj: '', grupo: 'azul' })
      await onCambio()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo agregar. Revisa la conexión e intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mb-4 overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">RUT</th>
              <th className="px-3 py-2">Ficha reloj</th>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2">Fecha de salida</th>
              <th className="px-3 py-2">Activo</th>
            </tr>
          </thead>
          <tbody>
            {personal.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{p.nombre_completo}</td>
                <td className="px-3 py-2 text-slate-500">{p.rut || '—'}</td>
                <td className="px-3 py-2 text-slate-500">{p.ficha_reloj || '—'}</td>
                <td className="px-3 py-2">
                  <select
                    value={p.grupo}
                    disabled={ocupado}
                    onChange={(evento) => guardarCampo(p.id, 'grupo', evento.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {Object.entries(GRUPOS_TURNO).map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>
                        {etiqueta}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="date"
                    defaultValue={p.fecha_salida || ''}
                    disabled={ocupado}
                    onBlur={(evento) => {
                      const valor = evento.target.value || null
                      if (valor !== p.fecha_salida) guardarCampo(p.id, 'fecha_salida', valor)
                    }}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={p.activo}
                    disabled={ocupado}
                    onChange={(evento) => guardarCampo(p.id, 'activo', evento.target.checked)}
                  />
                </td>
              </tr>
            ))}
            {personal.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay personal cargado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={agregar} className="grid grid-cols-1 gap-2 rounded border border-dashed border-slate-300 p-3 sm:grid-cols-5">
        <input
          required
          placeholder="Nombre completo"
          value={nuevo.nombre_completo}
          onChange={(evento) => setNuevo({ ...nuevo, nombre_completo: evento.target.value })}
          className="input sm:col-span-2"
        />
        <input
          placeholder="RUT (opcional)"
          value={nuevo.rut}
          onChange={(evento) => setNuevo({ ...nuevo, rut: evento.target.value })}
          className="input"
        />
        <input
          required
          placeholder="Ficha del reloj"
          value={nuevo.ficha_reloj}
          onChange={(evento) => setNuevo({ ...nuevo, ficha_reloj: evento.target.value })}
          className="input"
        />
        <select value={nuevo.grupo} onChange={(evento) => setNuevo({ ...nuevo, grupo: evento.target.value })} className="input">
          {Object.entries(GRUPOS_TURNO).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
        <button type="submit" disabled={ocupado} className="btn-primary sm:col-span-5">
          Agregar a la nómina
        </button>
      </form>
    </div>
  )
}

export default Turnos
