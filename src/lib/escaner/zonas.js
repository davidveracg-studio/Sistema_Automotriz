// Zonas guiadas del escáner. El sistema no "reconoce" en qué cara del vehículo
// está: el usuario avanza por esta lista y cada captura se asigna a la zona
// activa. Así el indicador de cobertura es confiable sin depender de un modelo.

export const ZONAS_EXTERIOR = [
  { id: 'frontal', etiqueta: 'Frente' },
  { id: 'esquina_del_izq', etiqueta: 'Esquina del. izq.' },
  { id: 'lateral_izq', etiqueta: 'Lateral izq.' },
  { id: 'esquina_tra_izq', etiqueta: 'Esquina tras. izq.' },
  { id: 'trasera', etiqueta: 'Trasera' },
  { id: 'esquina_tra_der', etiqueta: 'Esquina tras. der.' },
  { id: 'lateral_der', etiqueta: 'Lateral der.' },
  { id: 'esquina_del_der', etiqueta: 'Esquina del. der.' },
  { id: 'techo', etiqueta: 'Techo' },
  { id: 'llantas', etiqueta: 'Llantas' },
  { id: 'vidrios', etiqueta: 'Vidrios' },
]

export const ZONAS_INTERIOR = [
  { id: 'tablero', etiqueta: 'Tablero' },
  { id: 'asientos_del', etiqueta: 'Asientos del.' },
  { id: 'asientos_tra', etiqueta: 'Asientos tras.' },
  { id: 'consola', etiqueta: 'Consola' },
  { id: 'maletero', etiqueta: 'Maletero' },
  { id: 'otros', etiqueta: 'Otros' },
]

export const ZONAS_POR_FASE = {
  exterior: ZONAS_EXTERIOR,
  interior: ZONAS_INTERIOR,
}

export function etiquetaSubzona(zona, subzona) {
  const lista = ZONAS_POR_FASE[zona] || []
  return lista.find((z) => z.id === subzona)?.etiqueta || subzona || ''
}
