// Lógica compartida para reflejar las citas de la Agenda en ClickUp: una
// tarjeta en el estado "agenda" por cada cita vigente. La usan la Edge Function
// clickup-agendar-cita (desde la pantalla de Agenda) y el bot de WhatsApp
// (agenda directo, sin pasar por el navegador).
//
// Funciona como bandeja de salida: procesa las citas con clickup_pendiente =
// true de UNA empresa (ver 0044_clickup_citas.sql). Recibe un cliente con
// service role, así que quien la llame debe haber verificado antes de qué
// empresa se trata.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  actualizarTarea,
  crearTarea,
  eliminarTarea,
  ESTADO_TARJETA_CON_CITA,
  fijarCampoPersonalizado,
  marcaTiempoChile,
  obtenerTarea,
  resolverCampos,
} from './clickup.ts'
import { formatearPatente } from './patente.ts'

const MAX_INTENTOS = 5
const ESTADOS_VIGENTES = ['agendada', 'confirmada']
const ESTADOS_QUE_RETIRAN = ['cancelada', 'no_asistio']

type Uno<T> = T | T[] | null

interface CitaConRelaciones {
  id: string
  empresa_id: string
  fecha: string
  hora: string | null
  duracion_estimada_minutos: number | null
  descripcion: string | null
  estado: string
  origen: string | null
  clickup_task_id: string | null
  clickup_intentos: number
  clientes: Uno<{ nombre: string; apellido: string | null; razon_social: string | null; telefono: string | null }>
  vehiculos: Uno<{ patente: string; marca: string; modelo: string }>
  tipos_isla: Uno<{ nombre: string }>
  catalogo_servicios: Uno<{ segmento: string; categoria: string; servicio: string }>
}

export interface ResultadoSincronizacionCitas {
  procesadas: number
  creadas: number
  actualizadas: number
  retiradas: number
  errores: { cita_id: string; mensaje: string }[]
  sinConfiguracion?: boolean
}

