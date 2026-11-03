import { assertEquals } from 'jsr:@std/assert@1'
import { enmascararTelefono, errorSeguro, igualesEnTiempoConstante } from './seguridad.ts'

Deno.test('igualesEnTiempoConstante: iguales, distintos y de largo distinto', () => {
  assertEquals(igualesEnTiempoConstante('sha256=abc123', 'sha256=abc123'), true)
  assertEquals(igualesEnTiempoConstante('sha256=abc123', 'sha256=abc124'), false)
  assertEquals(igualesEnTiempoConstante('abc', 'abcd'), false)
  assertEquals(igualesEnTiempoConstante('', ''), true)
  assertEquals(igualesEnTiempoConstante('', 'x'), false)
})

Deno.test('enmascararTelefono: deja solo los últimos 4 dígitos', () => {
  assertEquals(enmascararTelefono('+56 9 1234 5678'), '****5678')
  assertEquals(enmascararTelefono('56912345678'), '****5678')
  assertEquals(enmascararTelefono(null), 'desconocido')
  assertEquals(enmascararTelefono(undefined), 'desconocido')
  assertEquals(enmascararTelefono(''), 'desconocido')
})

Deno.test('errorSeguro: no deja pasar details ni hint', () => {
  const error = { code: '23505', message: 'duplicate key', details: 'Key (telefono)=(+56912345678) already exists.', hint: 'x' }
  assertEquals(errorSeguro(error), { code: '23505', message: 'duplicate key' })
  assertEquals(errorSeguro('fallo'), 'fallo')
})
