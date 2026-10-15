// Validaciones de un documento tributario ANTES de mandarlo a emitir. Son
// funciones puras (sin acceso a la base) a propósito: contienen reglas
// tributarias y se pueden probar sin levantar nada -ver validar.test.ts-.
// Las validaciones que necesitan consultar la base (por ejemplo, que la
// factura referenciada por una nota de crédito exista y esté aceptada) viven
// en la Edge Function, no acá.

export interface DocumentoParaValidar {
  tipo_dte: number
  fecha_emision: string
  receptor_rut: string | null
  receptor_razon_social: string | null
  receptor_giro: string | null
  receptor_direccion: string | null
  receptor_comuna: string | null
  monto_total: number
  referencia_razon: string | null
}

export interface LineaParaValidar {
  numero_linea: number
  nombre: string
  cantidad: number
  monto_linea: number
}

export interface EmisorParaValidar {
  rut: string | null
  giro: string | null
  codigo_actividad: string | null
  direccion: string | null
  comuna: string | null
}

// Tipos donde el SII exige receptor identificado (RUT, razón social, giro,
// dirección y comuna). La boleta (39/41) puede ir sin receptor.
const TIPOS_CON_RECEPTOR_OBLIGATORIO = [33, 34, 52, 56, 61]

// Dígito verificador chileno, módulo 11.
export function rutValido(rut: string): boolean {
  const limpio = rut.replace(/[.\s]/g, '').toUpperCase()
  const partes = /^(\d{1,8})-?([0-9K])$/.exec(limpio)
  if (!partes) return false

  const cuerpo = partes[1]
  const dv = partes[2]
  let suma = 0
  let multiplicador = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }
  const resto = 11 - (suma % 11)
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
  return dv === esperado
}

function vacio(valor: string | null | undefined): boolean {
  return !valor || valor.trim() === ''
}

export function validarDocumento(
  doc: DocumentoParaValidar,
  lineas: LineaParaValidar[],
  emisor: EmisorParaValidar,
  proveedor: string,
  hoy: string
): string[] {
  const problemas: string[] = []

  if (lineas.length === 0) {
    problemas.push('El documento no tiene líneas.')
  }

  for (const linea of lineas) {
    if (vacio(linea.nombre)) problemas.push(`La línea ${linea.numero_linea} no tiene nombre.`)
    if (!(linea.cantidad > 0)) problemas.push(`La línea ${linea.numero_linea} tiene una cantidad inválida.`)
  }

  // La guía de despacho puede ir en $0 (traslados que no son venta); el
  // resto de los documentos no.
  if (doc.tipo_dte !== 52 && !(doc.monto_total > 0)) {
    problemas.push('El monto total debe ser mayor a 0.')
  }

  if (doc.fecha_emision > hoy) {
    problemas.push('La fecha de emisión no puede ser futura.')
  }

  if (TIPOS_CON_RECEPTOR_OBLIGATORIO.includes(doc.tipo_dte)) {
    if (vacio(doc.receptor_rut)) problemas.push('Falta el RUT del receptor.')
    if (vacio(doc.receptor_razon_social)) problemas.push('Falta la razón social del receptor.')
    if (vacio(doc.receptor_giro)) problemas.push('Falta el giro del receptor.')
    if (vacio(doc.receptor_direccion)) problemas.push('Falta la dirección del receptor.')
    if (vacio(doc.receptor_comuna)) problemas.push('Falta la comuna del receptor.')
  }

  if (!vacio(doc.receptor_rut) && !rutValido(doc.receptor_rut as string)) {
    problemas.push('El RUT del receptor no es válido (dígito verificador).')
  }

  if ((doc.tipo_dte === 56 || doc.tipo_dte === 61) && vacio(doc.referencia_razon)) {
    problemas.push('Las notas de crédito y débito necesitan una razón de referencia.')
  }

  // El sandbox no exige datos del emisor; un proveedor real sí.
  if (proveedor !== 'sandbox') {
    if (vacio(emisor.rut) || !rutValido(emisor.rut as string)) problemas.push('El RUT del emisor falta o no es válido (completar empresas.rut).')
    if (vacio(emisor.giro)) problemas.push('Falta el giro del emisor (empresas.giro).')
    if (vacio(emisor.codigo_actividad)) problemas.push('Falta el código de actividad económica del emisor (empresas.codigo_actividad).')
    if (vacio(emisor.direccion)) problemas.push('Falta la dirección del emisor (empresas.direccion).')
    if (vacio(emisor.comuna)) problemas.push('Falta la comuna del emisor (empresas.comuna).')
  }

  return problemas
}
