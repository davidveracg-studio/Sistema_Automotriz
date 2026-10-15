import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { registrarAccesoFallido, registrarLogin } from '../lib/uso'
import { CURVA_AZUL, CURVA_PLATEADA, fotogramasOnda, trazoOnda } from '../lib/ondas'
import { ETIQUETAS_ROL } from '../lib/navegacion'
import { CONTRASENA_DEMO, CORREO_DEMO_POR_ROL, ETIQUETAS_ROL_DEMO } from '../lib/demo'

// Login de la demo VPAI: sin correo ni contraseña, se elige un rol y se entra
// con la cuenta demo de ese rol (ver src/lib/demo.js). 'socia' no aparece acá
// a propósito: esa cuenta se fusionó con 'admin' (migración 0065).
const ROLES_DEMO = Object.keys(CORREO_DEMO_POR_ROL)
const etiquetaRol = (r) => ETIQUETAS_ROL_DEMO[r] ?? ETIQUETAS_ROL[r]

const REDUCIR_MOVIMIENTO = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const AMPLITUD_PLATEADA = 5
const AMPLITUD_AZUL = 4
const ONDA_PLATEADA = fotogramasOnda(CURVA_PLATEADA, AMPLITUD_PLATEADA, 1.5, 1)
const ONDA_AZUL = fotogramasOnda(CURVA_AZUL, AMPLITUD_AZUL, 1.2, -1)

function LoginDemo() {
  const { sesion, cargando } = useAuth()
  const [rol, setRol] = useState(ROLES_DEMO[0])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  if (!cargando && sesion) {
    return <Navigate to="/" replace />
  }

  async function manejarEnvio(evento) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)

    const { error: errorLogin } = await supabase.auth.signInWithPassword({
      email: CORREO_DEMO_POR_ROL[rol],
      password: CONTRASENA_DEMO,
    })

    if (errorLogin) {
      setError('No se pudo entrar a la demo. Intenta de nuevo en unos segundos.')
      registrarAccesoFallido(CORREO_DEMO_POR_ROL[rol])
    } else {
      registrarLogin()
    }
    setEnviando(false)
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-vpai-black lg:flex-row">
      {/* Panel de marca */}
      <div className="relative flex min-h-[300px] items-center justify-center overflow-hidden px-8 py-14 lg:w-3/5 lg:py-0">
        <div className="carbon-vpai absolute inset-0" />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 160px 40px rgba(0,0,0,0.6)' }} />

        <svg
          className="absolute -right-10 top-1/2 h-auto w-[120%] -translate-y-1/2 opacity-90"
          viewBox="0 0 800 300"
          fill="none"
        >
          <path
            d={trazoOnda(CURVA_PLATEADA, AMPLITUD_PLATEADA, 1.5, 0)}
            stroke="#B4BAC4"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.85"
          >
            {!REDUCIR_MOVIMIENTO && <animate attributeName="d" dur="18s" repeatCount="indefinite" values={ONDA_PLATEADA} />}
          </path>
          <path
            d={trazoOnda(CURVA_AZUL, AMPLITUD_AZUL, 1.2, 0)}
            stroke="#6FA8DC"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.7"
          >
            {!REDUCIR_MOVIMIENTO && <animate attributeName="d" dur="26s" repeatCount="indefinite" values={ONDA_AZUL} />}
          </path>
        </svg>

        <div className="relative z-10 max-w-md text-center lg:text-left">
          <div className="inline-block rounded-2xl bg-white px-7 py-6 shadow-2xl">
            <img src="/logo-vpai-completo.png" alt="VPAI" className="h-24 w-auto lg:h-28" />
          </div>
          <h1 className="mt-8 text-3xl font-bold leading-tight text-white lg:text-4xl">
            Control de gestión <span className="text-vpai-skyblue">con IA</span>
          </h1>
          <p className="mt-3 text-base text-slate-300 lg:text-lg">Demo del sistema de gestión integral</p>
          <div className="mt-6 flex items-center justify-center gap-2 lg:justify-start">
            <span className="h-1 w-10 rounded-full bg-vpai-blue" />
            <span className="h-1 w-6 rounded-full bg-vpai-skyblue" />
            <span className="h-1 w-3 rounded-full bg-white/40" />
          </div>
        </div>
      </div>

      {/* Panel de ingreso */}
      <div className="flex items-center justify-center bg-white px-6 py-12 lg:w-2/5">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-vpai-completo.png" alt="VPAI" className="h-16 w-auto" />
          </div>

          <h2 className="text-2xl font-bold text-ink">Ingresar a la demo</h2>
          <p className="mb-8 mt-1 text-sm text-slate-500">
            Elige un rol para probar el sistema. Los datos son ficticios y los comparte todo quien prueba.
          </p>

          <form onSubmit={manejarEnvio} className="space-y-5">
            <div>
              <label className="label" htmlFor="rol">
                Rol
              </label>
              <select
                id="rol"
                className="input"
                value={rol}
                onChange={(evento) => setRol(evento.target.value)}
                autoFocus
              >
                {ROLES_DEMO.map((r) => (
                  <option key={r} value={r}>
                    {etiquetaRol(r)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">Puedes cambiar de rol más adelante desde &quot;Mi cuenta&quot;.</p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg bg-vpai-blue py-3 font-semibold text-white transition-colors hover:bg-[#1750a8] disabled:opacity-50"
            >
              {enviando ? 'Ingresando…' : `Ingresar como ${etiquetaRol(rol)}`}
            </button>
          </form>

          <p className="mt-10 text-center text-xs text-slate-400">VPAI · Datos de demostración, sin información real</p>
        </div>
      </div>
    </div>
  )
}

export default LoginDemo
