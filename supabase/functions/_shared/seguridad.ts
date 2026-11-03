// Utilidades de seguridad compartidas por las Edge Functions.

// Compara dos textos sin cortar en la primera diferencia, para que el tiempo
// de respuesta no revele cuántos caracteres coinciden (firmas HMAC, tokens y
// claves). El largo distinto también cuenta como diferencia.
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  let diferencia = bytesA.length ^ bytesB.length
  const largo = Math.max(bytesA.length, bytesB.length)
  for (let i = 0; i < largo; i++) {
    diferencia |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0)
  }
  return diferencia === 0
}

// Deja visibles solo los últimos 4 dígitos de un teléfono para poder
// diagnosticar sin guardar el número completo en los logs.
export function enmascararTelefono(telefono: string | null | undefined): string {
  const digitos = (telefono ?? '').replace(/\D/g, '')
  if (digitos.length === 0) return 'desconocido'
  return `****${digitos.slice(-4)}`
}

// Un error de Supabase/PostgREST trae `details` y `hint`, que pueden incluir
// los valores de la fila (p. ej. «Key (telefono)=(...) already exists»). Para
// los logs basta con el código y el mensaje.
export function errorSeguro(error: unknown): { code?: unknown; message?: unknown } | string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown }
    return { code, message }
  }
  return String(error)
}
