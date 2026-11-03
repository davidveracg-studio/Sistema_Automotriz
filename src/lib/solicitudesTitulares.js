import { supabase } from '../supabaseClient'

// Derechos de los titulares de datos personales (Ley 21.719, que reemplaza el
// texto de la Ley 19.628). Las guías salen del texto de la ley (art. 5 a 11);
// son un recordatorio para quien responde, no asesoría legal: los casos
// dudosos se validan con un abogado.

export const TIPOS = {
  acceso: {
    etiqueta: 'Acceso',
    articulo: 'art. 5',
    verificar: [
      'Confirmar si se tratan datos de la persona y, si es así, entregarlos junto con su origen.',
      'Informar las finalidades, las categorías de destinatarios (o su identidad, si la persona lo pide) y el período de tratamiento.',
      'Si el tratamiento se basa en interés legítimo, indicar cuál; si hay decisiones automatizadas, explicar la lógica.',
      'Es gratuito al menos una vez por trimestre; después solo se pueden cobrar costos directos.',
    ],
  },
  rectificacion: {
    etiqueta: 'Rectificación',
    articulo: 'art. 6',
    verificar: [
      'Corregir los datos inexactos, desactualizados o incompletos.',
      'Comunicar la rectificación a quienes se hayan cedido los datos, salvo que sea imposible o desproporcionado.',
      'Es siempre gratuita.',
    ],
  },
  supresion: {
    etiqueta: 'Supresión',
    articulo: 'art. 7',
    verificar: [
      'Procede si los datos ya no son necesarios, se retiró el consentimiento, se trataron ilícitamente, están caducos, hay una obligación legal o sentencia, o se ejerció la oposición.',
      'No procede si el tratamiento es necesario para cumplir una obligación legal o ejecutar un contrato, para defender reclamaciones, o por otras excepciones del art. 7.',
      'Confirmar con un abogado qué documentos deben conservarse (tributarios, garantías, laborales) antes de eliminar.',
      'Es siempre gratuita.',
    ],
  },
  oposicion: {
    etiqueta: 'Oposición',
    articulo: 'art. 8',
    verificar: [
      'Si la base es el interés legítimo, se debe dejar de tratar salvo motivos legítimos imperiosos que prevalezcan o para defender reclamaciones.',
      'Si es marketing directo, se debe dejar de tratar siempre.',
      'Si los datos vienen de una fuente de acceso público y no hay otra base, procede.',
      'Es siempre gratuita.',
    ],
  },
  portabilidad: {
    etiqueta: 'Portabilidad',
    articulo: 'art. 9',
    verificar: [
      'Solo para datos que la persona entregó, tratados de forma automatizada y basados en su consentimiento.',
      'Entregar una copia en formato electrónico estructurado y de uso común; si es posible, enviarla directo al otro responsable.',
      'Explicar de forma clara cómo obtener los datos.',
    ],
  },
  bloqueo: {
    etiqueta: 'Bloqueo',
    articulo: 'art. 8 ter',
    verificar: [
      'Suspender temporalmente cualquier operación de tratamiento; no afecta al almacenamiento.',
      'Puede ejercerse mientras se resuelve una rectificación, supresión u oposición, o como alternativa a la supresión.',
    ],
  },
}

export const TIPOS_CON_BLOQUEO = ['rectificacion', 'supresion', 'oposicion']
export const TIPOS_CON_CAUSAL = ['supresion', 'oposicion']

export const ESTADOS = {
  recibida: 'Recibida',
  en_proceso: 'En proceso',
  respondida: 'Respondida',
  rechazada: 'Rechazada',
}

export const CANALES = {
  correo: 'Correo electrónico',
  formulario: 'Formulario',
  presencial: 'Presencial',
  telefono: 'Teléfono',
  otro: 'Otro',
}

export const ESTADOS_ABIERTOS = ['recibida', 'en_proceso']

export const AVISO_RECLAMO =
  'Usted dispone de 30 días hábiles, contados desde esta comunicación, para presentar un reclamo ante la Agencia de Protección de Datos Personales.'

