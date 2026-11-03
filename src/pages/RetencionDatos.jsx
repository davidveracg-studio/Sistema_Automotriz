import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatoFecha } from '../lib/solicitudesTitulares'
import { CATEGORIAS, DIAS_MAXIMOS, DIAS_MINIMOS, ETIQUETA_CATEGORIA, describirDias, plazoValido } from '../lib/retencion'

function Aviso({ mensaje }) {
  if (!mensaje) return null
  const clase = mensaje.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
  return (
    <div role="status" className={`rounded border px-3 py-2 text-sm ${clase}`}>
      {mensaje.texto}
    </div>
  )
}

function TarjetaCategoria({ clave, etiqueta, queBorra, sugerido, nota, politica, empresaId, onGuardada }) {
  const [dias, setDias] = useState(politica ? String(politica.dias) : sugerido ? String(sugerido) : '')
  const [activa, setActiva] = useState(Boolean(politica?.activa))
  const [conteo, setConteo] = useState(null)
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  const valido = plazoValido(dias)
  const cambios = !politica || String(politica.dias) !== String(dias) || Boolean(politica.activa) !== activa

  async function contar() {
    setMensaje(null)
    setTrabajando(true)
    const { data, error } = await supabase.rpc('retencion_contar', { p_categoria: clave, p_dias: Number(dias) })
    setTrabajando(false)
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
      return
    }
    setConteo(Number(data))
  }

  async function guardar() {
    setMensaje(null)
    if (!valido) {
      setMensaje({ tipo: 'error', texto: `El plazo debe ser un número entero de días entre ${DIAS_MINIMOS} y ${DIAS_MAXIMOS}.` })
      return
    }
    if (activa && !window.confirm(`Con la purga activa, cada domingo se borrarán de forma permanente los datos de «${etiqueta}» con más de ${describirDias(dias)}. Lo borrado no se puede recuperar. ¿Continuar?`)) return
    setTrabajando(true)
    const { error } = await supabase
      .from('politicas_retencion')
      .upsert({ empresa_id: empresaId, categoria: clave, dias: Number(dias), activa }, { onConflict: 'empresa_id,categoria' })
    setTrabajando(false)
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
      return
    }
    setMensaje({ tipo: 'ok', texto: activa ? 'Política guardada y activa.' : 'Política guardada (inactiva: no se borra nada).' })
    await onGuardada()
  }

  return (
    <section className="card space-y-3 p-5" aria-label={etiqueta}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{etiqueta}</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${politica?.activa ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
          {politica?.activa ? `Activa · ${describirDias(politica.dias)}` : 'Inactiva · no se borra nada'}
        </span>
      </div>
      <p className="text-sm text-slate-600">{queBorra}</p>
      {nota && <p className="text-xs text-slate-500">{nota}</p>}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor={`dias-${clave}`}>
            Conservar (días)
          </label>
          <input
            id={`dias-${clave}`}
            type="number"
            min={DIAS_MINIMOS}
            max={DIAS_MAXIMOS}
            className="input w-32"
            value={dias}
            onChange={(evento) => {
              setDias(evento.target.value)
              setConteo(null)
            }}
          />
          {valido && <p className="mt-1 text-xs text-slate-400">≈ {describirDias(dias)}</p>}
          {sugerido && <p className="text-xs text-slate-400">Referencia técnica: {sugerido} días</p>}
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={activa} disabled={!valido} onChange={(evento) => setActiva(evento.target.checked)} />
          Activar purga automática
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={!valido || trabajando} onClick={contar}>
          ¿Cuántos se borrarían?
        </button>
        <button type="button" className="btn-primary" disabled={!cambios || trabajando} onClick={guardar}>
          Guardar
        </button>
        {conteo !== null && (
          <span className="text-sm text-slate-700">
            Con {describirDias(dias)} se borrarían <strong>{conteo}</strong> {conteo === 1 ? 'registro' : 'registros'} hoy.
          </span>
        )}
      </div>
      <Aviso mensaje={mensaje} />
    </section>
  )
}

function RetencionDatos() {
  const { usuario } = useAuth()
  const [politicas, setPoliticas] = useState({})
  const [ejecuciones, setEjecuciones] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    try {
      const [respuestaPoliticas, respuestaEjecuciones] = await Promise.all([
        supabase.from('politicas_retencion').select('*'),
        supabase.from('retencion_ejecuciones').select('*').order('ejecutada_en', { ascending: false }).limit(15),
      ])
      if (respuestaPoliticas.error) {
        setError(respuestaPoliticas.error.message)
      } else {
        setError(null)
        setPoliticas(Object.fromEntries((respuestaPoliticas.data || []).map((politica) => [politica.categoria, politica])))
      }
      setEjecuciones(respuestaEjecuciones.data || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (!usuario) return null

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-mm-link dark:text-white">Retención de datos</h1>
      <p className="mb-6 max-w-3xl text-sm text-slate-500">
        Los datos personales solo se pueden conservar el tiempo necesario para su finalidad. Define aquí cuánto tiempo conserva tu taller
        cada categoría. Todo parte inactivo: no se borra nada hasta que actives una política. El plazo lo decide el taller, como responsable de
        sus datos, con su asesoría legal.
      </p>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        {!cargando &&
          CATEGORIAS.map((categoria) => (
            <TarjetaCategoria
              key={`${categoria.clave}-${politicas[categoria.clave]?.actualizado_en ?? 'nueva'}`}
              clave={categoria.clave}
              etiqueta={categoria.etiqueta}
              queBorra={categoria.queBorra}
              sugerido={categoria.sugerido}
              nota={categoria.nota}
              politica={politicas[categoria.clave]}
              empresaId={usuario.empresa_id}
              onGuardada={cargar}
            />
          ))}
      </div>

      <div className="mt-6 grid max-w-5xl gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">Qué no se borra automáticamente</h2>
          <p className="mt-2 text-sm text-slate-600">
            Clientes, vehículos, trabajos, documentos tributarios, fotos de inspección, encuestas, datos de trabajadores y solicitudes de
            titulares. Qué debe conservarse por ley (tributario, garantías, laboral) lo debe definir un abogado antes de automatizar su
            eliminación. Las solicitudes de titulares se conservan siempre como respaldo.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Plazos fijos de la plataforma (90 días): intentos de ingreso rechazados y errores de correo sin empresa asociada.
          </p>
        </section>

        <section className="card overflow-x-auto p-5">
          <h2 className="text-base font-semibold text-slate-900">Últimas purgas</h2>
          <p className="mb-2 text-xs text-slate-500">La purga corre automáticamente los domingos. Queda constancia de cada una, aunque no borre nada.</p>
          <table className="w-full min-w-[360px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th scope="col" className="py-2 pr-3">Fecha</th>
                <th scope="col" className="py-2 pr-3">Categoría</th>
                <th scope="col" className="py-2 pr-3">Plazo</th>
                <th scope="col" className="py-2 text-right">Borrados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ejecuciones.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
                    Aún no hay purgas registradas.
                  </td>
                </tr>
              )}
              {ejecuciones.map((ejecucion) => (
                <tr key={ejecucion.id}>
                  <td className="py-2 pr-3">{formatoFecha(ejecucion.ejecutada_en)}</td>
                  <td className="py-2 pr-3">{ETIQUETA_CATEGORIA[ejecucion.categoria] ?? ejecucion.categoria}</td>
                  <td className="py-2 pr-3">{describirDias(ejecucion.dias)}</td>
                  <td className="py-2 text-right">{ejecucion.filas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}

export default RetencionDatos
