import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { ETIQUETAS_ROL } from '../lib/navegacion'

// Editar el perfil propio: nombre y contraseña. El correo y el rol no se editan
// acá: el correo es el identificador único que cruza con ClickUp y el rol lo
// define un administrador. En la demo no se permite cambiar la contraseña: las
// cuentas son compartidas y bloquearían a quien pruebe después.
function Perfil() {
  const { usuario, actualizarUsuarioLocal } = useAuth()
  const esDemo = Boolean(usuario?.empresas?.es_demo)

  const [nombre, setNombre] = useState(usuario?.nombre_completo || '')
  const [guardandoNombre, setGuardandoNombre] = useState(false)
  const [mensajeNombre, setMensajeNombre] = useState(null)

  const [clave, setClave] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [guardandoClave, setGuardandoClave] = useState(false)
  const [mensajeClave, setMensajeClave] = useState(null)

  async function guardarNombre(evento) {
    evento.preventDefault()
    setMensajeNombre(null)
    setGuardandoNombre(true)
    try {
      const limpio = nombre.trim().replace(/\s+/g, ' ')
      const { error } = await supabase.rpc('perfil_actualizar_nombre', { p_nombre: limpio })
      if (error) throw error
      actualizarUsuarioLocal({ nombre_completo: limpio })
      setNombre(limpio)
      setMensajeNombre({ tipo: 'ok', texto: 'Nombre actualizado.' })
    } catch (excepcion) {
      setMensajeNombre({ tipo: 'error', texto: excepcion.message || 'No se pudo guardar el nombre.' })
    } finally {
      setGuardandoNombre(false)
    }
  }

  async function guardarClave(evento) {
    evento.preventDefault()
    setMensajeClave(null)
    if (clave.length < 8) {
      setMensajeClave({ tipo: 'error', texto: 'La clave debe tener al menos 8 caracteres.' })
      return
    }
    if (clave !== confirmacion) {
      setMensajeClave({ tipo: 'error', texto: 'Las claves no coinciden.' })
      return
    }
    setGuardandoClave(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: clave })
      if (error) throw error
      setClave('')
      setConfirmacion('')
      setMensajeClave({ tipo: 'ok', texto: 'Clave actualizada.' })
    } catch (excepcion) {
      setMensajeClave({ tipo: 'error', texto: excepcion.message || 'No se pudo cambiar la clave.' })
    } finally {
      setGuardandoClave(false)
    }
  }

  const aviso = (mensaje) =>
    mensaje && (
      <div
        role="status"
        className={`rounded border px-3 py-2 text-sm ${
          mensaje.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        {mensaje.texto}
      </div>
    )

  if (!usuario) return null

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-slate-900">Editar perfil</h1>
      <p className="mb-6 text-sm text-slate-500">Tus datos en el sistema.</p>

      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <form onSubmit={guardarNombre} className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Datos personales</h2>

          <div>
            <label className="label" htmlFor="perfil-nombre">
              Nombre completo
            </label>
            <input
              id="perfil-nombre"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              className="input"
            />
          </div>

          <div>
            <label className="label" htmlFor="perfil-correo">
              Correo
            </label>
            <input id="perfil-correo" type="email" value={usuario.correo || ''} readOnly disabled className="input bg-slate-50 text-slate-500" />
            <p className="mt-1 text-xs text-slate-500">Es tu identificador de acceso; lo cambia un administrador.</p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="label">Rol</span>
              <p className="text-slate-800">{ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}</p>
            </div>
            <div>
              <span className="label">Empresa</span>
              <p className="text-slate-800">{usuario.empresas?.nombre || '—'}</p>
            </div>
          </div>

          {aviso(mensajeNombre)}
          <button type="submit" className="btn-primary" disabled={guardandoNombre || nombre.trim() === (usuario.nombre_completo || '')}>
            {guardandoNombre ? 'Guardando…' : 'Guardar nombre'}
          </button>
        </form>

        <form onSubmit={guardarClave} className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Cambiar contraseña</h2>

          {esDemo ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              En la demo no se puede cambiar la contraseña: las cuentas son compartidas por todas las personas que la prueban.
            </p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="perfil-clave">
                  Clave nueva
                </label>
                <input
                  id="perfil-clave"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={clave}
                  onChange={(evento) => setClave(evento.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="perfil-confirmacion">
                  Repite la clave nueva
                </label>
                <input
                  id="perfil-confirmacion"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmacion}
                  onChange={(evento) => setConfirmacion(evento.target.value)}
                  className="input"
                />
              </div>
              {aviso(mensajeClave)}
              <button type="submit" className="btn-primary" disabled={guardandoClave || !clave}>
                {guardandoClave ? 'Guardando…' : 'Cambiar contraseña'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}

export default Perfil
