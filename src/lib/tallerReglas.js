// Reglas del kanban del taller: en qué puestos del plano puede estar un
// vehículo según el estado de su tarjeta en ClickUp, y cómo se calculan los
// datos de la tarjeta (progreso, prioridad, fecha). Sin acceso a la base ni a
// React: se puede probar suelto (mismo criterio que lib/plano.js).
//
// Las reglas de ubicación son las que dictó el cliente (2026-09-28):
//   por designar                       -> Ingreso 1 o Ingreso 2
//   en reparación                      -> elevadores o puestos 1 a 6
//   reparación servicio externo        -> puestos 1 a 6 o pulmón
//   compra reptos (Victor)             -> puestos 1 a 6 o pulmón
//   espera reptos (Cliente)            -> pulmón
//   pintura/desabolladura, lavado,
//   alineación                         -> su propio puesto
//   listo para entrega                 -> pulmón o ingresos
//   subtarea de vulcanización activa
//   (rotación o balanceo)              -> puesto 7 (manda por sobre el estado)
// Cualquier otro estado (agenda, prueba en ruta, retroceso...) no tiene regla:
// el vehículo puede estar donde esté.

// Minúsculas, sin tildes ni espacios de más: "Reparación Servicio Externo" -> "reparacion servicio externo".
export function claveEstado(nombre) {
  return (nombre || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Categorías de figura del plano (por tipo y nombre, no por id: el plano se edita).
export const CATEGORIAS_UBICACION = {
  ingreso: { etiqueta: 'Ingreso', es: (e) => e.tipo === 'recepcion_ingreso' },
  elevador: { etiqueta: 'Elevador', es: (e) => e.tipo === 'isla_elevador' },
  puesto16: { etiqueta: 'Puestos 1 a 6', es: (e) => e.tipo === 'isla_simple' && /^puesto\s*[1-6]$/i.test(e.nombre || '') },
  puesto7: { etiqueta: 'Puesto 7', es: (e) => e.tipo === 'isla_simple' && /^puesto\s*7$/i.test(e.nombre || '') },
  pulmon: { etiqueta: 'Pulmón', es: (e) => e.tipo === 'pulmon' },
  pintura: { etiqueta: 'Pintura', es: (e) => e.tipo === 'desabolladura_pintura' },
  lavado: { etiqueta: 'Lavado', es: (e) => e.tipo === 'lavado' },
  alineadora: { etiqueta: 'Alineación', es: (e) => e.tipo === 'alineadora' },
}

const REGLAS_POR_ESTADO = [
  { coincide: (k) => k === 'por designar', categorias: ['ingreso'], texto: 'Ingreso 1 o Ingreso 2' },
  { coincide: (k) => k === 'en reparacion', categorias: ['elevador', 'puesto16'], texto: 'un elevador o los puestos 1 a 6' },
  { coincide: (k) => k.startsWith('reparacion servicio externo'), categorias: ['puesto16', 'pulmon'], texto: 'los puestos 1 a 6 o un pulmón' },
  { coincide: (k) => k.startsWith('compra reptos'), categorias: ['puesto16', 'pulmon'], texto: 'los puestos 1 a 6 o un pulmón' },
  { coincide: (k) => k.startsWith('espera reptos'), categorias: ['pulmon'], texto: 'un pulmón' },
  { coincide: (k) => k.startsWith('pintura'), categorias: ['pintura'], texto: 'el puesto de pintura/desabolladura' },
  { coincide: (k) => k === 'lavado', categorias: ['lavado'], texto: 'el puesto de lavado' },
  { coincide: (k) => k.startsWith('alineacion'), categorias: ['alineadora'], texto: 'el puesto de alineación' },
  { coincide: (k) => k === 'listo para entrega', categorias: ['pulmon', 'ingreso'], texto: 'un pulmón o un ingreso' },
]

// Una subtarea de rotación/balanceo/vulcanización que ya está en marcha (no
// terminada ni todavía por agendar/designar). "Alineación y balanceo" es de
// la alineadora, no de vulcanización: se excluye por nombre.
const RX_VULCANIZACION = /vulcaniz|rotaci[oó]n|balanceo/i
const ESTADOS_SIN_INICIAR = new Set(['agenda', 'por designar'])

export function tieneVulcanizacionActiva(subtareas) {
  return (subtareas || []).some((s) => {
    const descripcion = s.descripcion || ''
    return (
      RX_VULCANIZACION.test(descripcion) &&
      !/alinea/i.test(descripcion.normalize('NFD').replace(/[̀-ͯ]/g, '')) &&
      !s.completada &&
      !ESTADOS_SIN_INICIAR.has(claveEstado(s.estado))
    )
  })
}

// Regla que aplica a una OT ahora: { categorias, texto, motivo } o null si no tiene.
export function reglaDeUbicacion({ estado, subtareas }) {
  if (tieneVulcanizacionActiva(subtareas)) {
    return { categorias: ['puesto7'], texto: 'el puesto 7 (vulcanización)', motivo: 'vulcanizacion' }
  }
  const clave = claveEstado(estado)
  const regla = REGLAS_POR_ESTADO.find((r) => r.coincide(clave))
  return regla ? { categorias: regla.categorias, texto: regla.texto, motivo: 'estado' } : null
}

// Figuras del plano donde SÍ puede estar el vehículo según la regla (todas si no hay regla).
export function elementosPermitidos(regla, elementos) {
  if (!regla) return elementos
  return elementos.filter((e) => regla.categorias.some((c) => CATEGORIAS_UBICACION[c].es(e)))
}

// 'ok' (cumple o no hay regla) | 'sin_ubicar' (la regla pide un puesto y no tiene) | 'incorrecta' (está donde no debe).
export function estadoUbicacion(regla, elementoActual) {
  if (!regla) return 'ok'
  if (!elementoActual) return 'sin_ubicar'
  return regla.categorias.some((c) => CATEGORIAS_UBICACION[c].es(elementoActual)) ? 'ok' : 'incorrecta'
}

// Orden de las columnas cuando ClickUp no informa el orden de sus estados.
const ORDEN_BASE = [
  'agenda',
  'por designar',
  'en reparacion',
  'reparacion servicio externo',
  'compra reptos',
  'espera reptos',
  'pintura',
  'lavado',
  'alineacion',
  'prueba en ruta',
  'listo para entrega',
  'retroceso',
]

export function posicionBase(nombre) {
  const clave = claveEstado(nombre)
  const indice = ORDEN_BASE.findIndex((base) => clave.startsWith(base))
  return indice === -1 ? ORDEN_BASE.length : indice
}

// Avance de una OT según sus subtareas de ClickUp (mismo criterio que el contador de ClickUp: terminadas / total).
export function progresoSubtareas(subtareas) {
  const total = (subtareas || []).length
  const hechas = (subtareas || []).filter((s) => s.completada).length
  return { total, hechas, porcentaje: total === 0 ? 0 : Math.round((hechas / total) * 100) }
}

// Mismos nombres que usa clickup-sincronizar/clickup-webhook para los
// checklists de cada área (supabase/functions/_shared/clickup.ts) -no se
// puede importar ese archivo desde el frontend (corre en Deno), así que se
// repite acá a propósito.
export const NOMBRE_CHECKLIST_POR_AREA = {
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes e insumos',
  servicios_externos: 'Servicios Rápidos',
}

export const PRIORIDADES = {
  urgent: { etiqueta: 'Urgente', clases: 'bg-red-100 text-red-800 ring-red-200' },
  high: { etiqueta: 'Alta', clases: 'bg-amber-100 text-amber-800 ring-amber-200' },
  normal: { etiqueta: 'Normal', clases: 'bg-sky-100 text-sky-800 ring-sky-200' },
  low: { etiqueta: 'Baja', clases: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

const ZONA = 'America/Santiago'

// "27-09 10:30" (con hora) o "27-09" (sin hora), en hora de Chile.
export function formatoProgramada(iso, conHora) {
  if (!iso) return null
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('es-CL', {
      timeZone: ZONA,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((parte) => [parte.type, parte.value])
  )
  const dos = (valor) => String(valor).padStart(2, '0')
  const dia = `${dos(partes.day)}-${dos(partes.month)}`
  return conHora ? `${dia} ${partes.hour === '24' ? '00' : dos(partes.hour)}:${dos(partes.minute)}` : dia
}

// Vencida: pasó la fecha (con hora) o pasó el día completo (sin hora).
export function estaVencida(iso, conHora, ahora = new Date()) {
  if (!iso) return false
  const limite = new Date(iso)
  if (!conHora) limite.setHours(23, 59, 59, 999)
  return limite < ahora
}

// Iniciales para el avatar: "Pablo Donoso" -> "PD".
export function iniciales(nombre) {
  const partes = (nombre || '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}