// 'YYYY-MM-DD' se interpreta como fecha local (no UTC) para no correr un día.
export function fechaLocal(texto) {
  if (!texto) return null
  const [anio, mes, dia] = texto.slice(0, 10).split('-').map(Number)
  return new Date(anio, mes - 1, dia)
}

export function hoyIso() {
  const ahora = new Date()
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
}

export function formatoFecha(texto) {
  const fecha = fechaLocal(texto)
  if (!fecha) return '—'
  return `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`
}

export function diasHasta(texto) {
  const fecha = fechaLocal(texto)
  if (!fecha) return null
  const hoy = fechaLocal(hoyIso())
  return Math.round((fecha - hoy) / 86400000)
}

// Etiqueta y color del plazo de una solicitud abierta.
export function describirPlazo(texto) {
  const dias = diasHasta(texto)
  if (dias === null) return { texto: '—', clase: 'text-slate-400' }
  if (dias < 0) return { texto: `Vencida hace ${-dias} ${dias === -1 ? 'día' : 'días'}`, clase: 'bg-red-100 text-red-700' }
  if (dias === 0) return { texto: 'Vence hoy', clase: 'bg-red-100 text-red-700' }
  if (dias <= 5) return { texto: `${dias} ${dias === 1 ? 'día' : 'días'}`, clase: 'bg-amber-100 text-amber-800' }
  return { texto: `${dias} días`, clase: 'bg-slate-100 text-slate-600' }
}

export function codigoSolicitud(numero) {
  return `SD-${String(numero).padStart(4, '0')}`
}

async function leer(consulta) {
  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  return data ?? []
}

// Reúne los datos personales de un cliente que la plataforma guarda: ficha,
// vehículos, trabajos, citas, ventas, documentos tributarios, encuestas y
// WhatsApp. Sirve para responder acceso y portabilidad. Se lee con la sesión
// de quien exporta, así que RLS limita todo a su empresa. No incluye las fotos
// de inspección (solo están en el almacenamiento) ni los datos de otras
// personas: revisar el contenido antes de entregarlo.
export async function exportarDatosCliente(clienteId) {
  const [cliente] = await leer(supabase.from('clientes').select('*').eq('id', clienteId))
  if (!cliente) throw new Error('No se encontró la ficha del cliente.')

  const vehiculos = await leer(
    supabase.from('clientes_vehiculos').select('es_propietario, es_conductor, vehiculos(*)').eq('cliente_id', clienteId)
  )
  const trabajos = await leer(supabase.from('trabajos_taller').select('*').eq('cliente_id', clienteId))
  const citas = await leer(supabase.from('citas').select('*').eq('cliente_id', clienteId))
  const ventas = await leer(supabase.from('ventas_directas').select('*').eq('cliente_id', clienteId))
  const documentos = await leer(supabase.from('documentos_tributarios').select('*').eq('cliente_id', clienteId))

  const idsTrabajos = trabajos.map((trabajo) => trabajo.id)
  const encuestas = idsTrabajos.length
    ? (await leer(supabase.from('encuestas').select('*').in('trabajo_id', idsTrabajos))).map(({ token: _token, ...resto }) => resto)
    : []

  const contactos = await leer(supabase.from('whatsapp_contactos').select('*').eq('cliente_id', clienteId))
  const idsWhatsapp = contactos.map((contacto) => contacto.wa_id)
  const mensajes = idsWhatsapp.length ? await leer(supabase.from('whatsapp_mensajes').select('*').in('wa_id', idsWhatsapp)) : []

  const datos = {
    cliente,
    vehiculos,
    trabajos,
    citas,
    ventas,
    documentos_tributarios: documentos,
    encuestas,
    whatsapp: { contactos, mensajes },
  }

  return {
    generado_en: new Date().toISOString(),
    cliente_id: clienteId,
    nota: 'Copia de los datos personales tratados en la plataforma. No incluye las fotos de inspección guardadas en el almacenamiento.',
    resumen: Object.fromEntries(
      Object.entries(datos).map(([clave, valor]) => [
        clave,
        clave === 'cliente' ? 1 : clave === 'whatsapp' ? `${valor.contactos.length} contactos, ${valor.mensajes.length} mensajes` : valor.length,
      ])
    ),
    datos,
  }
}

export function descargarJson(objeto, nombreArchivo) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}
