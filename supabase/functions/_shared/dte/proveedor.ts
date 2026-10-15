// Contrato que debe cumplir cualquier proveedor de DTE (0037_facturacion_
// electronica.sql). La Edge Function `facturacion-emitir` solo conoce esta
// interfaz: cambiar de proveedor es agregar un adaptador nuevo en esta
// carpeta y su nombre al CHECK de facturacion_config.proveedor, sin tocar
// la función ni el frontend.
//
// El proveedor es dueño de: el certificado digital, los folios (CAF), la
// firma XML, el timbre y la comunicación con el SII. Nada de eso existe en
// este repo -ni debe existir: un .pfx o un CAF en el código o en la base es
// una fuga esperando a pasar-.
//
// LIMITACIÓN CONOCIDA de esta primera versión: `emitir` devuelve un
// resultado final (aceptado/rechazado). Un proveedor real que responda
// "recibido por el SII, pendiente de aceptación" necesita además una
// consulta de estado posterior (polling o webhook del proveedor) -se agrega
// cuando se elija proveedor, porque su forma depende de cada API-.

export type TipoDte = 33 | 34 | 39 | 41 | 52 | 56 | 61

export interface EmisorDte {
  rut: string | null
  razon_social: string
  giro: string | null
  codigo_actividad: string | null
  direccion: string | null
  comuna: string | null
  ciudad: string | null
}

export interface ReceptorDte {
  rut: string | null
  razon_social: string | null
  giro: string | null
  direccion: string | null
  comuna: string | null
  ciudad: string | null
  correo: string | null
}

export interface LineaDte {
  numero_linea: number
  nombre: string
  descripcion: string | null
  cantidad: number
  unidad: string | null
  precio_unitario: number
  exento: boolean
  monto_linea: number
}

export interface ReferenciaDte {
  tipo_dte: number
  folio: number
  fecha_emision: string
  codigo: number
  razon: string | null
}

export interface SolicitudEmision {
  // Se pasa como clave de idempotencia al proveedor: reintentar una emisión
  // que falló por timeout no debe generar un segundo DTE.
  clave_idempotencia: string
  empresa_id: string
  ambiente: 'certificacion' | 'produccion'
  tipo_dte: TipoDte
  fecha_emision: string
  emisor: EmisorDte
  receptor: ReceptorDte
  lineas: LineaDte[]
  montos: { neto: number; exento: number; iva: number; total: number }
  referencia: ReferenciaDte | null
  guia_indicador_traslado: number | null
}

export interface ResultadoEmision {
  estado: 'aceptado' | 'rechazado'
  folio: number | null
  // true = documento SIMULADO, sin validez tributaria (solo el sandbox).
  simulado: boolean
  proveedor: string
  proveedor_ref: string | null
  url_pdf: string | null
  url_xml: string | null
  mensaje: string | null
}

export interface ProveedorDte {
  nombre: string
  emitir(solicitud: SolicitudEmision): Promise<ResultadoEmision>
}
