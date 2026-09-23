import { supabase } from '../supabaseClient'

// Cuando una Edge Function responde con error, el cliente de Supabase deja
// los datos vacíos y entrega un mensaje genérico ("non-2xx status code").
// Hay que leer el cuerpo de la respuesta para conocer la causa real: un
// error que no se puede diagnosticar cuesta días.
export async function invocarFuncion(nombre, opciones) {
  const { data, error } = await supabase.functions.invoke(nombre, opciones)

  if (error) {
    let detalle = error.message
    if (error.context && typeof error.context.json === 'function') {
      try {
        const cuerpo = await error.context.json()
        detalle = cuerpo.error?.mensaje || cuerpo.mensaje || cuerpo.error || JSON.stringify(cuerpo)
      } catch {
        // El cuerpo no era JSON; nos quedamos con error.message.
      }
    }
    throw new Error(`${nombre}: ${detalle}`)
  }

  // Toda Edge Function de este proyecto responde { data: {...} } en éxito;
  // se desenvuelve acá para que cada página lea los campos directamente.
  return data?.data ?? data
}
