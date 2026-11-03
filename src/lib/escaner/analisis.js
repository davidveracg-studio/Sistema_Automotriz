// Análisis de frames en el dispositivo. Funciones puras sobre un objeto
// compatible con ImageData ({ data: RGBA, width, height }); no tocan DOM, así
// que se pueden probar en Node (scripts/probar-escaner.mjs).

export const CONFIG_POR_DEFECTO = {
  intervaloMinMs: 1500, // tiempo mínimo entre dos capturas automáticas
  umbralNitidez: 40, // varianza del Laplaciano mínima para considerar el frame nítido
  umbralCambio: 28, // bits distintos (de 144) vs la última foto para considerar "otro encuadre"
  umbralMovimiento: 24, // bits distintos entre frames consecutivos por encima de los cuales se avisa "muy rápido"
  calidadJpeg: 0.8,
  ladoMaximo: 1600,
  maxFotos: 60,
}

// Escala de grises (luminancia) como Float32Array.
export function aGrises(imagen) {
  const { data, width, height } = imagen
  const gris = new Float32Array(width * height)
  for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
    gris[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
  }
  return gris
}

// Varianza del Laplaciano (kernel 3x3 de 4 vecinos). Alta = bordes definidos;
// baja = desenfoque o movimiento.
export function varianzaLaplaciano(gris, width, height) {
  if (width < 3 || height < 3) return 0
  let suma = 0
  let sumaCuadrados = 0
  let n = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = gris[i - width] + gris[i + width] + gris[i - 1] + gris[i + 1] - 4 * gris[i]
      suma += lap
      sumaCuadrados += lap * lap
      n++
    }
  }
  const media = suma / n
  return sumaCuadrados / n - media * media
}

// Hash perceptual de 144 bits: reduce a 9x9 por promedio de bloques y compara
// píxeles vecinos en horizontal (72 bits) y en vertical (72 bits). Devuelve un
// Uint8Array de 0/1 (más simple que BigInt y suficiente para Hamming).
export const BITS_HASH = 144

export function hashPerceptual(gris, width, height) {
  const n = 9
  const reducida = new Float32Array(n * n)
  for (let fy = 0; fy < n; fy++) {
    const y0 = Math.floor((fy * height) / n)
    const y1 = Math.max(y0 + 1, Math.floor(((fy + 1) * height) / n))
    for (let fx = 0; fx < n; fx++) {
      const x0 = Math.floor((fx * width) / n)
      const x1 = Math.max(x0 + 1, Math.floor(((fx + 1) * width) / n))
      let suma = 0
      let cuenta = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          suma += gris[y * width + x]
          cuenta++
        }
      }
      reducida[fy * n + fx] = suma / cuenta
    }
  }
  const bits = new Uint8Array(BITS_HASH)
  let k = 0
  for (let fy = 0; fy < n; fy++) {
    for (let fx = 0; fx < n - 1; fx++) {
      bits[k++] = reducida[fy * n + fx] > reducida[fy * n + fx + 1] ? 1 : 0
    }
  }
  for (let fy = 0; fy < n - 1; fy++) {
    for (let fx = 0; fx < n; fx++) {
      bits[k++] = reducida[fy * n + fx] > reducida[(fy + 1) * n + fx] ? 1 : 0
    }
  }
  return bits
}

export function distanciaHamming(a, b) {
  if (!a || !b) return BITS_HASH
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

// Analiza un frame: nitidez + hash. `previo` es el resultado del frame
// anterior (para medir movimiento entre frames).
export function analizarFrame(imagen, previo) {
  const gris = aGrises(imagen)
  const nitidez = varianzaLaplaciano(gris, imagen.width, imagen.height)
  const hash = hashPerceptual(gris, imagen.width, imagen.height)
  const movimiento = previo?.hash ? distanciaHamming(hash, previo.hash) : 0
  return { nitidez, hash, movimiento }
}

// Decide si hay que capturar. Estados posibles para la guía en pantalla:
//   'borroso'  -> imagen sin nitidez suficiente
//   'rapido'   -> mucho movimiento entre frames (barrido demasiado veloz)
//   'repetido' -> mismo encuadre que la última foto (no hay cambio de escena)
//   'espera'   -> aún no pasa el intervalo mínimo
//   'limite'   -> se alcanzó el máximo de fotos
//   'captura'  -> capturar ahora
export function decidirCaptura({ analisis, ultimoHash, ultimaCapturaMs, ahoraMs, totalFotos, config }) {
  if (totalFotos >= config.maxFotos) return 'limite'
  if (analisis.movimiento > config.umbralMovimiento) return 'rapido'
  if (analisis.nitidez < config.umbralNitidez) return 'borroso'
  if (ultimaCapturaMs != null && ahoraMs - ultimaCapturaMs < config.intervaloMinMs) return 'espera'
  if (ultimoHash && distanciaHamming(analisis.hash, ultimoHash) < config.umbralCambio) return 'repetido'
  return 'captura'
}
