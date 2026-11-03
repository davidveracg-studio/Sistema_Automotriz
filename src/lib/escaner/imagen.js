// Utilidades de imagen en el navegador: compresión a JPEG y borrador local
// (IndexedDB) de las fotos ya comprimidas. El video nunca pasa por aquí.

// Dibuja una fuente (video, imagen o bitmap) en un canvas con lado máximo
// acotado y la devuelve como Blob JPEG.
export function comprimirAJpeg(fuente, anchoOrigen, altoOrigen, { ladoMaximo, calidad }) {
  const escala = Math.min(1, ladoMaximo / Math.max(anchoOrigen, altoOrigen))
  const ancho = Math.max(1, Math.round(anchoOrigen * escala))
  const alto = Math.max(1, Math.round(altoOrigen * escala))
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  lienzo.getContext('2d').drawImage(fuente, 0, 0, ancho, alto)
  return new Promise((resolver, rechazar) => {
    lienzo.toBlob(
      (blob) => (blob ? resolver({ blob, ancho, alto }) : rechazar(new Error('No se pudo comprimir la imagen.'))),
      'image/jpeg',
      calidad
    )
  })
}

// Comprime un archivo elegido a mano (input file con capture o galería).
export async function comprimirArchivo(archivo, opciones) {
  const bitmap = await createImageBitmap(archivo)
  try {
    return await comprimirAJpeg(bitmap, bitmap.width, bitmap.height, opciones)
  } finally {
    bitmap.close?.()
  }
}

// --- Borrador local ---------------------------------------------------------
// Guarda las fotos ya capturadas (Blob JPEG comprimido + metadatos) por OT, para
// no perderlas si se recarga la página o se cae la conexión antes de subir.

const BD = 'escaner-inspeccion'
const ALMACEN = 'borradores'

function abrirBd() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BD, 1)
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN)
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error)
  })
}

async function conAlmacen(modo, operacion) {
  const bd = await abrirBd()
  try {
    return await new Promise((resolver, rechazar) => {
      const tx = bd.transaction(ALMACEN, modo)
      const resultado = operacion(tx.objectStore(ALMACEN))
      tx.oncomplete = () => resolver(resultado?.result)
      tx.onerror = () => rechazar(tx.error)
      tx.onabort = () => rechazar(tx.error)
    })
  } finally {
    bd.close()
  }
}

// Todas son "mejor esfuerzo": si IndexedDB no está disponible (modo privado),
// el escáner sigue funcionando sin borrador.
export async function guardarBorrador(trabajoId, fotos) {
  try {
    await conAlmacen('readwrite', (almacen) => almacen.put(fotos, trabajoId))
  } catch {
    /* sin borrador */
  }
}

export async function cargarBorrador(trabajoId) {
  try {
    return (await conAlmacen('readonly', (almacen) => almacen.get(trabajoId))) || []
  } catch {
    return []
  }
}

export async function borrarBorrador(trabajoId) {
  try {
    await conAlmacen('readwrite', (almacen) => almacen.delete(trabajoId))
  } catch {
    /* sin borrador */
  }
}
