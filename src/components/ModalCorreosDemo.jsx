import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  EVENTO_ABRIR_CORREOS_DEMO,
  estadoCorreosDemo,
  guardarCorreosDemo,
  omitirCorreosDemo,
} from '../lib/correosDemo'

// Solo en el tenant de demostración (empresas.es_demo): en CADA inicio de
// sesión se piden el correo del cliente y el del asesor -pueden ser el mismo-
// para que quien prueba reciba de verdad los correos del sistema (encuesta de
// postventa al cliente, aviso de encuesta negativa al asesor). Los correos se
// quedan en la pestaña (sessionStorage) y no se guardan en la base: ver
// src/lib/correosDemo.js.
function ModalCorreosDemo() {
  const { sesion, usuario } = useAuth()
  const esDemo = Boolean(usuario?.empresas?.es_demo)

  const [abierto, setAbierto] = useState(false)
  const [correoCliente, setCorreoCliente] = useState('')
  const [correoAsesor, setCorreoAsesor] = useState('')
  const [mismoCorreo, setMismoCorreo] = useState(true)
  const [guardado, setGuardado] = useState(false)

  useEffect(() => {
    if (esDemo && estadoCorreosDemo(sesion) === 'pendiente') setAbierto(true)
  }, [esDemo, sesion])

  useEffect(() => {
    if (!esDemo) return undefined
    const abrir = () => {
      setGuardado(false)
      setAbierto(true)
    }
    window.addEventListener(EVENTO_ABRIR_CORREOS_DEMO, abrir)
    return () => window.removeEventListener(EVENTO_ABRIR_CORREOS_DEMO, abrir)
  }, [esDemo])

  if (!esDemo || !abierto) return null

  function guardar(evento) {
    evento.preventDefault()
    const cliente = correoCliente.trim().toLowerCase()
    const asesor = (mismoCorreo ? correoCliente : correoAsesor).trim().toLowerCase()
    guardarCorreosDemo(sesion, cliente, asesor)
    setGuardado(true)
  }

  function omitir() {
    if (estadoCorreosDemo(sesion) === 'pendiente') omitirCorreosDemo(sesion)
    setAbierto(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-correos-demo"
    >
      <div className="my-8 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {guardado ? (
          <>
            <h2 id="titulo-correos-demo" className="text-lg font-semibold text-slate-900">
              Listo, correos de esta sesión
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Para probarlos: en <strong>Oportunidades</strong> pulsa &quot;Enviar encuestas de postventa pendientes&quot;
              (llegará al correo del cliente). Abre el enlace del correo y responde la encuesta con 1 o 2 estrellas
              en alguna pregunta: el aviso de encuesta negativa llegará al correo del asesor.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Puedes cambiarlos cuando quieras desde &quot;Correos de prueba&quot; en el menú lateral.
            </p>
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setAbierto(false)}>
                Entendido
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={guardar}>
            <h2 id="titulo-correos-demo" className="text-lg font-semibold text-slate-900">
              Correos para probar la demo
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Ingresa tu correo para recibir de verdad los correos del sistema. Los datos de ejemplo tienen
              direcciones ficticias: aquí se usan las tuyas, y nunca se le escribe a un cliente real.
            </p>

            <div className="mt-4">
              <label className="label" htmlFor="correo-demo-cliente">
                Correo del cliente
              </label>
              <input
                id="correo-demo-cliente"
                type="email"
                required
                autoFocus
                value={correoCliente}
                onChange={(evento) => setCorreoCliente(evento.target.value)}
                placeholder="cliente@ejemplo.com"
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">Recibe la encuesta de postventa.</p>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={mismoCorreo}
                onChange={(evento) => setMismoCorreo(evento.target.checked)}
              />
              Usar el mismo correo para el asesor
            </label>

            {!mismoCorreo && (
              <div className="mt-3">
                <label className="label" htmlFor="correo-demo-asesor">
                  Correo del asesor
                </label>
                <input
                  id="correo-demo-asesor"
                  type="email"
                  required
                  value={correoAsesor}
                  onChange={(evento) => setCorreoAsesor(evento.target.value)}
                  placeholder="asesor@ejemplo.com"
                  className="input"
                />
                <p className="mt-1 text-xs text-slate-500">Recibe el aviso cuando una encuesta llega negativa.</p>
              </div>
            )}

            <p className="mt-4 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Los correos se usan solo durante esta sesión: no se guardan en la base de datos y se vuelven a
              pedir en el próximo inicio de sesión.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={omitir}>
                Ahora no
              </button>
              <button type="submit" className="btn-primary">
                Continuar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default ModalCorreosDemo
