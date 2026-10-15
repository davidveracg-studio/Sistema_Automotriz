import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { invocarFuncion } from '../lib/invocarFuncion'
import { PREGUNTAS, ETIQUETA_COMO_CONOCIO } from '../lib/encuestas'

import { formatearPatente } from '../lib/patente'
const CARAS = ['😞', '🙁', '😐', '🙂', '😄']

const MENSAJE_POR_CLASIFICACION = {
  negativo: {
    titulo: 'Lamentamos lo sucedido',
    texto: 'Gracias por contarnos. Un encargado va a revisar tu caso y se va a poner en contacto contigo a la brevedad.',
    emoji: '🙏',
  },
  positivo: {
    titulo: '¡Gracias por tu preferencia!',
    texto: 'Valoramos mucho tu opinión, nos ayuda a seguir mejorando.',
    emoji: '🙌',
  },
  excelente: {
    titulo: '¡Nos alegra mucho saber eso!',
    texto: 'Gracias por tu preferencia, esperamos verte pronto.',
    emoji: '🎉',
  },
}

function SelectorCalificacion({ etiqueta, pregunta, valor, onCambio }) {
  return (
    <div className="mb-4">
      <p className="mb-1 text-sm font-medium text-slate-700">{pregunta}</p>
      <div className="flex justify-between">
        {CARAS.map((cara, indice) => {
          const opcion = indice + 1
          return (
            <button
              key={opcion}
              type="button"
              aria-label={`${etiqueta}: ${opcion} de 5`}
              onClick={() => onCambio(opcion)}
              className={`rounded-full p-2 text-2xl transition ${
                valor === opcion ? 'bg-slate-900 scale-110' : 'hover:bg-slate-100'
              }`}
            >
              {cara}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EncuestaPublica() {
  const { token } = useParams()
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [calificaciones, setCalificaciones] = useState({})
  const [comoConocio, setComoConocio] = useState('')
  const [sugerencia, setSugerencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    async function cargar() {
      try {
        const { data, error: errorRpc } = await supabase.rpc('encuesta_obtener_por_token', { p_token: token })
        if (errorRpc || !data || data.length === 0) {
          setError('No encontramos esta encuesta. Puede que el enlace esté vencido o incompleto.')
          return
        }
        setDatos(data[0])
      } catch {
        setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [token])

  const faltaCalificar = PREGUNTAS.some((pregunta) => !calificaciones[pregunta.clave])

  async function enviarRespuesta(evento) {
    evento.preventDefault()
    if (faltaCalificar) return
    setEnviando(true)
    setError(null)
    try {
      const { data, error: errorRpc } = await supabase.rpc('encuesta_responder', {
        p_token: token,
        p_entrega_tiempo: calificaciones.entrega_tiempo,
        p_atencion_cliente: calificaciones.atencion_cliente,
        p_servicio_mecanico: calificaciones.servicio_mecanico,
        p_recomendaria: calificaciones.recomendaria,
        p_como_conocio: comoConocio || null,
        p_sugerencia: sugerencia || null,
      })
      if (errorRpc) {
        setError(errorRpc.message)
        return
      }
      const clasificacion = data?.[0]?.clasificacion
      setResultado(clasificacion)

      if (clasificacion === 'negativo') {
        // Best-effort: si el aviso interno falla, el cliente igual ve su
        // agradecimiento -esto no le pertenece a su experiencia-.
        // En la demo, el enlace del correo trae el correo del asesor de prueba
        // (da) y su firma (ds): la función los valida, no confía en ellos.
        const parametros = new URLSearchParams(window.location.search)
        invocarFuncion('notificar-encuesta-negativa', {
          body: {
            token,
            correo_asesor_demo: parametros.get('da') || undefined,
            firma_demo: parametros.get('ds') || undefined,
          },
        }).catch(() => {})
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-slate-500">Cargando…</div>
    )
  }

  if (error && !datos) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <p className="max-w-sm text-center text-slate-600">{error}</p>
      </div>
    )
  }

  const yaRespondida = resultado || datos?.respondido_en

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        {yaRespondida ? (
          <>
            <p className="mb-2 text-3xl">{MENSAJE_POR_CLASIFICACION[resultado]?.emoji || '🙏'}</p>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">
              {MENSAJE_POR_CLASIFICACION[resultado]?.titulo || '¡Gracias por tu respuesta!'}
            </h1>
            <p className="text-sm text-slate-500">
              {MENSAJE_POR_CLASIFICACION[resultado]?.texto || 'Nos ayuda a mejorar el servicio.'}
            </p>
            {resultado === 'excelente' && datos?.empresa_google_review_url && (
              <a
                href={datos.empresa_google_review_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block w-full rounded bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
              >
                Dejar una reseña en Google
              </a>
            )}
          </>
        ) : (
          <form onSubmit={enviarRespuesta}>
            <h1 className="mb-1 text-lg font-semibold text-slate-900">¿Cómo fue tu experiencia?</h1>
            <p className="mb-4 text-sm text-slate-500">
              {datos?.marca} {datos?.modelo} · patente {formatearPatente(datos?.patente)} · OT {datos?.numero_ot}
            </p>

            {PREGUNTAS.map((pregunta) => (
              <SelectorCalificacion
                key={pregunta.clave}
                etiqueta={pregunta.etiqueta}
                pregunta={pregunta.pregunta}
                valor={calificaciones[pregunta.clave]}
                onCambio={(valor) => setCalificaciones((actual) => ({ ...actual, [pregunta.clave]: valor }))}
              />
            ))}

            <label className="mb-1 block text-sm font-medium text-slate-700">
              ¿Cómo conociste {datos?.empresa_nombre || 'nuestro taller'}?
            </label>
            <select
              value={comoConocio}
              onChange={(evento) => setComoConocio(evento.target.value)}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Prefiero no decirlo</option>
              {Object.entries(ETIQUETA_COMO_CONOCIO).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-sm font-medium text-slate-700">
              ¿Alguna sugerencia para que mejoremos?
            </label>
            <textarea
              value={sugerencia}
              onChange={(evento) => setSugerencia(evento.target.value)}
              placeholder="Opcional"
              rows={3}
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={faltaCalificar || enviando}
              className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default EncuestaPublica
