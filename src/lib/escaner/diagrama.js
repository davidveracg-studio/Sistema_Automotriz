// Puente entre el escáner y el diagrama de daños del ingreso.
//
// Cada foto marcada como "daño" en el escáner (zona exterior) genera una marca
// SUGERIDA en la vista del diagrama que se estaba escaneando, con la foto
// vinculada. El escáner sabe qué cara del vehículo se estaba recorriendo, pero
// no en qué punto exacto está el daño: la marca nace `pendiente` (en el centro
// de la vista) y la persona debe ubicarla o confirmarla antes de registrar el
// ingreso, porque el diagrama forma parte del documento que firma el cliente.
//
// Forma de una marca: { vista, x, y, nota, pieza?, fotos?: [fotoId], pendiente?, notaDeFoto? }
// `fotos` se guarda en la base (inspecciones_ingreso.diagrama_danos); `pendiente`
// y `notaDeFoto` son solo de la pantalla y se quitan con `limpiarMarcas`.

import { vistaDeLado } from '../diagramaZonas.js'

// Zona del escáner -> vista del diagrama. Para los costados se indica el LADO
// REAL del vehículo ('izq' | 'der'): qué dibujo muestra ese lado depende del
// tipo de carrocería (ver LADO_DE_VISTA en diagramaZonas.js).
const VISTA_POR_SUBZONA = {
  frontal: 'frontal',
  trasera: 'posterior',
  techo: 'superior',
  vidrios: 'frontal',
}
const LADO_POR_SUBZONA = {
  lateral_izq: 'izq',
  esquina_del_izq: 'izq',
  esquina_tra_izq: 'izq',
  llantas: 'izq',
  lateral_der: 'der',
  esquina_del_der: 'der',
  esquina_tra_der: 'der',
}

// Vista del diagrama que corresponde a una foto, o null si no aplica (las fotos
// del interior no tienen lugar en el diagrama exterior).
export function vistaDeFoto(foto, tipo = 'sedan') {
  if (foto.zona !== 'exterior') return null
  if (VISTA_POR_SUBZONA[foto.subzona]) return VISTA_POR_SUBZONA[foto.subzona]
  const lado = LADO_POR_SUBZONA[foto.subzona]
  return lado ? vistaDeLado(tipo, lado) : null
}

// Devuelve las marcas puestas al día con las fotos del escáner. Si nada cambia
// devuelve la MISMA lista (misma referencia), para poder usarla dentro de un
// setState sin provocar renders en bucle. `ignoradas` (Set de ids de foto) son
// las fotos cuya sugerencia la persona quitó a propósito: no se vuelven a crear.
export function sincronizarMarcasConFotos(marcas, fotos, ignoradas = new Set(), tipo = 'sedan') {
  const porId = new Map(fotos.map((foto) => [foto.id, foto]))
  const resultado = []
  let cambio = false

  for (const marca of marcas) {
    if (!marca.fotos || marca.fotos.length === 0) {
      resultado.push(marca)
      continue
    }
    // Una foto sigue vinculada solo mientras exista y siga marcada como daño.
    const vigentes = marca.fotos.filter((id) => porId.get(id)?.esDano)
    if (vigentes.length < marca.fotos.length) {
      cambio = true
      // Una sugerencia sin confirmar cuya foto ya no es un daño se retira.
      if (vigentes.length === 0 && marca.pendiente) continue
      resultado.push({ ...marca, fotos: vigentes })
      continue
    }
    // Mientras la marca esté pendiente, su nota sigue a la nota de la foto.
    if (marca.pendiente && marca.notaDeFoto && vigentes.length === 1) {
      const nota = porId.get(vigentes[0]).nota || ''
      if (nota !== marca.nota) {
        cambio = true
        resultado.push({ ...marca, nota })
        continue
      }
    }
    resultado.push(marca)
  }

  const referenciadas = new Set(resultado.flatMap((marca) => marca.fotos || []))
  for (const foto of fotos) {
    const vista = vistaDeFoto(foto, tipo)
    if (!foto.esDano || !vista || referenciadas.has(foto.id) || ignoradas.has(foto.id)) continue
    cambio = true
    resultado.push({ vista, x: 0.5, y: 0.5, nota: foto.nota || '', fotos: [foto.id], pendiente: true, notaDeFoto: true })
  }

  return cambio ? resultado : marcas
}

export function contarPendientes(marcas) {
  return marcas.filter((marca) => marca.pendiente).length
}

// Marcas listas para guardar en la base: sin los campos que son solo de pantalla.
export function limpiarMarcas(marcas) {
  return marcas.map((marca) => {
    const copia = { ...marca }
    delete copia.pendiente
    delete copia.notaDeFoto
    if (!copia.fotos || copia.fotos.length === 0) delete copia.fotos
    return copia
  })
}
