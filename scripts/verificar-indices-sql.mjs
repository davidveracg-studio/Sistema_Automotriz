// Verificación 6: índices SQL sobre columnas inexistentes. Postgres solo lo
// detecta al ejecutar la migración; esto lo detecta antes, comparando cada
// CREATE INDEX contra las columnas reales de la tabla (según las mismas
// migraciones).
import { extraerEsquema } from './lib/esquemaSql.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readdirSync } from 'node:fs'

const DIRECTORIO_MIGRACIONES = 'supabase/migrations'

const PALABRAS_NO_COLUMNA = new Set([
  'asc', 'desc', 'nulls', 'first', 'last', 'where', 'using', 'btree', 'gin', 'gist', 'hash',
  'lower', 'upper', 'coalesce', 'trim', 'concat', 'now', 'true', 'false', 'and', 'or', 'not',
  'is', 'null', 'in', 'like', 'ilike',
])

function leerMigracionesConcatenadas() {
  const archivos = readdirSync(DIRECTORIO_MIGRACIONES)
    .filter((nombre) => nombre.endsWith('.sql'))
    .sort()
  return archivos.map((nombre) => readFileSync(join(DIRECTORIO_MIGRACIONES, nombre), 'utf8')).join('\n')
}

function extraerIndices(sqlTexto) {
  const indices = []
  const regex = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\w+\s+on\s+(?:only\s+)?(?:public\.)?(\w+)\s*\(([^)]*)\)/gis
  let coincidencia
  while ((coincidencia = regex.exec(sqlTexto))) {
    const [, tabla, listaColumnas] = coincidencia
    indices.push({ tabla: tabla.toLowerCase(), listaColumnas })
  }
  return indices
}

function extraerIdentificadoresCandidatos(listaColumnas) {
  const tokens = listaColumnas.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  return tokens
    .map((token) => token.toLowerCase())
    .filter((token) => !PALABRAS_NO_COLUMNA.has(token))
}

function main() {
  const esquema = extraerEsquema(DIRECTORIO_MIGRACIONES)
  const sqlTexto = leerMigracionesConcatenadas()
  const errores = []

  for (const { tabla, listaColumnas } of extraerIndices(sqlTexto)) {
    const columnasConocidas = esquema.get(tabla)
    if (!columnasConocidas) {
      errores.push(`Índice sobre la tabla "${tabla}", que no aparece en ningún CREATE TABLE de las migraciones.`)
      continue
    }
    for (const identificador of extraerIdentificadoresCandidatos(listaColumnas)) {
      if (!columnasConocidas.has(identificador)) {
        errores.push(`Índice sobre "${tabla}(${listaColumnas.trim()})" referencia "${identificador}", que no es una columna de "${tabla}".`)
      }
    }
  }

  if (errores.length > 0) {
    console.error('✗ Verificación de índices SQL falló:\n')
    for (const error of errores) console.error(`  - ${error}`)
    process.exit(1)
  }

  console.log('✓ Verificación de índices SQL: todos los índices referencian columnas existentes.')
}

main()
