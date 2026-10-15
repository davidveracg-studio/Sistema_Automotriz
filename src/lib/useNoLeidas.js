import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

const REFRESCO_MS = 60000

// Cantidad de notificaciones que la persona todavía no marcó como leídas.
// Se refresca cada minuto y al volver a la pestaña. La lista completa (con las
// facturas vencidas calculadas en vivo) vive en Inicio: esto es solo el contador.
export function useNoLeidas() {
  const { usuario } = useAuth()
  const [noLeidas, setNoLeidas] = useState(0)

  useEffect(() => {
    if (!usuario) return undefined
    let activo = true

    async function cargar() {
      try {
        const [{ data: notifs }, { data: lecturas }] = await Promise.all([
          supabase.from('notificaciones').select('id'),
          supabase.from('notificaciones_lecturas').select('notificacion_id').eq('usuario_id', usuario.id),
        ])
        if (!activo) return
        const leidas = new Set((lecturas || []).map((l) => l.notificacion_id))
        setNoLeidas((notifs || []).filter((n) => !leidas.has(n.id)).length)
      } catch {
        // Es una comodidad visual, no algo crítico: si falla se deja el valor anterior.
      }
    }

    cargar()
    const intervalo = setInterval(cargar, REFRESCO_MS)
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      activo = false
      clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [usuario])

  return noLeidas
}
