// Formato de patente pedido por el cliente: pares separados por espacio,
// "XX XX XX" (por ejemplo PR UE 11). Es solo de presentación: lo guardado en
// la base sigue siendo el texto limpio (mayúsculas, sin espacios) y las
// búsquedas siguen yendo contra patente_norm.

export function normalizarPatente(valor) {
  return (valor || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatearPatente(valor) {
  return normalizarPatente(valor).replace(/(.{2})(?=.)/g, '$1 ')
}

// Para un campo de texto mientras se escribe: limpia, limita el largo y agrupa
// en pares a medida que la persona teclea.
export function formatearPatenteEntrada(valor) {
  return formatearPatente(normalizarPatente(valor).slice(0, 8))
}
