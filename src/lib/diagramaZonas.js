// Zonas (piezas) del vehículo sobre los 5 dibujos de cada tipo de carrocería.
//
// Cada zona es un polígono con coordenadas como fracción 0-1 del RECUADRO de
// su vista (el mismo sistema que usan las marcas { vista, x, y } del
// diagrama), así que una marca cae en una pieza con un simple punto-en-
// polígono. Las zonas son aproximadas: sirven para decir "esto es la puerta
// delantera izquierda", no para recortar el dibujo.
//
// OJO con los lados. `vista` es la clave del recuadro ('lateral_der' /
// 'lateral_izq') y NO siempre coincide con el lado real del vehículo que
// muestra el dibujo: en sedán, SUV, pickup y furgón la vista 'lateral_der'
// tiene el frente a la IZQUIERDA de la imagen, que es el lado izquierdo del
// auto (en la vista del lado derecho el frente apunta a la derecha). Las
// marcas ya guardadas usan la clave `vista` y no se tocan; LADO_DE_VISTA dice
// qué lado real muestra cada dibujo, y de ahí salen los rótulos y las piezas.
// En el frente y la parte trasera, "izq"/"der" son del vehículo, no de la imagen.

const R = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]
const espejarX = (poligono) => poligono.map(([x, y]) => [1 - x, y])

export const ETIQUETA_PIEZA = {
  capo: 'Capó',
  parabrisas: 'Parabrisas',
  techo: 'Techo',
  luneta: 'Luneta (vidrio trasero)',
  maletero: 'Tapa del maletero',
  porton_trasero: 'Portón trasero',
  caja: 'Caja de carga',
  parrilla: 'Parrilla',
  parachoques_del: 'Parachoques delantero',
  parachoques_tra: 'Parachoques trasero',
  faro_izq: 'Faro delantero izquierdo',
  faro_der: 'Faro delantero derecho',
  luz_tra_izq: 'Luz trasera izquierda',
  luz_tra_der: 'Luz trasera derecha',
  puerta_del_izq: 'Puerta delantera izquierda',
  puerta_del_der: 'Puerta delantera derecha',
  puerta_tra_izq: 'Puerta trasera izquierda',
  puerta_tra_der: 'Puerta trasera derecha',
  puerta_corrediza_izq: 'Puerta corrediza izquierda',
  puerta_corrediza_der: 'Puerta corrediza derecha',
  portalon_izq: 'Portalón trasero izquierdo',
  portalon_der: 'Portalón trasero derecho',
  vidrio_del_izq: 'Vidrio delantero izquierdo',
  vidrio_del_der: 'Vidrio delantero derecho',
  vidrio_tra_izq: 'Vidrio trasero izquierdo',
  vidrio_tra_der: 'Vidrio trasero derecho',
  guardabarros_del_izq: 'Guardabarros delantero izquierdo',
  guardabarros_del_der: 'Guardabarros delantero derecho',
  guardabarros_tra_izq: 'Costado trasero izquierdo',
  guardabarros_tra_der: 'Costado trasero derecho',
  llanta_del_izq: 'Llanta delantera izquierda',
  llanta_del_der: 'Llanta delantera derecha',
  llanta_tra_izq: 'Llanta trasera izquierda',
  llanta_tra_der: 'Llanta trasera derecha',
  espejo_izq: 'Espejo izquierdo',
  espejo_der: 'Espejo derecho',
}

// Lado REAL del vehículo que muestra cada dibujo lateral.
export const LADO_DE_VISTA = {
  sedan: { lateral_der: 'izq', lateral_izq: 'der' },
  suv: { lateral_der: 'izq', lateral_izq: 'der' },
  pickup: { lateral_der: 'izq', lateral_izq: 'der' },
  furgon: { lateral_der: 'izq', lateral_izq: 'der' },
  hatchback: { lateral_der: 'der', lateral_izq: 'izq' },
}

const NOMBRE_LADO = { izq: 'izquierdo', der: 'derecho' }

export function ladoDeVista(tipo, vista) {
  return (LADO_DE_VISTA[tipo] || LADO_DE_VISTA.sedan)[vista] || null
}

