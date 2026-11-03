import { invocarFuncion } from './invocarFuncion'

const FOTOS_POR_LLAMADA = 8

// Pide a la Edge Function que analice las fotos indicadas, en lotes. Los lotes
// se arman acá (con ids explícitos) para que una foto que falla no se vuelva a
// pedir una y otra vez dentro de la misma corrida. `alProgresar` recibe
// { hechas, total } después de cada lote.
export async function analizarFotos(trabajoId, fotoIds, alProgresar) {
  let analizadas = 0
  const errores = []
  for (let i = 0; i < fotoIds.length; i += FOTOS_POR_LLAMADA) {
    const lote = fotoIds.slice(i, i + FOTOS_POR_LLAMADA)
    const resultado = await invocarFuncion('analizar-inspeccion', {
      body: { trabajo_id: trabajoId, foto_ids: lote },
    })
    analizadas += resultado.analizadas || 0
    errores.push(...(resultado.errores || []))
    alProgresar?.({ hechas: Math.min(i + lote.length, fotoIds.length), total: fotoIds.length })
  }
  return { analizadas, errores }
}
