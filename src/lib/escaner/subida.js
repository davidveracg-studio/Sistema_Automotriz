import { supabase } from '../../supabaseClient'

export const BUCKET_INSPECCION = 'inspeccion-fotos'

const INTENTOS_MAXIMOS = 4
const ESPERA_BASE_MS = 1000

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

// Reintenta `operacion` con backoff exponencial (1s, 2s, 4s…) mientras falle
// por red. `esDefinitivo(error)` corta los reintentos para errores que no
// se arreglan reintentando (permisos, datos inválidos).
export async function conReintentos(operacion, { intentos = INTENTOS_MAXIMOS, esDefinitivo = () => false } = {}) {
  let ultimoError
  for (let intento = 0; intento < intentos; intento++) {
    try {
      return await operacion()
    } catch (error) {
      ultimoError = error
      if (esDefinitivo(error) || intento === intentos - 1) break
      await esperar(ESPERA_BASE_MS * 2 ** intento)
    }
  }
  throw ultimoError
}

function yaExiste(error) {
  const texto = `${error?.message || ''} ${error?.statusCode || ''} ${error?.error || ''}`
  return /already exists|Duplicate|409/i.test(texto)
}

function esErrorDefinitivo(error) {
  const estado = Number(error?.statusCode || error?.status)
  return estado >= 400 && estado < 500 && estado !== 408 && estado !== 429
}

// Sube una foto y crea su fila. Es idempotente: el id y la ruta se fijan en el
// cliente, así que si el objeto o la fila ya existen por un intento anterior
// que se cortó a medias, se toman como éxito en vez de duplicar.
export async function subirFoto({ foto, trabajo, usuario }) {
  const ruta = `${usuario.empresa_id}/${trabajo.id}/${foto.id}.jpg`

  await conReintentos(
    async () => {
      const { error } = await supabase.storage
        .from(BUCKET_INSPECCION)
        .upload(ruta, foto.blob, { contentType: 'image/jpeg', upsert: false })
      if (error && !yaExiste(error)) throw error
    },
    { esDefinitivo: esErrorDefinitivo }
  )

  await conReintentos(
    async () => {
      const { error } = await supabase.from('inspeccion_fotos').insert({
        id: foto.id,
        empresa_id: usuario.empresa_id,
        trabajo_id: trabajo.id,
        vehiculo_id: trabajo.vehiculo_id,
        zona: foto.zona,
        subzona: foto.subzona || null,
        storage_path: ruta,
        nota: foto.nota || null,
        es_dano: Boolean(foto.esDano),
        origen: foto.origen,
        ancho: foto.ancho,
        alto: foto.alto,
        bytes: foto.blob.size,
        tomada_en: new Date(foto.tomadaEn).toISOString(),
        tomada_por: usuario.id,
      })
      if (error && error.code !== '23505') throw error
    },
    { esDefinitivo: esErrorDefinitivo }
  )
}