function uno<T>(valor: Uno<T> | undefined): T | null {
  if (!valor) return null
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

function formatoFecha(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-')
  return `${dia}-${mes}-${anio}`
}

// Categoría de servicio del CRM (la que entiende el campo "Tipo de servicio" de
// ClickUp) a partir del segmento del catálogo o, si no hay, de la isla.
function categoriaDeServicio(cita: CitaConRelaciones): string | null {
  const segmento = uno(cita.catalogo_servicios)?.segmento?.toLowerCase()
  if (segmento === 'taller mecánico') return 'taller_mecanico'
  if (segmento === 'servicio rápido') return 'servicio_rapido'
  if (segmento === 'dyp') return 'dyp'
  const isla = uno(cita.tipos_isla)?.nombre?.toLowerCase()
  if (isla === 'taller mecánico') return 'taller_mecanico'
  if (isla === 'servicio rápido' || isla === 'alineación') return 'servicio_rapido'
  if (isla === 'pintura' || isla === 'lavado') return 'dyp'
  return null
}

function datosCliente(cita: CitaConRelaciones): string {
  const cliente = uno(cita.clientes)
  const nombre = cliente?.razon_social || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ') || 'Cliente sin nombre'
  return `${nombre} · ${cliente?.telefono ?? 'sin teléfono'}`
}

function nombreTarjeta(cita: CitaConRelaciones): string {
  const vehiculo = uno(cita.vehiculos)
  const cuando = `${formatoFecha(cita.fecha)}${cita.hora ? ` ${cita.hora.slice(0, 5)}` : ''}`
  const quien = vehiculo
    ? `${formatearPatente(vehiculo.patente)} ${vehiculo.marca} ${vehiculo.modelo}`
    : datosCliente(cita).split(' · ')[0]
  return `${quien} · CITA ${cuando}`
}

function descripcionTarjeta(cita: CitaConRelaciones): string {
  const servicio = uno(cita.catalogo_servicios)
  const lineas = [
    `Cita agendada ${cita.origen === 'bot_whatsapp' ? 'por el bot de WhatsApp' : 'desde la Agenda del CRM'}.`,
    `Cliente: ${datosCliente(cita)}`,
    `Fecha: ${formatoFecha(cita.fecha)}${cita.hora ? ` a las ${cita.hora.slice(0, 5)}` : ' (sin hora definida)'}${cita.duracion_estimada_minutos ? ` · ${cita.duracion_estimada_minutos} min` : ''}`,
  ]
  const isla = uno(cita.tipos_isla)?.nombre
  if (isla) lineas.push(`Isla: ${isla}`)
  if (servicio) lineas.push(`Servicio: ${servicio.categoria} - ${servicio.servicio}`)
  if (cita.descripcion) lineas.push(`Detalle: ${cita.descripcion}`)
  return lineas.join('\n')
}

export async function sincronizarCitasPendientes(
  supabase: SupabaseClient,
  empresaId: string,
  limite = 10
): Promise<ResultadoSincronizacionCitas> {
  const resultado: ResultadoSincronizacionCitas = { procesadas: 0, creadas: 0, actualizadas: 0, retiradas: 0, errores: [] }

  const { data: config } = await supabase
    .from('clickup_config')
    .select('lista_trabajos_id, campos, activo')
    .eq('empresa_id', empresaId)
    .maybeSingle()
  if (!config || !config.activo) {
    // Sin lista de ClickUp para esta empresa: no hay nada que reflejar, y las
    // citas no se marcan como resueltas por si se configura más adelante.
    return { ...resultado, sinConfiguracion: true }
  }
  const campos = resolverCampos(config.campos)

  const { data: pendientes } = await supabase
    .from('citas')
    .select(
      'id, empresa_id, fecha, hora, duracion_estimada_minutos, descripcion, estado, origen, clickup_task_id, clickup_intentos, clientes(nombre, apellido, razon_social, telefono), vehiculos(patente, marca, modelo), tipos_isla(nombre), catalogo_servicios(segmento, categoria, servicio)'
    )
    .eq('empresa_id', empresaId)
    .eq('clickup_pendiente', true)
    .order('creado_en')
    .limit(limite)

  for (const filaCruda of (pendientes ?? []) as unknown as CitaConRelaciones[]) {
    const cita = filaCruda
    resultado.procesadas++

    try {
      // Si la OT ya adoptó la tarjeta, la tarjeta es de la OT: la cita no la toca.
      let adoptadaPorOt = false
      if (cita.clickup_task_id) {
        const { data: ot } = await supabase.from('trabajos_taller').select('id').eq('clickup_task_id', cita.clickup_task_id).maybeSingle()
        adoptadaPorOt = Boolean(ot)
      }

      let clickupTaskId = cita.clickup_task_id

      if (ESTADOS_VIGENTES.includes(cita.estado)) {
        const cuerpoBase = {
          name: nombreTarjeta(cita),
          description: descripcionTarjeta(cita),
          due_date: marcaTiempoChile(cita.fecha, cita.hora),
          due_date_time: Boolean(cita.hora),
        }
        if (!clickupTaskId) {
          const tarea = (await crearTarea(config.lista_trabajos_id, { ...cuerpoBase, status: ESTADO_TARJETA_CON_CITA })) as { id: string }
          clickupTaskId = tarea.id
          // Se guarda de inmediato: si algo falla después, no se crea una segunda tarjeta.
          await supabase.from('citas').update({ clickup_task_id: clickupTaskId }).eq('id', cita.id)
          resultado.creadas++

          const vehiculo = uno(cita.vehiculos)
          const categoria = categoriaDeServicio(cita)
          const camposAFijar: [string, unknown][] = [[campos.ids.datosCliente, datosCliente(cita)]]
          if (vehiculo?.patente) camposAFijar.push([campos.ids.patente, formatearPatente(vehiculo.patente)])
          if (cita.descripcion) camposAFijar.push([campos.ids.observaciones, cita.descripcion])
          if (categoria && campos.opcionesTipoServicio[categoria]) {
            camposAFijar.push([campos.ids.tipoServicio, [campos.opcionesTipoServicio[categoria]]])
          }
          for (const [campoId, valor] of camposAFijar) {
            try {
              await fijarCampoPersonalizado(clickupTaskId, campoId, valor)
            } catch (errorCampo) {
              // Un campo que no se pudo llenar no invalida la tarjeta: se registra y se sigue.
              await registrarError(supabase, empresaId, cita.id, `campo_personalizado:${campoId}`, errorCampo)
            }
          }
        } else if (!adoptadaPorOt) {
          await actualizarTarea(clickupTaskId, cuerpoBase)
          resultado.actualizadas++
        }
      } else if (ESTADOS_QUE_RETIRAN.includes(cita.estado) && clickupTaskId && !adoptadaPorOt) {
        // Cita cancelada o a la que no llegaron: la tarjeta solo se borra si
        // sigue en "agenda" (nadie la movió, o sea el vehículo nunca llegó).
        const tarea = (await obtenerTarea(clickupTaskId).catch((error) => {
          if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404) return null
          throw error
        })) as { status?: { status?: string } } | null
        if (tarea === null) {
          // Ya no existe en ClickUp: solo se limpia el vínculo.
          await supabase.from('citas').update({ clickup_task_id: null }).eq('id', cita.id)
        } else if ((tarea.status?.status ?? '').toLowerCase() === ESTADO_TARJETA_CON_CITA) {
          await eliminarTarea(clickupTaskId)
          await supabase.from('citas').update({ clickup_task_id: null }).eq('id', cita.id)
          resultado.retiradas++
        }
      }

      await supabase
        .from('citas')
        .update({ clickup_pendiente: false, clickup_intentos: 0, clickup_sincronizada_en: new Date().toISOString() })
        .eq('id', cita.id)
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error)
      resultado.errores.push({ cita_id: cita.id, mensaje })
      await registrarError(supabase, empresaId, cita.id, 'sincronizar_cita', error)
      const intentos = (cita.clickup_intentos ?? 0) + 1
      await supabase
        .from('citas')
        .update({ clickup_intentos: intentos, clickup_pendiente: intentos < MAX_INTENTOS })
        .eq('id', cita.id)
    }
  }

  return resultado
}

async function registrarError(supabase: SupabaseClient, empresaId: string, citaId: string, operacion: string, error: unknown) {
  const mensaje = error instanceof Error ? error.message : String(error)
  await supabase.from('integraciones_clickup_errores').insert({
    empresa_id: empresaId,
    cita_id: citaId,
    operacion,
    mensaje,
    detalle: error instanceof Error ? { stack: error.stack } : null,
  })
}
