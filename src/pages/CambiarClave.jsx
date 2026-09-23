import { useState } from 'react'
import { supabase } from '../supabaseClient'

function CambiarClave() {
  const [clave, setClave] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  async function manejarEnvio(evento) {
    evento.preventDefault()
    setError(null)

    if (clave.length < 8) {
      setError('La clave debe tener al menos 8 caracteres.')
      return
    }
    if (clave !== confirmacion) {
      setError('Las claves no coinciden.')
      return
    }

    setEnviando(true)

    const { error: errorClave } = await supabase.auth.updateUser({ password: clave })
    if (errorClave) {
      setError(errorClave.message)
      setEnviando(false)
      return
    }

    const { error: errorFlag } = await supabase.rpc('marcar_clave_cambiada')
    if (errorFlag) {
      setError(errorFlag.message)
      setEnviando(false)
      return
    }

    window.location.assign('/')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={manejarEnvio} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Define tu clave</h1>
        <p className="mb-6 text-sm text-slate-500">
          Estás usando una clave provisoria. Antes de continuar, crea tu propia clave.
        </p>

        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="clave">
          Clave nueva
        </label>
        <input
          id="clave"
          type="password"
          required
          minLength={8}
          value={clave}
          onChange={(evento) => setClave(evento.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="confirmacion">
          Repite la clave nueva
        </label>
        <input
          id="confirmacion"
          type="password"
          required
          minLength={8}
          value={confirmacion}
          onChange={(evento) => setConfirmacion(evento.target.value)}
          className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {enviando ? 'Guardando…' : 'Guardar clave'}
        </button>
      </form>
    </div>
  )
}

export default CambiarClave
