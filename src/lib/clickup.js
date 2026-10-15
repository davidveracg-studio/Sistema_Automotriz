import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

// ¿La empresa tiene una lista de ClickUp activa? Sin ella el taller trabaja en
// "modo local": el Kanban, las tareas y las listas de control se guardan solo
// en la base (las Edge Functions clickup-* lo detectan solas, ver
// supabase/functions/_shared/taller.ts). La pantalla solo lo usa para no
// ofrecer acciones que no aplican (sincronizar, releer estados) ni mencionar
// ClickUp donde no existe.
//
// Devuelve null mientras carga. clickup_config se lee con la RLS de la propia
// empresa (0004).
export function useClickUpConectado() {
  const [conectado, setConectado] = useState(null)

  useEffect(() => {
    let vigente = true
    supabase
      .from('clickup_config')
      .select('activo')
      .maybeSingle()
      .then(({ data }) => {
        if (vigente) setConectado(Boolean(data?.activo))
      })
    return () => {
      vigente = false
    }
  }, [])

  return conectado
}
