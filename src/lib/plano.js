// Constantes y utilidades puras del plano del taller (ver 0038_plano_taller.sql).
// Sin acceso a la base de datos: todo lo que se puede probar sin red vive acá.

export const CELDA = 24
// Un cuadro de la grilla equivale a 1 m. El lienzo es el área del taller:
// 33 m de ancho por 65 m de largo (2.145 m2).
export const COLUMNAS = 33
export const FILAS = 65

// Categorías del plano, con los mismos colores de la leyenda del layout del
// taller: rojo = puesto productivo, verde = pulmón, naranjo = recepción/ingreso.
export const CATEGORIAS_PLANO = {
  productivo: { etiqueta: 'Puestos productivos', muestra: 'bg-red-100 border-red-600' },
  pulmon: { etiqueta: 'Puestos pulmón', muestra: 'bg-green-100 border-green-600' },
  recepcion: { etiqueta: 'Recepción / ingreso', muestra: 'bg-orange-50 border-orange-500' },
}

// clases: fondo/borde del rectángulo. Las clases de Tailwind van completas
// (no armadas con template strings) para que el compilador las detecte.
export const TIPOS_PLANO = {
  isla_elevador: {
    etiqueta: 'Isla con elevador',
    categoria: 'productivo',
    ancho: 6,
    alto: 4,
    esPuesto: true,
    islaNombre: 'Taller mecánico',
    clases: 'bg-red-100 border-red-600 border-dashed text-red-900',
  },
  isla_simple: {
    etiqueta: 'Isla sin elevador',
    categoria: 'productivo',
    ancho: 6,
    alto: 3,
    esPuesto: true,
    islaNombre: 'Taller mecánico',
    clases: 'bg-red-100 border-red-600 text-red-900',
  },
  isla_pozo: {
    etiqueta: 'Isla con pozo',
    categoria: 'productivo',
    ancho: 6,
    alto: 3,
    esPuesto: true,
    islaNombre: 'Taller mecánico',
    clases: 'bg-red-100 border-red-600 text-red-900',
  },
  alineadora: {
    etiqueta: 'Alineadora',
    categoria: 'productivo',
    ancho: 2,
    alto: 15,
    esPuesto: true,
    islaNombre: 'Alineación',
    clases: 'bg-red-100 border-slate-900 text-red-900',
  },
  vulcanizacion: {
    etiqueta: 'Vulcanización',
    categoria: 'productivo',
    ancho: 6,
    alto: 3,
    esPuesto: true,
    islaNombre: null,
    clases: 'bg-red-100 border-red-600 text-red-900',
  },
  pulmon: {
    etiqueta: 'Espacio de pulmón',
    categoria: 'pulmon',
    ancho: 6,
    alto: 3,
    esPuesto: true,
    islaNombre: null,
    clases: 'bg-green-100 border-green-600 text-green-900',
  },
  desabolladura_pintura: {
    etiqueta: 'Desabolladura y pintura',
    categoria: 'productivo',
    ancho: 3,
    alto: 5,
    esPuesto: true,
    islaNombre: 'Pintura',
    clases: 'bg-red-100 border-red-600 text-red-900',
  },
  lavado: {
    etiqueta: 'Isla de lavado',
    categoria: 'productivo',
    ancho: 3,
    alto: 5,
    esPuesto: true,
    islaNombre: 'Lavado',
    clases: 'bg-red-100 border-red-600 text-red-900',
  },
  recepcion_ingreso: {
    etiqueta: 'Recepción / ingreso',
    categoria: 'recepcion',
    ancho: 6,
    alto: 3,
    esPuesto: true,
    islaNombre: null,
    clases: 'bg-orange-50 border-orange-500 border-dashed text-orange-900',
  },
  oficina: {
    etiqueta: 'Oficina o sala',
    categoria: null,
    ancho: 5,
    alto: 4,
    esPuesto: false,
    islaNombre: null,
    clases: 'bg-slate-100 border-slate-400 text-slate-700',
  },
}

export const ORDEN_PALETA = [
  'isla_elevador',
  'isla_simple',
  'isla_pozo',
  'alineadora',
  'vulcanizacion',
  'desabolladura_pintura',
  'lavado',
  'pulmon',
  'recepcion_ingreso',
  'oficina',
]

export function buscarIslaPorNombre(tiposIsla, nombre) {
  if (!nombre) return null
  const buscado = nombre.toLowerCase()
  return tiposIsla.find((isla) => isla.nombre.toLowerCase() === buscado) || null
}

export function dentroDelLienzo(caja) {
  return caja.x >= 0 && caja.y >= 0 && caja.x + caja.ancho <= COLUMNAS && caja.y + caja.alto <= FILAS
}

export function seSuperponen(a, b) {
  return a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto
}

// Una caja es válida si cabe en el lienzo y no pisa a ninguna otra figura.
export function posicionValida(caja, elementos, ignorarId) {
  if (!dentroDelLienzo(caja)) return false
  return !elementos.some((otro) => otro.id !== ignorarId && seSuperponen(caja, otro))
}

// Primer hueco libre recorriendo el lienzo de arriba a abajo, de izquierda a derecha.
export function buscarHueco(ancho, alto, elementos) {
  for (let y = 0; y + alto <= FILAS; y++) {
    for (let x = 0; x + ancho <= COLUMNAS; x++) {
      if (posicionValida({ x, y, ancho, alto }, elementos, null)) return { x, y }
    }
  }
  return null
}

export function orientacionLarga(elemento) {
  return elemento.alto >= elemento.ancho ? 'vertical' : 'horizontal'
}

