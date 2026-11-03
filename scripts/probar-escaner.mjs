// Pruebas de la lógica de captura del escáner (nitidez, cambio de escena,
// decisión). Sin framework: falla con código de salida 1 si algo no se cumple.
import assert from 'node:assert/strict'
import {
  CONFIG_POR_DEFECTO,
  aGrises,
  analizarFrame,
  decidirCaptura,
  distanciaHamming,
  hashPerceptual,
  varianzaLaplaciano,
} from '../src/lib/escaner/analisis.js'

const W = 240
const H = 180

function imagen(fn) {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = fn(x, y)
      const i = (y * W + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width: W, height: H }
}

// Tablero de ajedrez nítido vs. el mismo suavizado (desenfoque de caja).
const tablero = (x, y) => (((x >> 3) + (y >> 3)) % 2 ? 230 : 25)
const nitida = imagen(tablero)
const lisa = imagen(() => 128)
const borrosa = (() => {
  const g = aGrises(nitida)
  const salida = new Uint8ClampedArray(W * H * 4)
  const r = 6
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0
      let n = 0
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) {
            s += g[yy * W + xx]
            n++
          }
        }
      }
      const i = (y * W + x) * 4
      salida[i] = salida[i + 1] = salida[i + 2] = s / n
      salida[i + 3] = 255
    }
  }
  return { data: salida, width: W, height: H }
})()

const nit = (img) => varianzaLaplaciano(aGrises(img), W, H)
const vNitida = nit(nitida)
const vBorrosa = nit(borrosa)
const vLisa = nit(lisa)
console.log({ vNitida, vBorrosa, vLisa })
assert.ok(vNitida > CONFIG_POR_DEFECTO.umbralNitidez * 10, 'la imagen nítida supera el umbral con holgura')
assert.ok(vBorrosa < CONFIG_POR_DEFECTO.umbralNitidez, 'la imagen borrosa queda bajo el umbral')
assert.equal(vLisa, 0)

// Cambio de escena: degradado horizontal vs. vertical vs. el mismo con ruido leve.
const gradH = imagen((x) => 255 - (x * 255) / W)
const gradV = imagen((_x, y) => 255 - (y * 255) / H)
const gradHRuido = imagen((x, y) => 255 - (x * 255) / W + ((x * 7 + y * 13) % 5))
const hash = (img) => hashPerceptual(aGrises(img), W, H)
const dMisma = distanciaHamming(hash(gradH), hash(gradHRuido))
const dOtra = distanciaHamming(hash(gradH), hash(gradV))
console.log({ dMisma, dOtra })
assert.ok(dMisma < CONFIG_POR_DEFECTO.umbralCambio, 'misma escena con ruido = repetido')
assert.ok(dOtra >= CONFIG_POR_DEFECTO.umbralCambio, 'otra escena = cambio suficiente')

// Dos texturas distintas (franjas verticales vs. círculos) también difieren.
const franjas = imagen((x) => ((x >> 4) % 2 ? 220 : 40))
const circulos = imagen((x, y) => (Math.floor(Math.hypot(x - 120, y - 90) / 20) % 2 ? 220 : 40))
const dTexturas = distanciaHamming(hash(franjas), hash(circulos))
console.log({ dTexturas })
assert.ok(dTexturas >= CONFIG_POR_DEFECTO.umbralCambio, 'texturas distintas = cambio suficiente')

// Decisiones.
const cfg = { ...CONFIG_POR_DEFECTO }
const base = { ultimoHash: null, ultimaCapturaMs: null, ahoraMs: 10_000, totalFotos: 0, config: cfg }
const a = (nitidez, hashx, movimiento = 0) => ({ nitidez, hash: hashx, movimiento })
assert.equal(decidirCaptura({ ...base, analisis: a(500, hash(gradH)) }), 'captura')
assert.equal(decidirCaptura({ ...base, analisis: a(5, hash(gradH)) }), 'borroso')
assert.equal(decidirCaptura({ ...base, analisis: a(500, hash(gradH), 30) }), 'rapido')
assert.equal(
  decidirCaptura({ ...base, analisis: a(500, hash(gradV)), ultimoHash: hash(gradH), ultimaCapturaMs: 9_500 }),
  'espera'
)
assert.equal(
  decidirCaptura({ ...base, analisis: a(500, hash(gradHRuido)), ultimoHash: hash(gradH), ultimaCapturaMs: 1_000 }),
  'repetido'
)
assert.equal(
  decidirCaptura({ ...base, analisis: a(500, hash(gradV)), ultimoHash: hash(gradH), ultimaCapturaMs: 1_000 }),
  'captura'
)
assert.equal(decidirCaptura({ ...base, analisis: a(500, hash(gradH)), totalFotos: cfg.maxFotos }), 'limite')