// Rótulo de una vista según el lado real que muestra el dibujo.
export function etiquetaDeVista(tipo, vista, etiquetaBase) {
  const lado = ladoDeVista(tipo, vista)
  return lado ? `Lateral ${NOMBRE_LADO[lado]}` : etiquetaBase
}

// Clave de vista que muestra el lado real `lado` ('izq' | 'der') del vehículo.
export function vistaDeLado(tipo, lado) {
  const tabla = LADO_DE_VISTA[tipo] || LADO_DE_VISTA.sedan
  return Object.keys(tabla).find((vista) => tabla[vista] === lado) || null
}

// --- Laterales ---------------------------------------------------------------
// Plantilla para un lateral con el frente a la izquierda de la imagen.
function lateralFrenteIzquierda(p, lado) {
  return [
    { id: `llanta_del_${lado}`, poligono: R(p.fw - p.ww, p.wy0, p.fw + p.ww, p.wy1) },
    { id: `llanta_tra_${lado}`, poligono: R(p.rw - p.ww, p.wy0, p.rw + p.ww, p.wy1) },
    { id: `espejo_${lado}`, poligono: R(...p.espejo) },
    { id: `vidrio_del_${lado}`, poligono: R(p.A, p.g0, p.B, p.g1) },
    { id: `vidrio_tra_${lado}`, poligono: R(p.B, p.g0, p.C, p.g1) },
    { id: `puerta_del_${lado}`, poligono: R(p.A, p.d0, p.B, p.d1) },
    { id: `puerta_tra_${lado}`, poligono: R(p.B, p.d0, p.C, p.d1) },
    { id: 'techo', poligono: R(p.A + 0.03, p.t0, p.C - 0.03, p.g0) },
    { id: 'parachoques_del', poligono: R(p.fe, p.bm, p.fe + 0.11, p.d1 + 0.17) },
    { id: 'parachoques_tra', poligono: R(p.re - 0.11, p.bm, p.re, p.d1 + 0.17) },
    { id: `guardabarros_del_${lado}`, poligono: R(p.fe + 0.11, p.h0, p.A, p.d1) },
    p.caja
      ? { id: 'caja', poligono: R(p.C, p.q0, p.re, p.d1) }
      : { id: `guardabarros_tra_${lado}`, poligono: R(p.C, p.q0, p.re - 0.11, p.d1) },
  ]
}

const LATERAL = {
  sedan: { fw: 0.22, rw: 0.75, ww: 0.075, wy0: 0.62, wy1: 0.94, A: 0.33, B: 0.5, C: 0.72, d0: 0.38, d1: 0.73, g0: 0.18, g1: 0.37, fe: 0.02, re: 0.99, bm: 0.5, h0: 0.4, q0: 0.38, t0: 0.05, espejo: [0.25, 0.33, 0.35, 0.45] },
  suv: { fw: 0.25, rw: 0.765, ww: 0.085, wy0: 0.56, wy1: 0.93, A: 0.36, B: 0.58, C: 0.78, d0: 0.33, d1: 0.66, g0: 0.13, g1: 0.32, fe: 0.02, re: 0.98, bm: 0.45, h0: 0.38, q0: 0.24, t0: 0.03, espejo: [0.3, 0.32, 0.4, 0.44] },
  hatchback: { fw: 0.23, rw: 0.78, ww: 0.085, wy0: 0.57, wy1: 0.93, A: 0.3, B: 0.54, C: 0.73, d0: 0.36, d1: 0.7, g0: 0.12, g1: 0.33, fe: 0.02, re: 0.98, bm: 0.5, h0: 0.4, q0: 0.28, t0: 0.05, espejo: [0.27, 0.34, 0.37, 0.44] },
  pickup: { fw: 0.2, rw: 0.73, ww: 0.07, wy0: 0.6, wy1: 0.95, A: 0.31, B: 0.5, C: 0.69, d0: 0.28, d1: 0.62, g0: 0.08, g1: 0.26, fe: 0.03, re: 0.98, bm: 0.45, h0: 0.3, q0: 0.3, t0: 0.03, espejo: [0.27, 0.28, 0.34, 0.38], caja: true },
}

