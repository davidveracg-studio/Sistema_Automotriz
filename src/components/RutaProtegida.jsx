import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Guarda de acceso: exige sesión, cuenta activa con rol asignado y,
// opcionalmente, que el rol esté en `rolesPermitidos`.
function RutaProtegida({ children, rolesPermitidos }) {
  const { sesion, usuario, cargando, error } = useAuth()
  const location = useLocation()

  if (cargando) {
    return <div className="p-6 text-slate-500">Cargando…</div>
  }

  if (!sesion) {
    return <Navigate to="/login" replace />
  }

  if (error && !usuario) {
    return (
      <div className="p-6 text-red-600">
        No se pudo cargar tu perfil: {error}. Revisa la conexión y recarga la página.
      </div>
    )
  }

  if (!usuario || !usuario.activo || !usuario.rol) {
    return (
      <div className="p-6 text-slate-600">
        Tu cuenta todavía no tiene un rol asignado. Pide a un administrador que la active.
      </div>
    )
  }

  if (usuario.debe_cambiar_clave && location.pathname !== '/cambiar-clave') {
    return <Navigate to="/cambiar-clave" replace />
  }

  if (rolesPermitidos && !rolesPermitidos.includes(usuario.rol)) {
    return <div className="p-6 text-slate-600">No tienes permiso para ver esta sección.</div>
  }

  return children
}

export default RutaProtegida
