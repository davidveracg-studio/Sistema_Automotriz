import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PALABRAS_CLAVE_NO_COLUMNA = new Set([
  'constraint',
  'check',
  'primary',
  'unique',
  'foreign',
  'exclude',
  'like',
])

function leerMigracionesConcatenadas(directorioMigraciones) {
  const archivos = readdirSync(directorioMigraciones)
    .filter((nombre) => nombre.endsWith('.sql'))
    .sort()

  return archivos.map((nombre) => readFileSync(join(directorioMigraciones, nombre), 'utf8')).join('\n')
}

// Divide por comas respetando el anidamiento de (), [] y {}, para no cortar
// en medio de un `check (a in (1, 2, 3))`.
function dividirPorComasDeNivelSuperior(texto) {
  const partes = []
  let profundidad = 0
  let actual = ''
  for (const caracter of texto) {
    if ('([{'.includes(caracter)) profundidad++
    if (')]}'.includes(caracter)) profundidad--
    if (caracter === ',' && profundidad === 0) {
      partes.push(actual)
      actual = ''
    } else {
      actual += caracter
    }
  }
  if (actual.trim()) partes.push(actual)
  return partes
}

function extraerColumnasDeCuerpo(cuerpo) {
  const columnas = []
  for (const parteCruda of dividirPorComasDeNivelSuperior(cuerpo)) {
    const parte = parteCruda.trim()
    if (!parte) continue
    const primerToken = parte.split(/\s+/)[0].replace(/"/g, '').toLowerCase()
    if (PALABRAS_CLAVE_NO_COLUMNA.has(primerToken)) continue
    columnas.push(primerToken)
  }
  return columnas
}

function agregarColumnas(tablas, nombreTabla, columnas) {
  if (!tablas.has(nombreTabla)) tablas.set(nombreTabla, new Set())
  for (const columna of columnas) tablas.get(nombreTabla).add(columna)
}

function extraerCreateTable(sqlTexto, tablas) {
  const regexInicio = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(/gi
  let coincidencia
  while ((coincidencia = regexInicio.exec(sqlTexto))) {
    const nombreTabla = coincidencia[1].toLowerCase()
    let profundidad = 1
    let i = regexInicio.lastIndex
    while (i < sqlTexto.length && profundidad > 0) {
      if (sqlTexto[i] === '(') profundidad++
      else if (sqlTexto[i] === ')') profundidad--
      i++
    }
    const cuerpo = sqlTexto.slice(regexInicio.lastIndex, i - 1)
    agregarColumnas(tablas, nombreTabla, extraerColumnasDeCuerpo(cuerpo))
    regexInicio.lastIndex = i
  }
}

function extraerAlterTableAddColumn(sqlTexto, tablas) {
  const regex = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi
  let coincidencia
  while ((coincidencia = regex.exec(sqlTexto))) {
    const [, tabla, columna] = coincidencia
    agregarColumnas(tablas, tabla.toLowerCase(), [columna.toLowerCase()])
  }
}

// Devuelve Map<nombreTabla, Set<columnas>> construido a partir de todas las
// migraciones (CREATE TABLE + ALTER TABLE ... ADD COLUMN), en orden.
export function extraerEsquema(directorioMigraciones) {
  const sqlTexto = leerMigracionesConcatenadas(directorioMigraciones)
  const tablas = new Map()
  extraerCreateTable(sqlTexto, tablas)
  extraerAlterTableAddColumn(sqlTexto, tablas)
  return tablas
}

export function listarArchivos(dir, extensiones, acc = []) {
  let entradas
  try {
    entradas = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entrada of entradas) {
    if (entrada.name === 'node_modules' || entrada.name === 'dist') continue
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) listarArchivos(ruta, extensiones, acc)
    else if (extensiones.some((ext) => ruta.endsWith(ext))) acc.push(ruta)
  }
  return acc
}