// Furgón: no encaja en la plantilla (cabina + puerta corrediza + costado largo).
function lateralFurgonFrenteIzquierda(lado) {
  return [
    { id: `llanta_del_${lado}`, poligono: R(0.1, 0.72, 0.25, 0.97) },
    { id: `llanta_tra_${lado}`, poligono: R(0.67, 0.72, 0.82, 0.97) },
    { id: `espejo_${lado}`, poligono: R(0.14, 0.3, 0.2, 0.42) },
    { id: `vidrio_del_${lado}`, poligono: R(0.21, 0.14, 0.35, 0.34) },
    { id: `vidrio_tra_${lado}`, poligono: R(0.37, 0.14, 0.8, 0.34) },
    { id: `puerta_del_${lado}`, poligono: R(0.2, 0.34, 0.36, 0.72) },
    { id: `puerta_corrediza_${lado}`, poligono: R(0.36, 0.34, 0.62, 0.72) },
    { id: 'techo', poligono: R(0.2, 0.02, 0.9, 0.14) },
    { id: 'parachoques_del', poligono: R(0.02, 0.58, 0.12, 0.8) },
    { id: 'parachoques_tra', poligono: R(0.9, 0.58, 0.98, 0.8) },
    { id: `guardabarros_del_${lado}`, poligono: R(0.04, 0.4, 0.2, 0.72) },
    { id: `guardabarros_tra_${lado}`, poligono: R(0.62, 0.34, 0.97, 0.72) },
  ]
}

function laterales(tipo) {
  const lados = LADO_DE_VISTA[tipo]
  const frenteIzquierda = (lado) => (tipo === 'furgon' ? lateralFurgonFrenteIzquierda(lado) : lateralFrenteIzquierda(LATERAL[tipo], lado))
  const resultado = {}
  for (const vista of ['lateral_der', 'lateral_izq']) {
    // Con el frente a la derecha, la vista es la imagen espejada de la plantilla.
    const frenteAIzquierdaEnImagen = tipo === 'hatchback' ? vista === 'lateral_izq' : vista === 'lateral_der'
    const zonas = frenteIzquierda(lados[vista])
    resultado[vista] = frenteAIzquierdaEnImagen ? zonas : zonas.map((zona) => ({ ...zona, poligono: espejarX(zona.poligono) }))
  }
  return resultado
}

// --- Frente y parte trasera ----------------------------------------------------
// En la imagen frontal el lado izquierdo de la imagen es el DERECHO del vehículo;
// en la trasera, el izquierdo de la imagen es el IZQUIERDO del vehículo.
const par = (id, poligonoImagenIzq, ladoImagenIzq) => {
  const otro = ladoImagenIzq === 'izq' ? 'der' : 'izq'
  return [
    { id: `${id}_${ladoImagenIzq}`, poligono: poligonoImagenIzq },
    { id: `${id}_${otro}`, poligono: espejarX(poligonoImagenIzq) },
  ]
}