export function nombreCliente(cliente) {
  if (!cliente) return ''
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return `${cliente.nombre} ${cliente.apellido || ''}`.trim()
}

export function formatoTranscurrido(desde) {
  if (!desde) return '-'
  const minutos = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000))
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas} h ${minutos % 60} min`
  return `${Math.floor(horas / 24)} d ${horas % 24} h`
}

// Plano base del taller (layout de referencia, 33 m x 65 m). Es la única fuente del
// dibujo: el botón "Cargar plano base" lo inserta tal cual y la migración 0045
// lo replica en el tenant demo. Coordenadas en metros desde la esquina
// superior izquierda; rotacion en grados (sentido horario).
// Solo 4 puestos de mecánica cuentan para la Agenda (los 3 elevadores y el
// Puesto 1): la capacidad de la Agenda sigue en 4, 2, 1, 1 y 1. Los otros
// puestos comunes quedan sin tipo de isla y se pueden activar desde el editor.
const POSICIONES_PULMON = [
  [0, 0, 3, 5], [4, 0, 3, 5], [7, 0, 3, 5],
  [12, 7, 3, 5], [12, 13, 3, 5],
  [0, 7, 6, 3], [0, 11, 6, 3], [0, 14, 6, 3], [0, 18, 6, 3], [0, 21, 6, 3], [0, 24, 6, 3], [0, 28, 6, 3],
  [0, 35, 3, 5], [4, 35, 3, 5], [7, 35, 3, 5],
]

export const PLANO_BASE = [
  ...POSICIONES_PULMON.map(([x, y, ancho, alto], indice) => ({
    tipo: 'pulmon',
    nombre: `Pulmón ${indice + 1}`,
    x,
    y,
    ancho,
    alto,
  })),
  { tipo: 'desabolladura_pintura', nombre: 'Pintura', x: 11, y: 0 },
  { tipo: 'lavado', nombre: 'Lavado', x: 11, y: 35 },
  { tipo: 'alineadora', nombre: 'Alineadora', x: 19, y: 3 },
  { tipo: 'isla_simple', nombre: 'Puesto 1', x: 27, y: 21 },
  { tipo: 'isla_elevador', nombre: 'Elevador 1', x: 27, y: 24 },
  { tipo: 'isla_elevador', nombre: 'Elevador 2', x: 27, y: 28 },
  { tipo: 'isla_simple', nombre: 'Puesto 2', x: 27, y: 33, sinIsla: true },
  { tipo: 'isla_simple', nombre: 'Puesto 3', x: 27, y: 36, sinIsla: true },
  { tipo: 'isla_elevador', nombre: 'Elevador 3', x: 27, y: 40 },
  { tipo: 'isla_simple', nombre: 'Puesto 4', x: 27, y: 44, sinIsla: true },
  { tipo: 'isla_simple', nombre: 'Puesto 5', x: 27, y: 47, sinIsla: true },
  { tipo: 'isla_simple', nombre: 'Puesto 6', x: 27, y: 50, sinIsla: true },
  { tipo: 'isla_simple', nombre: 'Puesto 7', x: 15, y: 44, ancho: 3, alto: 5, sinIsla: true },
  { tipo: 'isla_pozo', nombre: 'Servicio rápido 1', x: 0, y: 56, ancho: 6, alto: 2, rotacion: 30, islaNombre: 'Servicio rápido' },
  { tipo: 'isla_pozo', nombre: 'Servicio rápido 2', x: 0, y: 58, ancho: 6, alto: 2, rotacion: 30, islaNombre: 'Servicio rápido' },
  { tipo: 'recepcion_ingreso', nombre: 'Ingreso 1', x: 27, y: 55 },
  { tipo: 'recepcion_ingreso', nombre: 'Ingreso 2', x: 11, y: 56, ancho: 3, alto: 5 },
  { tipo: 'oficina', nombre: 'Sala 1', x: 15, y: 0, ancho: 3, alto: 3 },
  { tipo: 'oficina', nombre: 'Sala 2', x: 24, y: 0, ancho: 9, alto: 20 },
  { tipo: 'oficina', nombre: 'Sala 3', x: 15, y: 33, ancho: 6, alto: 8 },
  { tipo: 'oficina', nombre: 'Oficina 1', x: 2, y: 42, ancho: 5, alto: 6 },
  { tipo: 'oficina', nombre: 'Oficina 2', x: 7, y: 42, ancho: 7, alto: 4 },
  { tipo: 'oficina', nombre: 'Oficina 3', x: 2, y: 48, ancho: 6, alto: 6 },
  { tipo: 'oficina', nombre: 'Oficina 4', x: 8, y: 46, ancho: 6, alto: 8 },
  { tipo: 'oficina', nombre: 'Sala 4', x: 14, y: 50, ancho: 3, alto: 4 },
  { tipo: 'oficina', nombre: 'Sala 5', x: 27, y: 60, ancho: 6, alto: 4 },
]

// Cantidad de puestos por categoría de la leyenda.
export function contarPorCategoria(elementos) {
  const cuentas = { productivo: 0, pulmon: 0, recepcion: 0 }
  for (const elemento of elementos) {
    const categoria = TIPOS_PLANO[elemento.tipo]?.categoria
    if (categoria) cuentas[categoria] += 1
  }
  return cuentas
}

// Nombre del tipo de isla de la Agenda que suma una figura del plano base:
// el suyo propio, el del tipo, o ninguno si se marcó sinIsla.
export function islaNombreDeItem(item) {
  if (item.sinIsla) return null
  return item.islaNombre ?? TIPOS_PLANO[item.tipo].islaNombre
}
