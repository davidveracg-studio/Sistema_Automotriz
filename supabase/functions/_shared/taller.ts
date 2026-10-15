// Lógica del flujo del taller que no depende de ClickUp: qué pasa cuando una
// OT cambia de estado (avisos, retroceso) y quién recibe los ítems de
// repuestos. La usan dos caminos que deben comportarse igual:
//   - clickup-webhook: el estado cambió EN ClickUp y llega por el webhook.
//   - clickup-kanban (modo local): la empresa no tiene lista de ClickUp y el
//     estado se cambia directo en la base desde el Kanban.
//
// "Modo local" = la empresa no tiene una fila activa en clickup_config. Todo
// el taller (Kanban, tareas, listas de control) funciona igual, solo que sin
// empujar nada a ClickUp.
import { enviarCorreo } from './brevo.ts'

// deno-lint-ignore no-explicit-any
type Supabase = any
export type RegistrarError = (empresaId: string | null, trabajoId: string | null, operacion: string, error: unknown) => Promise<void>

// Nombres de estado que el cliente confirmó el 2026-09-15. Comparados en
// minúsculas (la API de ClickUp los devuelve así). "Compra reptos" se compara
// por prefijo: en la lista real lleva el nombre del encargado entre
// paréntesis ("compra reptos (bodega)" en la demo).
export const ESTADO_RETROCESO = 'retroceso'
export const ESTADO_LISTO_PARA_ENTREGA = 'listo para entrega'
const PREFIJO_COMPRA_REPTOS = 'compra reptos'

const esCompraReptos = (estado: string | null | undefined) => (estado ?? '').startsWith(PREFIJO_COMPRA_REPTOS)

// Columnas de trabajos_taller (con joins) que necesita aplicarCambioEstado.
export const SELECCION_TRABAJO_ESTADO =
  'id, empresa_id, numero_ot, vehiculo_id, trabajo_original_id, asesor_id, clickup_estado_actual, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)'

export interface TrabajoEstado {
  id: string
  empresa_id: string
  numero_ot: number
  vehiculo_id: string | null
  trabajo_original_id: string | null
  asesor_id: string | null
  clickup_estado_actual: string | null
  clientes: { nombre: string; apellido: string | null; razon_social: string | null } | { nombre: string; apellido: string | null; razon_social: string | null }[] | null
  vehiculos: { patente: string; marca: string; modelo: string } | { patente: string; marca: string; modelo: string }[] | null
}

// Lista de ClickUp activa de la empresa, o null si trabaja en modo local.
export async function listaClickUp(supabase: Supabase, empresaId: string): Promise<string | null> {
  const { data: config } = await supabase
    .from('clickup_config')
    .select('lista_trabajos_id, activo')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  return config?.activo && config.lista_trabajos_id ? (config.lista_trabajos_id as string) : null
}

// Coordinador de repuestos (0062): el configurado en clickup_config o, si la
// empresa no tiene esa fila (modo local), el primer encargado de presupuestos
// activo -es quien prepara y compra los repuestos-.
export async function coordinadorRepuestos(supabase: Supabase, empresaId: string): Promise<string | null> {
  const { data: config } = await supabase
    .from('clickup_config')
    .select('responsable_repuestos_id')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (config?.responsable_repuestos_id) return config.responsable_repuestos_id as string

  const { data: encargado } = await supabase
    .from('usuarios')
    .select('id')
    .eq('empresa_id', empresaId)
    .eq('rol', 'encargado_presupuestos')
    .eq('activo', true)
    .order('nombre_completo')
    .limit(1)
    .maybeSingle()
  return (encargado?.id as string | undefined) ?? null
}

