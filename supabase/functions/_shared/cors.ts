// Cabeceras CORS compartidas. El frontend llama a estas funciones desde un
// origen distinto (la app en Vercel/localhost vs. *.supabase.co).
export const encabezadosCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function respuestaPreflight() {
  return new Response(null, { status: 204, headers: encabezadosCors })
}

export function respuestaJson(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...encabezadosCors, 'Content-Type': 'application/json' },
  })
}