const FRONTAL = {
  sedan: [
    ...par('espejo', R(0.03, 0.27, 0.17, 0.4), 'der'),
    ...par('llanta_del', R(0.13, 0.84, 0.23, 0.97), 'der'),
    ...par('faro', R(0.14, 0.48, 0.31, 0.6), 'der'),
    { id: 'parabrisas', poligono: [[0.22, 0.09], [0.78, 0.09], [0.83, 0.31], [0.17, 0.31]] },
    { id: 'capo', poligono: [[0.17, 0.32], [0.83, 0.32], [0.88, 0.47], [0.12, 0.47]] },
    { id: 'parachoques_del', poligono: [[0.31, 0.47], [0.69, 0.47], [0.88, 0.6], [0.9, 0.84], [0.1, 0.84], [0.12, 0.6]] },
  ],
  suv: [
    ...par('espejo', R(0.05, 0.28, 0.17, 0.42), 'der'),
    ...par('llanta_del', R(0.11, 0.78, 0.24, 0.95), 'der'),
    ...par('faro', R(0.14, 0.46, 0.31, 0.58), 'der'),
    { id: 'parrilla', poligono: R(0.33, 0.47, 0.67, 0.62) },
    { id: 'parabrisas', poligono: [[0.22, 0.12], [0.78, 0.12], [0.83, 0.38], [0.17, 0.38]] },
    { id: 'capo', poligono: [[0.17, 0.39], [0.83, 0.39], [0.88, 0.47], [0.12, 0.47]] },
    { id: 'parachoques_del', poligono: R(0.08, 0.58, 0.92, 0.8) },
  ],
  hatchback: [
    ...par('espejo', R(0.05, 0.3, 0.15, 0.42), 'der'),
    ...par('llanta_del', R(0.09, 0.8, 0.2, 0.97), 'der'),
    ...par('faro', R(0.13, 0.48, 0.31, 0.6), 'der'),
    { id: 'parabrisas', poligono: [[0.24, 0.14], [0.76, 0.14], [0.82, 0.36], [0.18, 0.36]] },
    { id: 'capo', poligono: [[0.16, 0.37], [0.84, 0.37], [0.88, 0.5], [0.12, 0.5]] },
    { id: 'parachoques_del', poligono: R(0.08, 0.58, 0.92, 0.85) },
  ],
  pickup: [
    ...par('espejo', R(0.05, 0.3, 0.16, 0.42), 'der'),
    ...par('llanta_del', R(0.1, 0.76, 0.22, 0.97), 'der'),
    ...par('faro', R(0.14, 0.46, 0.34, 0.55), 'der'),
    { id: 'parrilla', poligono: R(0.35, 0.47, 0.65, 0.58) },
    { id: 'parabrisas', poligono: [[0.22, 0.1], [0.78, 0.1], [0.8, 0.33], [0.2, 0.33]] },
    { id: 'capo', poligono: [[0.17, 0.34], [0.83, 0.34], [0.85, 0.45], [0.15, 0.45]] },
    { id: 'parachoques_del', poligono: R(0.08, 0.58, 0.92, 0.88) },
  ],
  furgon: [
    ...par('espejo', R(0.05, 0.4, 0.15, 0.55), 'der'),
    ...par('llanta_del', R(0.15, 0.84, 0.26, 0.97), 'der'),
    ...par('faro', R(0.2, 0.58, 0.33, 0.69), 'der'),
    { id: 'parrilla', poligono: R(0.34, 0.6, 0.66, 0.71) },
    { id: 'techo', poligono: R(0.2, 0.02, 0.8, 0.27) },
    { id: 'parabrisas', poligono: [[0.22, 0.28], [0.78, 0.28], [0.8, 0.47], [0.2, 0.47]] },
    { id: 'capo', poligono: R(0.22, 0.47, 0.78, 0.58) },
    { id: 'parachoques_del', poligono: R(0.14, 0.72, 0.86, 0.84) },
  ],
}

const POSTERIOR = {
  sedan: [
    ...par('espejo', R(0.04, 0.28, 0.17, 0.4), 'izq'),
    ...par('llanta_tra', R(0.13, 0.85, 0.23, 0.97), 'izq'),
    ...par('luz_tra', R(0.14, 0.43, 0.31, 0.58), 'izq'),
    { id: 'luneta', poligono: [[0.22, 0.08], [0.78, 0.08], [0.82, 0.3], [0.18, 0.3]] },
    { id: 'maletero', poligono: R(0.14, 0.31, 0.86, 0.62) },
    { id: 'parachoques_tra', poligono: R(0.1, 0.62, 0.9, 0.85) },
  ],
  suv: [
    ...par('espejo', R(0.05, 0.27, 0.17, 0.4), 'izq'),
    ...par('llanta_tra', R(0.11, 0.8, 0.24, 0.95), 'izq'),
    ...par('luz_tra', R(0.14, 0.37, 0.31, 0.53), 'izq'),
    { id: 'luneta', poligono: [[0.22, 0.14], [0.78, 0.14], [0.8, 0.33], [0.2, 0.33]] },
    { id: 'porton_trasero', poligono: R(0.15, 0.34, 0.85, 0.66) },
    { id: 'parachoques_tra', poligono: R(0.1, 0.66, 0.9, 0.84) },
  ],
  hatchback: [
    ...par('espejo', R(0.04, 0.27, 0.14, 0.38), 'izq'),
    ...par('llanta_tra', R(0.07, 0.78, 0.2, 0.97), 'izq'),
    ...par('luz_tra', R(0.1, 0.33, 0.28, 0.46), 'izq'),
    { id: 'luneta', poligono: [[0.22, 0.1], [0.78, 0.1], [0.82, 0.31], [0.18, 0.31]] },
    { id: 'porton_trasero', poligono: R(0.18, 0.32, 0.82, 0.58) },
    { id: 'parachoques_tra', poligono: R(0.08, 0.58, 0.92, 0.8) },
  ],
  pickup: [
    ...par('espejo', R(0.05, 0.27, 0.17, 0.4), 'izq'),
    ...par('llanta_tra', R(0.1, 0.76, 0.24, 0.97), 'izq'),
    ...par('luz_tra', R(0.08, 0.43, 0.17, 0.57), 'izq'),
    { id: 'luneta', poligono: R(0.2, 0.1, 0.8, 0.33) },
    { id: 'porton_trasero', poligono: R(0.15, 0.4, 0.85, 0.62) },
    { id: 'parachoques_tra', poligono: R(0.1, 0.62, 0.9, 0.78) },
  ],
  furgon: [
    ...par('espejo', R(0.05, 0.35, 0.16, 0.5), 'izq'),
    ...par('llanta_tra', R(0.14, 0.84, 0.26, 0.97), 'izq'),
    ...par('luz_tra', R(0.12, 0.47, 0.2, 0.66), 'izq'),
    { id: 'portalon_izq', poligono: R(0.2, 0.12, 0.5, 0.78) },
    { id: 'portalon_der', poligono: R(0.5, 0.12, 0.8, 0.78) },
    { id: 'parachoques_tra', poligono: R(0.14, 0.78, 0.86, 0.86) },
  ],
}

