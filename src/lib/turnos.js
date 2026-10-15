// Turnos y asistencia (RRHH): rotación de grupos y lectura del informe de
// eventos del reloj control. Sin acceso a la base de datos: todo lo que se
// puede probar sin red vive acá (mismo criterio que lib/agenda.js, que se
// reutiliza para las fechas). El cálculo "oficial" (turno esperado vs
// marcas, clasificación, horas) vive en SQL (turnos_resumen_diario, 0055);
// este archivo es para leer el archivo importado y para vistas previas
// rápidas.
//
// La lógica de turno esperado, emparejamiento de marcas y clasificación es
// la MISMA que ya usaba el cliente en su consulta Power Query (informe
// "Cumplimiento_Turnos"/"Resumen_Asistencia_Mensual") -se portó tal cual,
// no se rediseñó, para no cambiar en silencio un cálculo que ya se usa para
// pagar horas extra:
//   - "Jornada" del reloj (cuando el archivo la trae) manda por sobre la
//     fecha real de la marca para decidir a qué día de trabajo pertenece
//     -una marca de la madrugada puede pertenecer a la jornada del día
//     anterior-.
//   - Las horas trabajadas son la PRIMERA marca del día menos la ÚLTIMA
//     marca del día (sin importar el tipo ni restar colación): un solo
//     número por jornada, igual que Pares_Entrada_Salida.
//   - Un día con una sola marca (sin su par) es "incompleta", no "normal".
import { diaSemanaDe, lunesDe } from './agenda'

// Semana ancla: lunes 03-08-2026, donde Azul trabajó Lunes-Viernes y Verde
// Martes-Sábado. Confirmada por el cliente (2026-09-27).
const ANCLA_SEMANA = '2026-08-03'

export const GRUPOS_TURNO = {
  azul: 'Azul (rotativo)',
  verde: 'Verde (rotativo)',
  fijo_lv: 'Fijo Lunes-Viernes',
  fijo_ms: 'Fijo Martes-Sábado',
}

// Semanas completas de diferencia entre dos lunes (puede ser negativo).
function semanasEntre(lunesA, lunesB) {
  const dias = Math.round((new Date(`${lunesA}T00:00:00`) - new Date(`${lunesB}T00:00:00`)) / 86400000)
  return dias / 7
}

// Patrón ('lv' | 'ms' | null) que le toca a un grupo en la semana de fechaISO.
export function patronSemana(fechaISO, grupo) {
  if (grupo === 'fijo_lv') return 'lv'
  if (grupo === 'fijo_ms') return 'ms'
  if (grupo !== 'azul' && grupo !== 'verde') return null

  const semanas = semanasEntre(lunesDe(fechaISO), lunesDe(ANCLA_SEMANA))
  const paridad = ((semanas % 2) + 2) % 2
  const patronAncla = grupo === 'azul' ? 'lv' : 'ms'
  if (paridad === 0) return patronAncla
  return patronAncla === 'lv' ? 'ms' : 'lv'
}

// ¿Ese día cae dentro del patrón de la semana? (sin considerar feriado ni
// fecha de salida: eso lo resuelve turnos_resumen_diario, que conoce a la
// persona completa).
export function diaEnPatron(fechaISO, grupo) {
  const patron = patronSemana(fechaISO, grupo)
  const dia = diaSemanaDe(fechaISO) // 0 domingo .. 6 sábado
  if (patron === 'lv') return dia >= 1 && dia <= 5
  if (patron === 'ms') return dia >= 2 && dia <= 6
  return false
}

// "10578358-2" / "10.578.358-2" -> "10578358-2" (mismo criterio que
// normalizar_rut en SQL, más el guión para mostrar).
export function normalizarRut(rut) {
  const limpio = (rut || '').replace(/[^0-9kK]/g, '').toUpperCase()
  if (limpio.length < 2) return limpio
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`
}

const RX_FICHA_FILA = /^FICHA\s*:\s*(.+)$/i
const RX_RUT_FILA = /^RUT\s*:\s*(.+)$/i
const RX_NOMBRE_FILA = /^NOMBRE\s*:\s*(.+)$/i
const RX_FECHA = /^(\d{2})-(\d{2})-(\d{4})$/
const RX_JORNADA = /^(\d{2})\/(\d{2})\/(\d{4})$/

// Nombre "APELLIDO PATERNO  APELLIDO MATERNO  Nombres" -> Título, espacios
// simples (el informe trae doble espacio entre apellidos y nombres).
export function normalizarNombreReloj(nombre) {
  return (nombre || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (letra) => letra.toUpperCase())
}

// Lee el informe de eventos del reloj control (hoja como array de filas,
// como entrega XLSX.utils.sheet_to_json(hoja, { header: 1 })). Devuelve las
// marcas reales (sin las "Anulado": no son una marca real) y, por ficha, el
// rut/nombre que trae el archivo -para poder cruzar o avisar de los que no
// están en la nómina.
//
// Cada marca trae:
//   - fecha_real / hora: fecha y hora TAL COMO ocurrió la marca (columnas
//     FECHA/HORA del reloj).
//   - dia_trabajo: a qué jornada pertenece -la columna JORNADA del reloj
//     cuando viene informada (una marca de madrugada puede pertenecer a la
//     jornada del día anterior), si no la misma fecha_real.
export function leerInformeEventos(filas) {
  const marcas = []
  const personasPorFicha = new Map()
  let periodo = null
  let contexto = null // { ficha, rut, nombre }

  for (const fila of filas) {
    const col1 = String(fila[1] ?? '').trim()
    const col3 = String(fila[3] ?? '').trim()
    const col7 = String(fila[7] ?? '').trim()

    if (!periodo) {
      const celdaPeriodo = fila.find((c) => typeof c === 'string' && c.includes('PERÍODO'))
      if (celdaPeriodo) periodo = celdaPeriodo.replace(/^.*PERÍODO:\s*/i, '').trim()
    }

    const mFicha = col1.match(RX_FICHA_FILA)
    if (mFicha) {
      const ficha = mFicha[1].trim()
      const rut = normalizarRut((col3.match(RX_RUT_FILA) || [])[1] || '')
      const nombre = normalizarNombreReloj((col7.match(RX_NOMBRE_FILA) || [])[1] || '')
      contexto = { ficha, rut, nombre }
      personasPorFicha.set(ficha, contexto)
      continue
    }

    const celdaFecha = String(fila[6] ?? '')
    const tipoBruto = String(fila[8] ?? '').trim().toUpperCase()
    const mFecha = celdaFecha.match(RX_FECHA)
    if (!contexto || !mFecha || (tipoBruto !== 'ENTRADA' && tipoBruto !== 'SALIDA')) continue

    const estado = String(fila[9] ?? '').trim()
    if (estado === 'Anulado') continue // no es una marca real

    const [, dia, mes, anio] = mFecha
    const fechaReal = `${anio}-${mes}-${dia}`

    const celdaJornada = String(fila[3] ?? '').trim()
    const mJornada = celdaJornada.match(RX_JORNADA)
    const diaTrabajo = mJornada ? `${mJornada[3]}-${mJornada[2]}-${mJornada[1]}` : fechaReal

    marcas.push({
      ficha: contexto.ficha,
      rut: contexto.rut,
      nombre: contexto.nombre,
      fecha_real: fechaReal,
      dia_trabajo: diaTrabajo,
      hora: String(fila[7] ?? '').trim(),
      tipo: tipoBruto === 'ENTRADA' ? 'entrada' : 'salida',
      estado_reloj: estado || null,
    })
  }

  return { periodo, marcas, personas: [...personasPorFicha.values()] }
}
