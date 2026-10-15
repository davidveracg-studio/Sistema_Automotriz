// Descuento comercial sobre la mano de obra de una OT (ver 0051_descuento_mano_obra.sql).
// El porcentaje vive en trabajos_taller.descuento_mano_obra_pct y se aplica SOLO al
// subtotal de mano de obra; los demás rubros (repuestos, lubricantes e insumos,
// servicios externos) no se descuentan. Funciones puras, sin acceso a la base.

export const AREA_MANO_OBRA = 'mano_obra'

// Orden en que se imprimen las áreas en la orden de egreso.
export const AREAS_EN_ORDEN = ['mano_obra', 'repuestos', 'lubricantes_insumos', 'servicios_externos']

// Totales de una lista de ítems ({ area, total_linea }) con el descuento aplicado.
export function calcularDescuentoManoObra(items, porcentaje) {
  const porcentajeNumero = Number(porcentaje) || 0
  const subtotalManoObra = items
    .filter((item) => item.area === AREA_MANO_OBRA)
    .reduce((suma, item) => suma + (item.total_linea || 0), 0)
  const totalBruto = items.reduce((suma, item) => suma + (item.total_linea || 0), 0)
  const descuento = porcentajeNumero > 0 ? Math.round((subtotalManoObra * porcentajeNumero) / 100) : 0
  return { porcentaje: porcentajeNumero, subtotalManoObra, totalBruto, descuento, total: totalBruto - descuento }
}

// 15 -> "15", 12.5 -> "12,5"
export function textoPorcentaje(porcentaje) {
  return String(Number(porcentaje) || 0).replace('.', ',')
}

// Reparte el descuento entre las líneas de mano de obra de un documento tributario
// (que no admite líneas negativas): cada línea baja proporcionalmente y la última
// absorbe el resto, para que el total del documento sea exactamente el de la orden
// de egreso. Recibe [{ area, cantidad, precio_unitario }] y devuelve las mismas
// líneas con el precio ajustado.
export function aplicarDescuentoALineas(lineas, porcentaje) {
  const items = lineas.map((linea) => ({ area: linea.area, total_linea: Math.round(linea.cantidad * linea.precio_unitario) }))
  const { descuento } = calcularDescuentoManoObra(items, porcentaje)
  if (descuento <= 0) return lineas

  const indices = lineas.map((linea, indice) => (linea.area === AREA_MANO_OBRA ? indice : -1)).filter((indice) => indice >= 0)
  const subtotal = indices.reduce((suma, indice) => suma + items[indice].total_linea, 0)
  if (subtotal <= 0) return lineas

  const resultado = lineas.map((linea) => ({ ...linea }))
  let repartido = 0
  indices.forEach((indice, posicion) => {
    const esUltima = posicion === indices.length - 1
    const parte = esUltima ? descuento - repartido : Math.round((descuento * items[indice].total_linea) / subtotal)
    repartido += parte
    const nuevoTotal = Math.max(0, items[indice].total_linea - parte)
    resultado[indice].precio_unitario = Math.round(nuevoTotal / lineas[indice].cantidad)
  })
  return resultado
}
