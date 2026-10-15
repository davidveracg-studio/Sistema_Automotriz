// Personal del taller para la Agenda: arma la estructura que usa lib/agenda.js
// (cuposEnBloque) a partir de las filas de personal_taller, personal_habilidades,
// personal_horarios y personal_ausencias (0048_agenda_por_personal.sql).
// Sin acceso a la base de datos: solo transforma filas.

export const MOTIVOS_AUSENCIA = ['Vacaciones', 'Licencia médica', 'Permiso', 'Otro']

export const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
// La semana chilena parte el lunes.
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]

export function armarPersonal({ personas, habilidades, horarios, ausencias }) {
  return {
    personas: (personas || [])
      .filter((persona) => persona.activo)
      .map((persona) => ({
        id: persona.id,
        nombre: persona.nombre,
        cargo: persona.cargo,
        islas: (habilidades || []).filter((h) => h.personal_id === persona.id).map((h) => h.tipo_isla_id),
        horarios: (horarios || []).filter((h) => h.personal_id === persona.id),
        ausencias: (ausencias || []).filter((a) => a.personal_id === persona.id),
      })),
  }
}

// "08:30:00" -> "08:30" (los campos time de la base traen segundos).
export function horaCorta(hora) {
  return hora ? hora.slice(0, 5) : ''
}

export function resumenHorario(horarios) {
  if (!horarios || horarios.length === 0) return 'Horario de atención del taller'
  return ORDEN_DIAS.map((dia) => horarios.find((h) => h.dia_semana === dia))
    .filter(Boolean)
    .map((h) => `${NOMBRES_DIA[h.dia_semana].slice(0, 3)} ${horaCorta(h.hora_inicio)}–${horaCorta(h.hora_fin)}`)
    .join(' · ')
}

export function resumenAusencia(ausencia) {
  const rango = ausencia.desde === ausencia.hasta ? ausencia.desde : `${ausencia.desde} al ${ausencia.hasta}`
  const horas = ausencia.hora_desde ? ` de ${horaCorta(ausencia.hora_desde)} a ${horaCorta(ausencia.hora_hasta)}` : ''
  return `${rango}${horas}`
}
