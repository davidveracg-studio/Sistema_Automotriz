import { assertEquals } from 'jsr:@std/assert@1'
import { normalizarAnalisis } from './inspeccion.ts'

Deno.test('normalizarAnalisis: acepta una respuesta válida de interior', () => {
  const r = normalizarAnalisis(
    {
      objetos: [{ nombre: ' Gata   hidráulica ', categoria: 'herramientas', cantidad: 1, confianza: 0.9 }],
      danos: [
        {
          descripcion: 'Raya en puerta',
          tipo: 'raya',
          severidad: 'leve',
          confianza: 0.8,
          caja: { x: 0.1, y: 0.2, ancho: 0.3, alto: 0.1 },
        },
      ],
    },
    true
  )
  assertEquals(r.objetos, [{ nombre: 'Gata hidráulica', categoria: 'herramientas', cantidad: 1, confianza: 0.9 }])
  assertEquals(r.danos.length, 1)
  assertEquals(r.danos[0].caja, { x: 0.1, y: 0.2, ancho: 0.3, alto: 0.1 })
})

Deno.test('normalizarAnalisis: descarta objetos en fotos del exterior', () => {
  const r = normalizarAnalisis({ objetos: [{ nombre: 'Bolso', categoria: 'accesorios', cantidad: 1, confianza: 0.9 }], danos: [] }, false)
  assertEquals(r.objetos, [])
})

Deno.test('normalizarAnalisis: descarta confianza baja y datos incompletos', () => {
  const r = normalizarAnalisis(
    {
      objetos: [
        { nombre: 'Dudoso', categoria: 'otros', cantidad: 1, confianza: 0.2 },
        { nombre: '', categoria: 'otros', cantidad: 1, confianza: 0.9 },
        { categoria: 'otros', cantidad: 1 },
      ],
      danos: [
        { descripcion: 'Sin caja', tipo: 'raya', severidad: 'leve', confianza: 0.9 },
        { descripcion: 'Poco seguro', tipo: 'raya', severidad: 'leve', confianza: 0.3, caja: { x: 0, y: 0, ancho: 0.5, alto: 0.5 } },
        { descripcion: 'Caja vacía', tipo: 'raya', severidad: 'leve', confianza: 0.9, caja: { x: 0.2, y: 0.2, ancho: 0, alto: 0.5 } },
      ],
    },
    true
  )
  assertEquals(r, { objetos: [], danos: [] })
})

Deno.test('normalizarAnalisis: acota la caja a la imagen y corrige enums y cantidades', () => {
  const r = normalizarAnalisis(
    {
      objetos: [{ nombre: 'Algo', categoria: 'inventada', cantidad: 500.4, confianza: 5 }],
      danos: [{ descripcion: 'Golpe', tipo: 'inventado', severidad: 'catastrófico', confianza: 0.9, caja: { x: 0.8, y: -1, ancho: 0.9, alto: 3 } }],
    },
    true
  )
  assertEquals(r.objetos, [{ nombre: 'Algo', categoria: 'otros', cantidad: 99, confianza: 1 }])
  assertEquals(r.danos[0].tipo, 'otro')
  assertEquals(r.danos[0].severidad, 'leve')
  assertEquals(r.danos[0].caja.x, 0.8)
  assertEquals(r.danos[0].caja.y, 0)
  assertEquals(Math.round(r.danos[0].caja.ancho * 10) / 10, 0.2)
  assertEquals(r.danos[0].caja.alto, 1)
})

Deno.test('normalizarAnalisis: tolera basura y aplica topes', () => {
  assertEquals(normalizarAnalisis(null, true), { objetos: [], danos: [] })
  assertEquals(normalizarAnalisis('texto', true), { objetos: [], danos: [] })
  assertEquals(normalizarAnalisis({ objetos: 'x', danos: 5 }, true), { objetos: [], danos: [] })
  const muchos = Array.from({ length: 50 }, (_, i) => ({ nombre: `Objeto ${i}`, categoria: 'otros', cantidad: 1, confianza: 0.9 }))
  assertEquals(normalizarAnalisis({ objetos: muchos, danos: [] }, true).objetos.length, 20)
})
