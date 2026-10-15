import { createContext, useCallback, useContext, useState } from 'react'

// Modo nocturno del panel. El tema vive en un contexto y se aplica como la
// clase "dark" SOLO en la envoltura del panel (Layout de App.jsx): el login y
// la encuesta pública que ve el cliente nunca cambian. La preferencia se
// recuerda en este navegador (localStorage); si nunca se eligió, se sigue la
// del sistema operativo.
const CLAVE = 'tema'

function leerGuardado() {
  try {
    const valor = localStorage.getItem(CLAVE)
    return valor === 'oscuro' || valor === 'claro' ? valor : null
  } catch {
    return null
  }
}

function temaInicial() {
  const guardado = leerGuardado()
  if (guardado) return guardado
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro'
}

const TemaContext = createContext(null)

export function TemaProvider({ children }) {
  const [tema, setTema] = useState(temaInicial)

  const alternar = useCallback(() => {
    setTema((actual) => {
      const siguiente = actual === 'oscuro' ? 'claro' : 'oscuro'
      try {
        localStorage.setItem(CLAVE, siguiente)
      } catch {
        // Sin localStorage la elección dura solo esta visita; no rompe nada.
      }
      return siguiente
    })
  }, [])

  return <TemaContext.Provider value={{ tema, alternar }}>{children}</TemaContext.Provider>
}

export function useTema() {
  const contexto = useContext(TemaContext)
  if (!contexto) throw new Error('useTema debe usarse dentro de <TemaProvider>')
  return contexto
}