// Movimiento entre frames consecutivos.
const f1 = analizarFrame(gradH)
const f2 = analizarFrame(gradV, f1)
assert.ok(f2.movimiento > cfg.umbralMovimiento, 'un cambio brusco entre frames cuenta como movimiento')
assert.equal(analizarFrame(gradH, f1).movimiento, 0)

// --- Puente escáner → diagrama de daños -------------------------------------
import { contarPendientes, limpiarMarcas, sincronizarMarcasConFotos, vistaDeFoto } from '../src/lib/escaner/diagrama.js'

const foto = (id, zona, subzona, extra = {}) => ({ id, zona, subzona, esDano: false, nota: '', ...extra })

assert.equal(vistaDeFoto(foto('a', 'exterior', 'frontal')), 'frontal')
assert.equal(vistaDeFoto(foto('a', 'exterior', 'trasera')), 'posterior')
assert.equal(vistaDeFoto(foto('a', 'exterior', 'techo')), 'superior')
assert.equal(vistaDeFoto(foto('a', 'exterior', 'esquina_tra_der')), 'lateral_der')
assert.equal(vistaDeFoto(foto('a', 'interior', 'tablero')), null, 'el interior no tiene vista en el diagrama')

// Una foto de daño crea una marca pendiente en la vista de su zona, con la foto vinculada.
let marcas = []
const fd1 = foto('f1', 'exterior', 'lateral_izq', { esDano: true, nota: 'raya en puerta' })
marcas = sincronizarMarcasConFotos(marcas, [fd1, foto('f2', 'exterior', 'frontal')])
assert.equal(marcas.length, 1, 'solo la foto marcada como daño genera marca')
assert.deepEqual(
  { vista: marcas[0].vista, fotos: marcas[0].fotos, nota: marcas[0].nota, pendiente: marcas[0].pendiente },
  { vista: 'lateral_izq', fotos: ['f1'], nota: 'raya en puerta', pendiente: true }
)
assert.equal(contarPendientes(marcas), 1)

// Idempotente: sin cambios devuelve la misma lista (evita bucles de render).
assert.equal(sincronizarMarcasConFotos(marcas, [fd1, foto('f2', 'exterior', 'frontal')]), marcas)

// Mientras está pendiente, la nota sigue a la de la foto; una vez confirmada ya no.
const fd1b = { ...fd1, nota: 'raya profunda en puerta' }
const sigue = sincronizarMarcasConFotos(marcas, [fd1b])
assert.equal(sigue[0].nota, 'raya profunda en puerta')
const confirmada = [{ ...sigue[0], pendiente: false }]
assert.equal(sincronizarMarcasConFotos(confirmada, [{ ...fd1b, nota: 'otra' }])[0].nota, 'raya profunda en puerta')

// Si la foto deja de ser daño: la sugerencia pendiente se retira; la confirmada se conserva sin la foto.
assert.equal(sincronizarMarcasConFotos(sigue, [{ ...fd1b, esDano: false }]).length, 0)
const sinFoto = sincronizarMarcasConFotos(confirmada, [])
assert.equal(sinFoto.length, 1)
assert.deepEqual(sinFoto[0].fotos, [])

// Las marcas hechas a mano (sin fotos) no se tocan.
const manual = [{ vista: 'frontal', x: 0.2, y: 0.3, nota: 'a mano' }]
assert.equal(sincronizarMarcasConFotos(manual, []), manual)

// Una sugerencia que la persona quitó a propósito no se vuelve a crear.
assert.equal(sincronizarMarcasConFotos([], [fd1], new Set(['f1'])).length, 0)

// Una foto de daño del interior no genera marca.
assert.equal(sincronizarMarcasConFotos([], [foto('i1', 'interior', 'tablero', { esDano: true })]).length, 0)

// limpiarMarcas quita lo que es solo de pantalla.
assert.deepEqual(limpiarMarcas([{ vista: 'frontal', x: 0.5, y: 0.5, nota: 'n', fotos: ['f1'], pendiente: false, notaDeFoto: true }, manual[0]]), [
  { vista: 'frontal', x: 0.5, y: 0.5, nota: 'n', fotos: ['f1'] },
  { vista: 'frontal', x: 0.2, y: 0.3, nota: 'a mano' },
])

console.log('✓ Escáner: nitidez, cambio de escena, decisión de captura y puente con el diagrama correctos.')
