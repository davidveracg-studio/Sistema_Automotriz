import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

// Versión demo/portafolio: sin contraseña, se elige un rol y se entra con
// una de las 8 cuentas de prueba ya sembradas en el tenant "VPAI Demo"
// (misma base multi-tenant que Didial, aislada por RLS — ver
// 0036_tenant_demo_vpai.sql). Todas comparten una contraseña fija: no hay
// datos reales detrás, así que no hace falta protegerla como un secreto.
const CONTRASENA_DEMO = 'VpaiDemo2026!'

const ROLES_DEMO = [
  { valor: 'admin', etiqueta: 'Administrador', correo: 'demo-admin@vpai.dev' },
  { valor: 'socia', etiqueta: 'Socia', correo: 'demo-socia@vpai.dev' },
  { valor: 'asesor', etiqueta: 'Asesor', correo: 'demo-asesor@vpai.dev' },
  { valor: 'jefe_taller', etiqueta: 'Jefe de taller', correo: 'demo-jefe-taller@vpai.dev' },
  { valor: 'encargado_presupuestos', etiqueta: 'Encargado de presupuestos', correo: 'demo-presupuestos@vpai.dev' },
  { valor: 'tecnico', etiqueta: 'Técnico', correo: 'demo-tecnico@vpai.dev' },
  { valor: 'detailer', etiqueta: 'Detailer', correo: 'demo-detailer@vpai.dev' },
  { valor: 'recepcionista', etiqueta: 'Recepcionista', correo: 'demo-recepcionista@vpai.dev' },
]

function Login() {
  const { sesion, cargando } = useAuth()
  const [rolElegido, setRolElegido] = useState(ROLES_DEMO[0].valor)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  if (!cargando && sesion) {
    return <Navigate to="/" replace />
  }

  async function entrarComoRol(evento) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)

    const rol = ROLES_DEMO.find((r) => r.valor === rolElegido)
    const { error: errorLogin } = await supabase.auth.signInWithPassword({
      email: rol.correo,
      password: CONTRASENA_DEMO,
    })

    if (errorLogin) {
      setError('No se pudo entrar con esta cuenta demo. Intenta de nuevo en unos segundos.')
    }
    setEnviando(false)
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-brand-dark lg:flex-row">
      {/* Panel de marca */}
      <div className="relative flex min-h-[280px] items-center justify-center overflow-hidden px-8 py-14 lg:w-3/5 lg:py-0">
        <div className="carbon absolute inset-0" />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 160px 40px rgba(0,0,0,0.6)' }} />

        <div className="relative z-10 max-w-md text-center lg:text-left">
          <div className="inline-block rounded-2xl bg-white px-8 py-7 shadow-2xl">
            <img src="/logo-vpai.png" alt="VPAI" className="h-24 w-auto lg:h-32" />
          </div>
          <h1 className="mt-8 text-3xl font-bold leading-tight text-white lg:text-4xl">
            Gestión <span className="text-brand-accentSoft">de taller</span>
          </h1>
        </div>
      </div>

      {/* Panel de acceso */}
      <div className="flex items-center justify-center bg-white px-6 py-12 lg:w-2/5">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <img src="/logo-vpai.png" alt="VPAI" className="h-16 w-auto" />
          </div>

          <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-accent">
            Modo demostración
          </span>
          <h2 className="mt-3 text-2xl font-bold text-ink">Explora el CRM</h2>
          <p className="mb-8 mt-1 text-sm text-slate-500">Sin contraseña: elige un rol para entrar con una cuenta de prueba.</p>

          <form onSubmit={entrarComoRol} className="space-y-5">
            <div>
              <label className="label" htmlFor="rol">
                Entrar como
              </label>
              <select id="rol" className="input" value={rolElegido} onChange={(evento) => setRolElegido(evento.target.value)}>
                {ROLES_DEMO.map((rol) => (
                  <option key={rol.valor} value={rol.valor}>
                    {rol.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-lg bg-brand-accent py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <p className="mt-10 text-center text-xs text-slate-400">VPAI · Datos de demostración, sin información real</p>
        </div>
      </div>
    </div>
  )
}

export default Login
