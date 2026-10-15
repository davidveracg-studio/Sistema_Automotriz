import { assertEquals } from 'jsr:@std/assert@1'
import { rutValido, validarDocumento, type DocumentoParaValidar } from './validar.ts'

Deno.test('rutValido: acepta RUT reales con y sin puntos/guion', () => {
  assertEquals(rutValido('11.111.111-1'), true)
  assertEquals(rutValido('111111111'), true)
  assertEquals(rutValido('12.345.678-5'), true)
  assertEquals(rutValido('76086428-5'), true)
})

Deno.test('rutValido: dígito verificador K y 0', () => {
  assertEquals(rutValido('6-K'), true)
  assertEquals(rutValido('6-k'), true)
  assertEquals(rutValido('13-0'), false)
})

Deno.test('rutValido: rechaza dígito incorrecto y formatos inválidos', () => {
  assertEquals(rutValido('12.345.678-9'), false)
  assertEquals(rutValido('abc'), false)
  assertEquals(rutValido(''), false)
  assertEquals(rutValido('123456789012-3'), false)
})

const receptorCompleto = {
  receptor_rut: '12.345.678-5',
  receptor_razon_social: 'Cliente SpA',
  receptor_giro: 'Transporte',
  receptor_direccion: 'Av. Siempre Viva 123',
  receptor_comuna: 'La Serena',
}

function documento(cambios: Partial<DocumentoParaValidar> = {}): DocumentoParaValidar {
  return { tipo_dte: 33, fecha_emision: '2026-09-25', monto_total: 119000, referencia_razon: null, ...receptorCompleto, ...cambios }
}

const linea = [{ numero_linea: 1, nombre: 'Cambio de aceite', cantidad: 1, monto_linea: 119000 }]
const emisorVacio = { rut: null, giro: null, codigo_actividad: null, direccion: null, comuna: null }
const HOY = '2026-09-25'

Deno.test('factura completa en sandbox: sin problemas', () => {
  assertEquals(validarDocumento(documento(), linea, emisorVacio, 'sandbox', HOY), [])
})

Deno.test('factura sin receptor: exige los 5 datos', () => {
  const problemas = validarDocumento(
    documento({ receptor_rut: null, receptor_razon_social: null, receptor_giro: null, receptor_direccion: null, receptor_comuna: null }),
    linea,
    emisorVacio,
    'sandbox',
    HOY
  )
  assertEquals(problemas.length, 5)
})

Deno.test('boleta sin receptor es válida; con RUT malo no', () => {
  const sinReceptor = documento({ tipo_dte: 39, receptor_rut: null, receptor_razon_social: null, receptor_giro: null, receptor_direccion: null, receptor_comuna: null })
  assertEquals(validarDocumento(sinReceptor, linea, emisorVacio, 'sandbox', HOY), [])
  const rutMalo = documento({ tipo_dte: 39, receptor_rut: '12.345.678-9' })
  assertEquals(validarDocumento(rutMalo, linea, emisorVacio, 'sandbox', HOY).length, 1)
})

Deno.test('total en cero: rechaza, salvo guía de despacho', () => {
  assertEquals(validarDocumento(documento({ monto_total: 0 }), linea, emisorVacio, 'sandbox', HOY).length, 1)
  assertEquals(validarDocumento(documento({ tipo_dte: 52, monto_total: 0 }), linea, emisorVacio, 'sandbox', HOY), [])
})

Deno.test('fecha futura y sin líneas', () => {
  assertEquals(validarDocumento(documento({ fecha_emision: '2026-10-01' }), linea, emisorVacio, 'sandbox', HOY).length, 1)
  assertEquals(validarDocumento(documento(), [], emisorVacio, 'sandbox', HOY).length, 1)
})

Deno.test('nota de crédito sin razón de referencia', () => {
  assertEquals(validarDocumento(documento({ tipo_dte: 61 }), linea, emisorVacio, 'sandbox', HOY).length, 1)
  assertEquals(validarDocumento(documento({ tipo_dte: 61, referencia_razon: 'Anula factura' }), linea, emisorVacio, 'sandbox', HOY), [])
})

Deno.test('proveedor real exige datos del emisor; sandbox no', () => {
  assertEquals(validarDocumento(documento(), linea, emisorVacio, 'sandbox', HOY), [])
  assertEquals(validarDocumento(documento(), linea, emisorVacio, 'proveedor_real', HOY).length, 5)
  const emisorOk = { rut: '76.086.428-5', giro: 'Servicios automotrices', codigo_actividad: '452001', direccion: 'Calle 1', comuna: 'La Serena' }
  assertEquals(validarDocumento(documento(), linea, emisorOk, 'proveedor_real', HOY), [])
})
