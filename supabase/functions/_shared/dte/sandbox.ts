// Adaptador de SIMULACIÓN. No habla con el SII ni con ningún proveedor: asigna
// un folio de un contador propio (facturacion_folios_sandbox) y marca el
// documento como aceptado con simulado=true.
//
// Sirve para construir y probar todo el flujo (borrador → emisión → estados →
// notas de crédito) antes de contratar un proveedor real. Los documentos que
// produce NO tienen validez tributaria y la interfaz los rotula así; además,
// facturacion-emitir no vuelca su folio al número de documento de la OT
// (`numero_documento_facturacion`), para que un folio inventado nunca se
// mezcle con la numeración real de Dimasoft.
import type { ProveedorDte, ResultadoEmision, SolicitudEmision } from './proveedor.ts'

// deno-lint-ignore no-explicit-any
export function crearSandbox(supabase: any): ProveedorDte {
  return {
    nombre: 'sandbox',
    async emitir(solicitud: SolicitudEmision): Promise<ResultadoEmision> {
      const { data: folio, error } = await supabase.rpc('facturacion_sandbox_siguiente_folio', {
        p_empresa_id: solicitud.empresa_id,
        p_tipo_dte: solicitud.tipo_dte,
      })
      if (error || typeof folio !== 'number') {
        throw new Error(`Sandbox: no se pudo asignar folio (${error?.message ?? 'respuesta inválida'}).`)
      }

      return {
        estado: 'aceptado',
        folio,
        simulado: true,
        proveedor: 'sandbox',
        proveedor_ref: `SANDBOX-${solicitud.tipo_dte}-${folio}`,
        url_pdf: null,
        url_xml: null,
        mensaje: 'Documento SIMULADO: sin validez tributaria.',
      }
    },
  }
}
