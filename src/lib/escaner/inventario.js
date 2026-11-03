// Catálogos del inventario y de los daños detectados. Los valores son los
// mismos que valida la base (0069) y la Edge Function (_shared/inspeccion.ts).

export const CATEGORIAS_INVENTARIO = {
  documentos: 'Documentos',
  herramientas: 'Herramientas',
  rueda_repuesto: 'Rueda de repuesto',
  accesorios: 'Accesorios',
  electronica: 'Electrónica',
  otros: 'Otros',
}

export const ETIQUETA_TIPO_DANO = {
  raya: 'Raya',
  abolladura: 'Abolladura',
  rotura: 'Rotura',
  oxido: 'Óxido',
  desgaste: 'Desgaste',
  suciedad_grave: 'Suciedad',
  otro: 'Otro',
}

export const ETIQUETA_SEVERIDAD = {
  leve: 'Leve',
  moderado: 'Moderado',
  grave: 'Grave',
}

export function normalizarNombre(nombre) {
  return String(nombre || '').trim().toLowerCase()
}
