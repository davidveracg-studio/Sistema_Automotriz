// Verificación 5: catálogos de objetos renderizados como texto. Un
// `arreglo.map(item => <li>{item}</li>)` compila sin problema y en el
// navegador se ve "[object Object]" si `item` en realidad es un objeto.
//
// Heurística: si dentro del mismo callback de .map(param => ...) el código
// también accede a `param.algo` (evidencia de que param es un objeto) Y
// además hay un `{param}` suelto (sin propiedad) dentro de JSX, es casi
// seguro que ese `{param}` debía ser `{param.algo}`.
import { readFileSync } from 'node:fs'
import { listarArchivos } from './lib/esquemaSql.mjs'

const DIRECTORIO_FRONTEND = 'src'

function encontrarCierreDeBloque(codigo, inicio, caracterApertura, caracterCierre) {
  let profundidad = 1
  let i = inicio
  while (i < codigo.length && profundidad > 0) {
    if (codigo[i] === caracterApertura) profundidad++
    else if (codigo[i] === caracterCierre) profundidad--
    i++
  }
  return i
}

function extraerCuerposDeMap(codigo) {
  const cuerpos = []
  const regexMap = /\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*/g
  let coincidencia
  while ((coincidencia = regexMap.exec(codigo))) {
    const param = coincidencia[1]
    const inicioCuerpo = regexMap.lastIndex
    let fin

    if (codigo[inicioCuerpo] === '{') {
      fin = encontrarCierreDeBloque(codigo, inicioCuerpo + 1, '{', '}')
    } else if (codigo[inicioCuerpo] === '(') {
      fin = encontrarCierreDeBloque(codigo, inicioCuerpo + 1, '(', ')')
    } else {
      // Retorno implícito sin paréntesis: cortamos en el `.map(` que cierra,
      // usando profundidad de paréntesis desde el `.map(` mismo.
      const inicioLlamada = codigo.lastIndexOf('(', coincidencia.index + coincidencia[0].length)
      fin = encontrarCierreDeBloque(codigo, inicioLlamada + 1, '(', ')')
    }

    const numeroLinea = codigo.slice(0, inicioCuerpo).split('\n').length
    cuerpos.push({ param, cuerpo: codigo.slice(inicioCuerpo, fin), numeroLinea })
  }
  return cuerpos
}

function esSospechoso({ param, cuerpo }) {
  const coincidenciaPropiedad = new RegExp(`\\b${param}\\.([A-Za-z_$][\\w$]*)`).exec(cuerpo)
  const renderizaSuelto = new RegExp(`\\{\\s*${param}\\s*\\}`).test(cuerpo)
  if (!coincidenciaPropiedad || !renderizaSuelto) return null
  return coincidenciaPropiedad[1]
}

function main() {
  const archivos = listarArchivos(DIRECTORIO_FRONTEND, ['.jsx'])
  const avisos = []

  for (const archivo of archivos) {
    const codigo = readFileSync(archivo, 'utf8')
    for (const bloque of extraerCuerposDeMap(codigo)) {
      const propiedad = esSospechoso(bloque)
      if (propiedad) {
        avisos.push(
          `${archivo}:${bloque.numeroLinea}: el callback de .map usa "${bloque.param}.${propiedad}" en algún punto pero también renderiza "{${bloque.param}}" suelto — revisa si falta la propiedad.`
        )
      }
    }
  }

  if (avisos.length > 0) {
    console.error('✗ Verificación de catálogos como texto falló:\n')
    for (const aviso of avisos) console.error(`  - ${aviso}`)
    process.exit(1)
  }

  console.log('✓ Verificación de catálogos como texto: sin renders sospechosos de objetos como string.')
}

main()
