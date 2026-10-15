// Ayudas para las pruebas de correo en el tenant de demostración.
//
// Los correos de prueba (cliente y asesor) NO se guardan en la base: los manda
// el navegador de quien prueba en cada llamada. El correo del asesor tiene que
// viajar además dentro del enlace de la encuesta -la persona responde en otra
// pantalla, incluso en otro dispositivo-, así que va firmado con HMAC: la firma
// ata ese correo a esa encuesta concreta (token) y solo este servidor puede
// producirla. Sin firma válida, el aviso de encuesta negativa no se envía: nadie
// puede fabricar un enlace que haga escribir a una dirección ajena.

const PATRON_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizarCorreo(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toLowerCase() : ''
}

export function correoValido(valor: string): boolean {
  return valor.length > 0 && valor.length <= 254 && PATRON_CORREO.test(valor)
}

async function hmacHex(mensaje: string): Promise<string> {
  const secreto = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secreto) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY para firmar el enlace de la demo.')
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(mensaje))
  return [...new Uint8Array(firma)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function firmarCorreoAsesorDemo(correo: string, token: string): Promise<string> {
  return hmacHex(`demo-asesor|${token}|${correo}`)
}

export async function firmaCorreoAsesorValida(correo: string, token: string, firma: unknown): Promise<boolean> {
  if (typeof firma !== 'string' || !correoValido(correo)) return false
  const esperada = await firmarCorreoAsesorDemo(correo, token)
  if (firma.length !== esperada.length) return false
  let diferencia = 0
  for (let i = 0; i < esperada.length; i++) diferencia |= esperada.charCodeAt(i) ^ firma.charCodeAt(i)
  return diferencia === 0
}
