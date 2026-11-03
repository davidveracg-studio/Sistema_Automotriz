// Categorías de datos con plazo de conservación configurable por cada taller
// (ver migración 0074). El taller es el responsable de sus datos: el plazo lo
// define él con su asesoría legal. Los "sugeridos" son una referencia técnica
// para bitácoras, no un criterio legal.

export const CATEGORIAS = [
  {
    clave: 'uso_eventos',
    etiqueta: 'Bitácora de uso',
    queBorra: 'Registros de inicio de sesión, pantallas visitadas y errores del navegador de las personas usuarias.',
    sugerido: 365,
    nota: 'Alimenta el Monitor de plataforma: los indicadores históricos pierden detalle más allá del plazo.',
  },
  {
    clave: 'notificaciones',
    etiqueta: 'Notificaciones internas',
    queBorra: 'Avisos dentro de la app (presupuesto pendiente, cita nueva, listo para entrega…) y su estado de lectura.',
    sugerido: 180,
    nota: null,
  },
  {
    clave: 'whatsapp_mensajes',
    etiqueta: 'Mensajes de WhatsApp',
    queBorra: 'El contenido de los mensajes entrantes y salientes con clientes. No borra los contactos ni las fichas de cliente.',
    sugerido: null,
    nota: 'Sin plazo de referencia: depende del uso que el taller dé al historial. Definirlo con asesoría legal.',
  },
  {
    clave: 'errores_integracion',
    etiqueta: 'Errores de integraciones',
    queBorra: 'Registros de errores al enviar correos (Brevo) o al sincronizar con ClickUp.',
    sugerido: 90,
    nota: null,
  },
]

export const ETIQUETA_CATEGORIA = {
  ...Object.fromEntries(CATEGORIAS.map((categoria) => [categoria.clave, categoria.etiqueta])),
  accesos_fallidos: 'Intentos de ingreso rechazados (plataforma)',
  errores_brevo_sin_empresa: 'Errores de correo sin empresa (plataforma)',
}

export const DIAS_MINIMOS = 30
export const DIAS_MAXIMOS = 3650

export function plazoValido(dias) {
  const numero = Number(dias)
  return Number.isInteger(numero) && numero >= DIAS_MINIMOS && numero <= DIAS_MAXIMOS
}

export function describirDias(dias) {
  const numero = Number(dias)
  if (!Number.isFinite(numero) || numero <= 0) return ''
  if (numero % 365 === 0) {
    const anios = numero / 365
    return `${anios} ${anios === 1 ? 'año' : 'años'}`
  }
  if (numero % 30 === 0) return `${numero / 30} meses`
  return `${numero} días`
}
