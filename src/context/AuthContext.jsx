import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState(null)
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  // Id de la persona cuyo perfil ya está cargado (null = ninguna).
  const idCargado = useRef(null)

  useEffect(() => {
    let activo = true

    async function cargarUsuario(sesionActual) {
      if (!sesionActual) {
        idCargado.current = null
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
            'id, empresa_id, nombre_completo, correo, rol, activo, debe_cambiar_clave, empresas(nombre, direccion, telefono, correo, logo_url, es_demo)'
          )
          .eq('id', sesionActual.user.id)
          .maybeSingle()

        if (!activo) return

        if (errorConsulta) {
          setError(errorConsulta.message)
        } else {
          setUsuario(data)
          setError(null)
          idCargado.current = sesionActual.user.id
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
      // Supabase vuelve a emitir SIGNED_IN (y TOKEN_REFRESHED) cada vez que la
      // pestaña recupera el foco. Si es la MISMA persona con el perfil ya
      // cargado, no hay nada que recargar: marcar "cargando" desmontaría la
      // pantalla y borraría lo que estaba escribiendo (un formulario a medias,
      // la fecha elegida en la Agenda...). Solo cambia el flujo con un usuario
      // distinto o al cerrar sesión.
      if (nuevaSesion && idCargado.current === nuevaSesion.user.id) return
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

  // Refleja en pantalla un cambio ya guardado en la base (ej. el nombre editado
  // en "Editar perfil") sin volver a pedir toda la fila.
  function actualizarUsuarioLocal(cambios) {
    setUsuario((previo) => (previo ? { ...previo, ...cambios } : previo))
  }

  const valor = { sesion, usuario, cargando, error, cerrarSesion, actualizarUsuarioLocal }

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const contexto = useContext(AuthContext)
  if (!contexto) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  }
  return contexto
}
