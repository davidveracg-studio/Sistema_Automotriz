// Trazos ondulados de la pantalla de inicio de sesión: las dos líneas del fondo
// (amarilla y roja) ondulan como olas. Cada trazo parte de la curva original y le
// suma una onda senoidal cuya fase avanza; los fotogramas de la animación (SMIL,
// atributo "d") son la misma línea con la onda desplazada, y el último repite al
// primero para que el movimiento no dé saltos.
// Sin dependencias del navegador: se puede probar con node.

export const CURVA_AMARILLA = [
  [-50, 220],
  [250, 120],
  [520, 90],
  [860, 30],
]
export const CURVA_ROJA = [
  [-50, 250],
  [280, 170],
  [560, 150],
  [880, 100],
]

// Mismo criterio, para el login de demo VPAI (coloreadas en plateado/azul
// claro en vez de amarillo/rojo, ver LoginDemo.jsx).
export const CURVA_PLATEADA = [
  [-50, 230],
  [260, 110],
  [540, 80],
  [870, 40],
]
export const CURVA_AZUL = [
  [-50, 260],
  [270, 180],
  [550, 140],
  [890, 90],
]

const PUNTOS = 48
const FOTOGRAMAS = 8

function puntoDeBezier(t, curva) {
  const u = 1 - t
  const [a, b, c, d] = curva
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ]
}

// Un trazo: la curva con una onda de `amplitud` y `ciclos` ondas a lo largo, en la fase dada.
export function trazoOnda(curva, amplitud, ciclos, fase) {
  const partes = []
  for (let i = 0; i <= PUNTOS; i++) {
    const t = i / PUNTOS
    const [x, y] = puntoDeBezier(t, curva)
    const desvio = amplitud * Math.sin(2 * Math.PI * ciclos * t + fase)
    partes.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(y + desvio).toFixed(1)}`)
  }
  return partes.join(' ')
}

// Fotogramas de un ciclo completo. sentido = 1 o -1: hacia dónde viaja la onda.
export function fotogramasOnda(curva, amplitud, ciclos, sentido = 1) {
  return Array.from({ length: FOTOGRAMAS + 1 }, (_, k) => trazoOnda(curva, amplitud, ciclos, (-2 * Math.PI * k * sentido) / FOTOGRAMAS)).join(';')
}
