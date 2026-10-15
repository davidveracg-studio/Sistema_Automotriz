// Formato de patente pedido por el cliente: pares separados por espacio,
// "XX XX XX". Misma regla que src/lib/patente.js, para los correos.
export function formatearPatente(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(.{2})(?=.)/g, '$1 ')
}
