// Catálogos de la encuesta de postventa, compartidos entre la página
// pública (EncuestaPublica.jsx) y la pantalla de resultados (Encuestas.jsx)
// para que ambas hablen de las mismas áreas/etiquetas.

export const PREGUNTAS = [
  { clave: 'entrega_tiempo', etiqueta: 'Entrega a tiempo', pregunta: '¿Te entregamos el vehículo en el plazo acordado?' },
  { clave: 'atencion_cliente', etiqueta: 'Atención del asesor', pregunta: '¿Cómo calificas la atención de tu asesor?' },
  { clave: 'servicio_mecanico', etiqueta: 'Servicio mecánico', pregunta: '¿Cómo calificas el trabajo mecánico realizado?' },
  { clave: 'recomendaria', etiqueta: 'Recomendaría el servicio', pregunta: '¿Recomendarías nuestro servicio a otra persona?' },
]

export const ETIQUETA_COMO_CONOCIO = {
  redes_sociales: 'Redes sociales',
  recomendacion: 'Recomendación de un conocido',
  google: 'Búsqueda en Google / internet',
  publicidad: 'Publicidad',
  pase_por_el_lugar: 'Pasé por el lugar',
  cliente_anterior: 'Ya era cliente',
  otro: 'Otro',
}

export const ETIQUETA_CLASIFICACION = {
  negativo: 'Negativa',
  positivo: 'Positiva',
  excelente: 'Excelente',
}

export const COLOR_CLASIFICACION = {
  negativo: 'bg-red-100 text-red-800 border-red-300',
  positivo: 'bg-blue-100 text-blue-800 border-blue-300',
  excelente: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}
