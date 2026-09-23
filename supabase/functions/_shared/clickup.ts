// Cliente de la API de ClickUp v2 + constantes de ejemplo del workspace
// (versión de portafolio/demo: los IDs reales del proyecto original no van
// acá, estos son placeholders). Si ClickUp cambia estos campos o listas,
// actualizar aquí -no hay forma de descubrirlos en tiempo de ejecución sin
// otra llamada a la API, y hardcodearlos evita esa llamada extra en cada
// sync-.

const BASE_URL = 'https://api.clickup.com/api/v2'

// Equipo (workspace) en ClickUp.
export const CLICKUP_TEAM_ID = 'DEMO_TEAM_ID'

// IDs de los campos personalizados de la lista "Vehiculos en Taller".
export const CAMPOS_PERSONALIZADOS = {
  datosCliente: 'demo-campo-datos-cliente',
  kilometraje: 'demo-campo-kilometraje',
  numeroOt: 'demo-campo-numero-ot',
  observaciones: 'demo-campo-observaciones',
  patente: 'demo-campo-patente',
  tipoServicio: 'demo-campo-tipo-servicio',
} as const

// Opciones del campo "Tipo de servicio" (tipo `labels`, multi-selección).
export const OPCIONES_TIPO_SERVICIO: Record<string, string> = {
  taller_mecanico: 'demo-opcion-mecanica', // "Mecánica"
  servicio_rapido: 'demo-opcion-servicio-rapido', // "Servicio Rápido"
  dyp: 'demo-opcion-dyp', // "DyP"
}

// Estado con el que nace la tarjeta según el origen del ingreso, confirmado
// por el cliente el 2026-09-15: "agenda" si el vehículo venía de una cita
// (trabajos_taller.cita_id no nulo), "POR DESIGNAR" si entró directo sin
// cita. Sin esto, ClickUp aplica el default de la lista, que no distingue
// el origen.
export const ESTADO_TARJETA_CON_CITA = 'agenda'
export const ESTADO_TARJETA_SIN_CITA = 'POR DESIGNAR'

// Nombres de los tres checklists de "lista de control" (spec §7). El orden
// importa poco; el nombre debe calzar exacto con lo que ya usa el equipo.
// Confirmados por el cliente revisando la tarjeta real de prueba
// (2026-09-15): no son los que se habían asumido al inspeccionar el
// workspace en el Bloque 4.
export const NOMBRE_CHECKLIST_POR_AREA: Record<string, string> = {
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes e insumos',
  servicios_externos: 'Servicios Rápidos',
}

export class ErrorClickUp extends Error {
  status: number
  cuerpo: unknown

  constructor(mensaje: string, status: number, cuerpo: unknown) {
    super(mensaje)
    this.name = 'ErrorClickUp'
    this.status = status
    this.cuerpo = cuerpo
  }
}

async function clickupFetch(ruta: string, opciones: RequestInit = {}): Promise<unknown> {
  const token = Deno.env.get('CLICKUP_API_TOKEN')
  if (!token) {
    throw new Error('Falta el secreto CLICKUP_API_TOKEN en este Edge Function.')
  }

  const respuesta = await fetch(`${BASE_URL}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
  })

  const texto = await respuesta.text()
  const cuerpo = texto ? JSON.parse(texto) : null

  if (!respuesta.ok) {
    // Nunca tragarse el error: se necesita la causa real (código + mensaje
    // que entrega ClickUp), no un "algo falló" genérico.
    const mensaje = (cuerpo as { err?: string })?.err || `ClickUp respondió ${respuesta.status}`
    throw new ErrorClickUp(mensaje, respuesta.status, cuerpo)
  }

  return cuerpo
}

export interface MiembroClickUp {
  id: number
  username: string
  email: string
}

export async function obtenerMiembrosEquipo(): Promise<MiembroClickUp[]> {
  // No existe un GET /team/{team_id} que devuelva un solo equipo: la API
  // solo tiene "Get Authorized Teams" (GET /team, sin id), que lista TODOS
  // los workspaces a los que el token tiene acceso. Hay que traer la lista
  // completa y filtrar por CLICKUP_TEAM_ID -llamar con el id en la ruta
  // devolvía un cuerpo sin `.teams`, y `datos.teams[0]` reventaba con
  // "Cannot read properties of undefined".
  const datos = (await clickupFetch('/team')) as {
    teams: { id: string; members: { user: MiembroClickUp }[] }[]
  }
  const equipo = datos.teams?.find((t) => t.id === CLICKUP_TEAM_ID)
  return equipo ? equipo.members.map((m) => m.user) : []
}

export function encontrarPorCorreo(miembros: MiembroClickUp[], correo: string | null): MiembroClickUp | null {
  if (!correo) return null
  const objetivo = correo.trim().toLowerCase()
  return miembros.find((m) => m.email?.trim().toLowerCase() === objetivo) ?? null
}

export function crearTarea(listaId: string, cuerpo: Record<string, unknown>) {
  return clickupFetch(`/list/${listaId}/task`, { method: 'POST', body: JSON.stringify(cuerpo) })
}

export function actualizarTarea(tareaId: string, cuerpo: Record<string, unknown>) {
  return clickupFetch(`/task/${tareaId}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
}

export function obtenerTarea(tareaId: string) {
  return clickupFetch(`/task/${tareaId}`)
}

export function fijarCampoPersonalizado(tareaId: string, campoId: string, valor: unknown) {
  return clickupFetch(`/task/${tareaId}/field/${campoId}`, {
    method: 'POST',
    body: JSON.stringify({ value: valor }),
  })
}

export function crearChecklist(tareaId: string, nombre: string) {
  return clickupFetch(`/task/${tareaId}/checklist`, {
    method: 'POST',
    body: JSON.stringify({ name: nombre }),
  })
}

export function crearItemChecklist(checklistId: string, nombre: string, asignadoId: number | null) {
  const cuerpo: Record<string, unknown> = { name: nombre }
  if (asignadoId) cuerpo.assignee = asignadoId
  return clickupFetch(`/checklist/${checklistId}/checklist_item`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  })
}

export function actualizarItemChecklist(
  checklistId: string,
  itemId: string,
  cuerpo: Record<string, unknown>
) {
  return clickupFetch(`/checklist/${checklistId}/checklist_item/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(cuerpo),
  })
}
