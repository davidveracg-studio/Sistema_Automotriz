import type { ProveedorDte } from './proveedor.ts'
import { crearSandbox } from './sandbox.ts'

// Único punto donde se conecta un nombre de proveedor (facturacion_config.
// proveedor) con su adaptador. Un proveedor nuevo = un archivo en esta
// carpeta + una línea acá + su valor en el CHECK de la tabla.
// deno-lint-ignore no-explicit-any
export function obtenerProveedor(nombre: string, supabase: any): ProveedorDte {
  switch (nombre) {
    case 'sandbox':
      return crearSandbox(supabase)
    default:
      throw new Error(`Proveedor de facturación no soportado: "${nombre}".`)
  }
}
