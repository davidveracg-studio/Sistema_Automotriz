// Datos que completa la empresa antes de publicar los documentos legales.
//
// Todo lo que diga [POR COMPLETAR] es información que NO está en el código y
// que no se debe inventar: la entrega la empresa (razón social, RUT, domicilio,
// plazos, países de los proveedores). Mientras ESTADO sea 'borrador', las
// páginas /privacidad y /terminos muestran un aviso visible de que el texto
// está pendiente de revisión legal. Pasar a 'vigente' solo después de que un
// abogado lo revise y de que no quede ningún marcador.

export const marcador = (detalle) => `[POR COMPLETAR: ${detalle}]`

export const RESPONSABLE = {
  nombreComercial: 'VPAI CRM',
  razonSocial: marcador('razón social'),
  rut: marcador('RUT de la empresa'),
  domicilio: marcador('domicilio postal'),
  representante: marcador('representante legal'),
  correoContacto: marcador('correo para consultas y solicitudes sobre datos personales'),
  encargadoPrevencion: 'No se ha designado un delegado de protección de datos.',
}

export const DOCUMENTOS = {
  estado: 'borrador', // 'borrador' | 'vigente'
  version: '0.1',
  fecha: '2026-11-03',
  // La Ley 21.719 entra en vigencia el 1 de diciembre de 2026.
  vigenciaLey: '1 de diciembre de 2026',
}

export const hayMarcadoresPendientes = (texto) => texto.includes('[POR COMPLETAR') || texto.includes('[POR CONFIRMAR')