// --- Vista superior (frente a la izquierda en todos los dibujos) -----------------
const franjas = (lista) => lista.map(([id, x0, x1]) => ({ id, poligono: R(x0, 0.02, x1, 0.98) }))
const SUPERIOR = {
  sedan: franjas([['capo', 0.04, 0.26], ['parabrisas', 0.26, 0.4], ['techo', 0.4, 0.72], ['luneta', 0.72, 0.84], ['maletero', 0.84, 0.98]]),
  suv: franjas([['capo', 0.04, 0.28], ['parabrisas', 0.28, 0.4], ['techo', 0.4, 0.78], ['luneta', 0.78, 0.86], ['porton_trasero', 0.86, 0.98]]),
  hatchback: franjas([['capo', 0.04, 0.27], ['parabrisas', 0.27, 0.41], ['techo', 0.41, 0.72], ['luneta', 0.72, 0.79], ['porton_trasero', 0.79, 0.97]]),
  pickup: franjas([['capo', 0.03, 0.24], ['parabrisas', 0.24, 0.33], ['techo', 0.33, 0.62], ['luneta', 0.62, 0.68], ['caja', 0.68, 0.97]]),
  furgon: franjas([['capo', 0.03, 0.18], ['parabrisas', 0.18, 0.28], ['techo', 0.28, 0.97]]),
}

const TIPOS = ['sedan', 'suv', 'hatchback', 'pickup', 'furgon']

export const ZONAS = Object.fromEntries(
  TIPOS.map((tipo) => [
    tipo,
    { superior: SUPERIOR[tipo], frontal: FRONTAL[tipo], posterior: POSTERIOR[tipo], ...laterales(tipo) },
  ])
)

export function etiquetaPieza(id) {
  return ETIQUETA_PIEZA[id] || id
}

export function zonasDeVista(tipo, vista) {
  return (ZONAS[tipo] || ZONAS.sedan)[vista] || []
}

function puntoEnPoligono(x, y, poligono) {
  let dentro = false
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i]
    const [xj, yj] = poligono[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro
  }
  return dentro
}

// Zona bajo el punto (x, y) de una vista, o null. Gana la primera de la lista
// (las piezas pequeñas van antes que las grandes que las rodean).
export function zonaEn(tipo, vista, x, y) {
  return zonasDeVista(tipo, vista).find((zona) => puntoEnPoligono(x, y, zona.poligono)) || null
}

export function centroide(zona) {
  const n = zona.poligono.length
  return [zona.poligono.reduce((s, [x]) => s + x, 0) / n, zona.poligono.reduce((s, [, y]) => s + y, 0) / n]
}
