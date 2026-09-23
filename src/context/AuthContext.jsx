import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let activo = true

    async function cargarUsuario(sesionActual) {
      if (!sesionActual) {
        if (activo) {
          setUsuario(null)
          setCargando(false)
        }
        return
      }

      try {
        const { data, error: errorConsulta } = await supabase
          .from('usuarios')
          .select(
            'id, empresa_id, nombre_completo, correo, rol, activo, debe_cambiar_clave, empresas(nombre, direccion, telefono, correo, logo_url)'
          )
          .eq('id', sesionActual.user.id)
          .maybeSingle()

        if (!activo) return

        if (errorConsulta) {
          setError(errorConsulta.message)
        } else {
          setUsuario(data)
          setError(null)
        }
      } catch (excepcion) {
        if (activo) setError(excepcion.message || 'No se pudo conectar con el servidor.')
      } finally {
        if (activo) setCargando(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      cargarUsuario(data.session)
    })

    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion)
      setCargando(true)
      cargarUsuario(nuevaSesion)
    })

    return () => {
      activo = false
      suscripcion.subscription.unsubscribe()
    }
  }, [])

  async function cerrarSesion() {
    await supabase.auth.signOut()
  }

  const valor = { sesion, usuario, cargando, error, cerrarSesion }

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const contexto = useContext(AuthContext)
  if (!contexto) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }
  return contexto
}
