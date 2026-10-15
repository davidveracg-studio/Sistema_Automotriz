export const TIPOS_DTE = {
  33: 'Factura electrónica',
  34: 'Factura exenta electrónica',
  39: 'Boleta electrónica',
  41: 'Boleta exenta electrónica',
  52: 'Guía de despacho electrónica',
  56: 'Nota de débito electrónica',
  61: 'Nota de crédito electrónica',
}

export const ETIQUETA_ESTADO_DTE = {
  borrador: 'Borrador',
  emitiendo: 'Emitiendo',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
  error: 'Error al emitir',
  anulado: 'Anulado',
}

export const COLOR_ESTADO_DTE = {
  borrador: 'bg-slate-100 text-slate-600',
  emitiendo: 'bg-blue-100 text-blue-800',
  aceptado: 'bg-green-100 text-green-800',
  rechazado: 'bg-red-100 text-red-800',
  error: 'bg-amber-100 text-amber-800',
  anulado: 'bg-slate-200 text-slate-500',
}

// Códigos de traslado de la guía de despacho (IndTraslado del SII).
export const INDICADORES_TRASLADO = {
  1: 'Operación constituye venta',
  2: 'Ventas por efectuar',
  3: 'Consignaciones',
  4: 'Entrega gratuita',
  5: 'Traslados internos',
  6: 'Otros traslados no venta',
  7: 'Guía de devolución',
  8: 'Traslado para exportación (no venta)',
}

export const CODIGOS_REFERENCIA = {
  1: 'Anula el documento referenciado',
  2: 'Corrige el texto del documento referenciado',
  3: 'Corrige los montos del documento referenciado',
}

// Mismo grupo que la policy de escritura de documentos_tributarios (0037):
// jefe_taller puede ver, no emitir.
export const ROLES_PUEDEN_EMITIR = ['admin', 'socia', 'encargado_presupuestos', 'asesor']

export const TIPOS_REFERENCIABLES = [33, 34, 39, 41, 56]

export function formatoNumero(numero) {
  if (numero === null || numero === undefined) return ''
  return Math.round(numero).toLocaleString('es-CL')
}

export function esTipoExento(tipo) {
  return tipo === 34 || tipo === 41
}

// Vista previa de los montos MIENTRAS se edita el borrador. La fuente de
// verdad es documento_tributario_recalcular() en la base (0037): al guardar,
// la pantalla vuelve a leer los montos que calculó ella. Mismo criterio que
// Presupuesto -los precios incluyen IVA: neto = round(afecto / 1.19)-. Puede
// diferir en $1 de la base solo en casos límite de redondeo de cantidades
// decimales; por eso lo que se emite es siempre lo que devuelve la base.
export function calcularMontos(tipo, lineas) {
  let afecto = 0
  let exento = 0
  for (const linea of lineas) {
    const monto = Math.round((Number(linea.cantidad) || 0) * (Number(linea.precio_unitario) || 0))
    if (linea.exento) exento += monto
    else afecto += monto
  }
  if (esTipoExento(tipo)) {
    exento += afecto
    afecto = 0
  }
  const neto = Math.round(afecto / 1.19)
  return { neto, iva: afecto - neto, exento, total: afecto + exento }
}

export function nombreReceptorDeCliente(cliente) {
  if (!cliente) return ''
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

export function formatoFechaIso(fechaIso) {
  if (!fechaIso) return '—'
  const [anio, mes, dia] = String(fechaIso).slice(0, 10).split('-')
  return `${dia}-${mes}-${anio}`
}