// Reacciona a que la OT pasó a `estadoNuevo` (minúsculas) y guarda ese estado
// como el último conocido. Solo actúa en la TRANSICIÓN -se compara contra
// clickup_estado_actual- para no repetir avisos mientras la OT sigue igual.
export async function aplicarCambioEstado(supabase: Supabase, trabajo: TrabajoEstado, estadoNuevo: string, registrarError: RegistrarError) {
  const anterior = trabajo.clickup_estado_actual

  // RETROCESO = "retrabajo" (confirmado por el cliente 2026-09-15): vincular
  // a la OT original del mismo vehículo -la más reciente ya entregada- si
  // todavía no tiene una. Si no hay ninguna, queda registrado como aviso.
  if (estadoNuevo === ESTADO_RETROCESO && !trabajo.trabajo_original_id && trabajo.vehiculo_id) {
    const { data: original } = await supabase
      .from('trabajos_taller')
      .select('id')
      .eq('vehiculo_id', trabajo.vehiculo_id)
      .eq('estado', 'entregado')
      .neq('id', trabajo.id)
      .order('fecha_entrega', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (original) {
      await supabase.from('trabajos_taller').update({ trabajo_original_id: original.id }).eq('id', trabajo.id)
    } else {
      await registrarError(
        trabajo.empresa_id,
        trabajo.id,
        'retroceso_sin_ot_original',
        new Error(
          'La OT pasó a RETROCESO pero no se encontró una OT entregada anterior para el mismo vehículo. Revisar y vincular a mano si corresponde.'
        )
      )
    }
  }

  // "Listo para entrega": aviso activo al asesor (correo + notificación).
  if (estadoNuevo === ESTADO_LISTO_PARA_ENTREGA && anterior !== ESTADO_LISTO_PARA_ENTREGA) {
    await avisarListoParaEntrega(supabase, trabajo, registrarError)
    await crearNotificacionListoParaEntrega(supabase, trabajo, registrarError)
  }

  // "Compra reptos": aviso a jefe de taller/bodega; se resuelve solo al salir del estado.
  if (esCompraReptos(estadoNuevo) && !esCompraReptos(anterior)) {
    await crearNotificacionCompraReptos(supabase, trabajo, registrarError)
  } else if (!esCompraReptos(estadoNuevo) && esCompraReptos(anterior)) {
    await supabase.from('notificaciones').delete().eq('trabajo_id', trabajo.id).eq('tipo', 'compra_reptos_pendiente')
  }

  if (estadoNuevo && estadoNuevo !== anterior) {
    await supabase.from('trabajos_taller').update({ clickup_estado_actual: estadoNuevo }).eq('id', trabajo.id)
  }
}

// Aviso por correo al asesor cuando la OT llega a "listo para entrega": sin
// esto, nada le avisa de forma activa que puede cobrar.
async function avisarListoParaEntrega(supabase: Supabase, trabajo: TrabajoEstado, registrarError: RegistrarError) {
  if (!trabajo.asesor_id) {
    await registrarError(
      trabajo.empresa_id,
      trabajo.id,
      'aviso_listo_entrega',
      new Error('La OT no tiene asesor asignado; no se pudo avisar por correo.')
    )
    return
  }

  const { data: asesor } = await supabase
    .from('usuarios')
    .select('correo, nombre_completo')
    .eq('id', trabajo.asesor_id)
    .maybeSingle()

  if (!asesor?.correo) {
    await registrarError(trabajo.empresa_id, trabajo.id, 'aviso_listo_entrega', new Error('No se encontró el correo del asesor asignado.'))
    return
  }

  const cliente = Array.isArray(trabajo.clientes) ? trabajo.clientes[0] : trabajo.clientes
  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos
  const nombreCliente = cliente?.razon_social || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ')

  try {
    await enviarCorreo({
      destinatarioEmail: asesor.correo,
      destinatarioNombre: asesor.nombre_completo,
      asunto: `Listo para entrega: OT ${trabajo.numero_ot}`,
      html: `<p>La OT <strong>${trabajo.numero_ot}</strong> (${vehiculo?.patente ?? ''} — ${vehiculo?.marca ?? ''} ${vehiculo?.modelo ?? ''}, cliente ${nombreCliente}) quedó marcada como <strong>LISTO PARA ENTREGA</strong> en el taller. Contacta al cliente y registra el cobro en el CRM.</p>`,
    })
  } catch (error) {
    await registrarError(trabajo.empresa_id, trabajo.id, 'aviso_listo_entrega', error)
  }
}

// Notificación en la app (además del correo) para el asesor de la OT.
async function crearNotificacionListoParaEntrega(supabase: Supabase, trabajo: TrabajoEstado, registrarError: RegistrarError) {
  if (!trabajo.asesor_id) return // ya quedó registrado el error en avisarListoParaEntrega

  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos

  const { error } = await supabase.from('notificaciones').insert({
    empresa_id: trabajo.empresa_id,
    tipo: 'listo_para_entrega',
    trabajo_id: trabajo.id,
    usuario_destino_id: trabajo.asesor_id,
    titulo: 'Vehículo listo para entrega',
    mensaje: `${vehiculo?.patente ?? 'Vehículo'} · OT ${trabajo.numero_ot} quedó listo para entrega. Contacta al cliente y registra el cobro.`,
  })
  if (error) await registrarError(trabajo.empresa_id, trabajo.id, 'notificacion_listo_entrega', error)
}

// Aviso para jefe_taller/encargado_presupuestos cuando faltan repuestos por
// comprar -mismo grupo de acceso de /bodega-.
async function crearNotificacionCompraReptos(supabase: Supabase, trabajo: TrabajoEstado, registrarError: RegistrarError) {
  const vehiculo = Array.isArray(trabajo.vehiculos) ? trabajo.vehiculos[0] : trabajo.vehiculos

  const { error } = await supabase.from('notificaciones').insert({
    empresa_id: trabajo.empresa_id,
    tipo: 'compra_reptos_pendiente',
    trabajo_id: trabajo.id,
    roles_destino: ['jefe_taller', 'encargado_presupuestos'],
    titulo: 'Repuestos pendientes de compra',
    mensaje: `${vehiculo?.patente ?? 'Vehículo'} · OT ${trabajo.numero_ot} quedó en "Compra reptos": faltan repuestos por comprar.`,
  })
  if (error) await registrarError(trabajo.empresa_id, trabajo.id, 'notificacion_compra_reptos', error)
}

// Avisa al asesor de la OT que un técnico dejó una observación en una tarea
// -puede señalar una venta cruzada (ej. "neumáticos gastados") que conviene
// ofrecer al cliente.
export async function avisarObservacionTecnico(
  supabase: Supabase,
  datos: {
    empresaId: string
    trabajoId: string
    numeroOt?: number
    asesorId: string | null
    patente?: string
    observacion: string
    registrarError: RegistrarError
  }
) {
  if (!datos.asesorId) return

  const resumen = datos.observacion.length > 200 ? `${datos.observacion.slice(0, 200)}…` : datos.observacion
  const { error } = await supabase.from('notificaciones').insert({
    empresa_id: datos.empresaId,
    tipo: 'observacion_tecnico',
    trabajo_id: datos.trabajoId,
    usuario_destino_id: datos.asesorId,
    titulo: 'Observación del técnico',
    mensaje: `${datos.patente ?? 'Vehículo'} · OT ${datos.numeroOt ?? ''}: ${resumen}`,
  })
  if (error) await datos.registrarError(datos.empresaId, datos.trabajoId, 'notificacion_observacion_tecnico', error)
}
