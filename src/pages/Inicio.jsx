import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'
import { formatearPatente } from '../lib/patente'
import Icono from '../components/Icono'

const ETIQUETA_TIPO = {
  presupuesto_pendiente: 'Presupuesto',
  encuesta_negativa: 'Encuesta negativa',
  cita_nueva: 'Cita nueva',
  listo_para_entrega: 'Listo para entrega',
  compra_reptos_pendiente: 'Compra de repuestos',
  factura_vencida: 'Factura vencida',
  whatsapp_desconectado: 'WhatsApp desconectado',
  repuesto_pendiente_presupuesto: 'Repuesto sin presupuesto',
  descuento_pendiente: 'Descuento por autorizar',
  descuento_resuelto: 'Descuento',
  tarea_asignada: 'Tarea asignada',
  repuesto_asignado: 'Repuesto para preparar',
}

// Tonos del estilo MaterialM: fondo translúcido + ícono del mismo color.
const TONO = {
  azul: 'bg-brand-accent/10 text-brand-accent dark:bg-brand-accent/20 dark:text-brand-accentSoft',
  amarillo: 'bg-mm-warning/15 text-[#c98a00] dark:text-mm-warning',
  rojo: 'bg-mm-error/15 text-[#e64f7d] dark:text-mm-error',
  verde: 'bg-mm-success/15 text-[#00a896] dark:text-mm-success',
  violeta: 'bg-violet-500/15 text-violet-500 dark:text-violet-300',
  naranja: 'bg-orange-500/15 text-orange-500 dark:text-orange-300',
}

// Ícono (de ICONOS en lib/navegacion) y tono de cada tipo de notificación.
const ASPECTO_TIPO = {
  presupuesto_pendiente: ['presupuestos', 'amarillo'],
  encuesta_negativa: ['encuestas', 'rojo'],
  cita_nueva: ['calendario', 'azul'],
  listo_para_entrega: ['trabajos', 'verde'],
  compra_reptos_pendiente: ['bodega', 'naranja'],
  factura_vencida: ['cuentasPorCobrar', 'rojo'],
  whatsapp_desconectado: ['mensajes', 'rojo'],
  repuesto_pendiente_presupuesto: ['bodega', 'amarillo'],
  descuento_pendiente: ['cuentasPorCobrar', 'amarillo'],
  descuento_resuelto: ['cuentasPorCobrar', 'verde'],
  tarea_asignada: ['trabajos', 'violeta'],
  repuesto_asignado: ['bodega', 'naranja'],
}

// Fondo de cada indicador: el mismo tono, más tenue, sobre toda la tarjeta.
const FONDO_INDICADOR = {
  azul: 'bg-brand-accent/[0.07] dark:bg-brand-accent/[0.12]',
  verde: 'bg-mm-success/[0.09] dark:bg-mm-success/[0.12]',
  amarillo: 'bg-mm-warning/[0.10] dark:bg-mm-warning/[0.12]',
  rojo: 'bg-mm-error/[0.09] dark:bg-mm-error/[0.12]',
}

const CIRCULO_INDICADOR = {
  azul: 'bg-brand-accent',
  verde: 'bg-mm-success',
  amarillo: 'bg-mm-warning',
  rojo: 'bg-mm-error',
}

// Estados de una OT que ya salió del taller (ver check de trabajos_taller.estado).
const ESTADOS_CERRADOS = '("entregado","anulado")'

function hoyIso() {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
}

function Indicador({ titulo, valor, detalle, icono, tono, to }) {
  return (
    <Link
      to={to}
      className={`group flex flex-col gap-4 rounded-2xl p-5 transition-shadow hover:shadow-mm ${FONDO_INDICADOR[tono]}`}
    >
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-full text-white ${CIRCULO_INDICADOR[tono]}`}>
          <Icono nombre={icono} className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-mm-link dark:text-slate-200">{titulo}</span>
      </div>
      <div>
        <p className="text-3xl font-bold text-mm-link dark:text-white">{valor ?? '—'}</p>
        <p className="mt-1 text-xs text-slate-500 group-hover:underline">{detalle}</p>
      </div>
    </Link>
  )
}

// Mismo grupo de acceso que /cuentas-por-cobrar (App.jsx): admin/socia ya
// ven todo sin este filtro, se repite acá solo para el resto de los roles.
const ROLES_CUENTAS_POR_COBRAR = ['admin', 'socia', 'asesor', 'encargado_presupuestos', 'jefe_taller']

function estaVencida(fechaVencimiento) {
  if (!fechaVencimiento) return false
  return new Date(fechaVencimiento) < new Date(new Date().toDateString())
}

function nombreCliente(cliente) {
  if (!cliente) return null
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoFecha(fechaIso) {
  if (!fechaIso) return '—'
  const fecha = new Date(fechaIso)
  return `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`
}

function Inicio() {
  const { usuario } = useAuth()
  const [notificaciones, setNotificaciones] = useState([])
  const [leidas, setLeidas] = useState(new Set())
  const [facturasVencidas, setFacturasVencidas] = useState([])
  const [enTaller, setEnTaller] = useState(null)
  const [citasHoy, setCitasHoy] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!usuario) return
    setCargando(true)
    setError(null)
    try {
      const [{ data: notifs, error: errorNotifs }, { data: lecturas, error: errorLecturas }] = await Promise.all([
        supabase
          .from('notificaciones')
          .select('id, tipo, titulo, mensaje, trabajo_id, creado_en, trabajos_taller(id, numero_ot, vehiculos(patente))')
          .order('creado_en', { ascending: false }),
        supabase.from('notificaciones_lecturas').select('notificacion_id').eq('usuario_id', usuario.id),
      ])

      if (errorNotifs) throw errorNotifs
      if (errorLecturas) throw errorLecturas

      setNotificaciones(notifs || [])
      setLeidas(new Set((lecturas || []).map((l) => l.notificacion_id)))

      if (ROLES_CUENTAS_POR_COBRAR.includes(usuario.rol)) {
        const { data: facturas, error: errorFacturas } = await supabase
          .from('trabajos_taller')
          .select('id, numero_ot, fecha_vencimiento_pago, vehiculos(patente), clientes(nombre, apellido, razon_social)')
          .eq('estado_pago', 'pendiente')
          .not('fecha_vencimiento_pago', 'is', null)

        if (errorFacturas) throw errorFacturas
        setFacturasVencidas((facturas || []).filter((factura) => estaVencida(factura.fecha_vencimiento_pago)))
      } else {
        setFacturasVencidas([])
      }
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [usuario])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Indicadores del panel. Van aparte de las notificaciones: si uno falla se
  // muestra "—" y el resto del panel sigue funcionando.
  useEffect(() => {
    if (!usuario) return
    let vigente = true
    async function contar() {
      const [taller, citas] = await Promise.all([
        supabase.from('trabajos_taller').select('id', { count: 'exact', head: true }).not('estado', 'in', ESTADOS_CERRADOS),
        supabase
          .from('citas')
          .select('id', { count: 'exact', head: true })
          .eq('fecha', hoyIso())
          .in('estado', ['agendada', 'confirmada']),
      ])
      if (!vigente) return
      setEnTaller(taller.error ? null : taller.count)
      setCitasHoy(citas.error ? null : citas.count)
    }
    contar()
    return () => {
      vigente = false
    }
  }, [usuario])

  async function marcarLeida(notificacionId) {
    setLeidas((anterior) => new Set(anterior).add(notificacionId))
    try {
      const { error: errorInsercion } = await supabase
        .from('notificaciones_lecturas')
        .insert({ notificacion_id: notificacionId, usuario_id: usuario.id })
      // 23505 = ya estaba marcada leída (otra pestaña, doble clic): no es un error real.
      if (errorInsercion && errorInsercion.code !== '23505') throw errorInsercion
    } catch {
      // No revertimos el estado visual por un fallo de red al marcar leída: no es crítico,
      // se reintenta solo la próxima vez que se recargue el panel.
    }
  }

  const items = [
    ...notificaciones.map((notificacion) => ({
      id: notificacion.id,
      tipo: notificacion.tipo,
      titulo: notificacion.titulo,
      mensaje: notificacion.mensaje,
      creadoEn: notificacion.creado_en,
      leida: leidas.has(notificacion.id),
      trabajoId: notificacion.trabajo_id,
      numeroOt: notificacion.trabajos_taller?.numero_ot,
      patente: formatearPatente(notificacion.trabajos_taller?.vehiculos?.patente),
      marcable: true,
    })),
    ...facturasVencidas.map((factura) => ({
      id: `factura-${factura.id}`,
      tipo: 'factura_vencida',
      titulo: 'Factura vencida',
      mensaje: `${nombreCliente(factura.clientes) || 'Cliente'} · vencida desde el ${formatoFecha(factura.fecha_vencimiento_pago)}.`,
      creadoEn: factura.fecha_vencimiento_pago,
      leida: false,
      trabajoId: factura.id,
      numeroOt: factura.numero_ot,
      patente: formatearPatente(factura.vehiculos?.patente),
      marcable: false,
    })),
  ].sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn))

  const noLeidas = items.filter((item) => !item.leida).length

  const veCobranza = ROLES_CUENTAS_POR_COBRAR.includes(usuario?.rol)
  const fecha = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  const fechaLarga = fecha.charAt(0).toUpperCase() + fecha.slice(1)

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mm-link dark:text-white">Hola, {usuario?.nombre_completo || usuario?.correo}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {fechaLarga}
            {usuario?.empresas?.nombre ? ` · ${usuario.empresas.nombre}` : ''}
          </p>
        </div>
      </div>

      <div className={`mt-6 grid gap-5 sm:grid-cols-2 ${veCobranza ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
        <Indicador titulo="Vehículos en taller" valor={enTaller} detalle="OT abiertas · ver trabajos" icono="taller" tono="azul" to="/trabajos" />
        <Indicador titulo="Citas de hoy" valor={citasHoy} detalle="Agendadas y confirmadas · ver agenda" icono="calendario" tono="verde" to="/agenda" />
        <Indicador
          titulo="Sin leer"
          valor={cargando ? null : noLeidas}
          detalle="Notificaciones pendientes"
          icono="campana"
          tono="amarillo"
          to="/"
        />
        {veCobranza && (
          <Indicador
            titulo="Facturas vencidas"
            valor={cargando ? null : facturasVencidas.length}
            detalle="Ver cuentas por cobrar"
            icono="cuentasPorCobrar"
            tono="rojo"
            to="/cuentas-por-cobrar"
          />
        )}
      </div>

      <section className="card mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-mm-link dark:text-white">Notificaciones</h2>
          {noLeidas > 0 && (
            <span className="rounded-full bg-mm-error/15 px-2.5 py-0.5 text-xs font-semibold text-[#e64f7d] dark:text-mm-error">
              {noLeidas} sin leer
            </span>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="divide-y divide-slate-100">
          {!cargando &&
            items.map((item) => {
              const [icono, tono] = ASPECTO_TIPO[item.tipo] || ['campana', 'azul']
              return (
                <div key={item.id} className={`flex items-start gap-4 py-4 first:pt-0 last:pb-0 ${item.leida ? 'opacity-60' : ''}`}>
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${TONO[tono]}`}>
                    <Icono nombre={icono} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {ETIQUETA_TIPO[item.tipo] || item.tipo}
                      </span>
                      {item.numeroOt && (
                        <Link to={`/trabajos/${item.trabajoId}`} className="text-xs text-brand-accent hover:underline">
                          {item.patente ? `${item.patente} · ` : ''}OT {item.numeroOt}
                        </Link>
                      )}
                      {item.tipo === 'cita_nueva' && (
                        <Link to="/agenda" className="text-xs text-brand-accent hover:underline">
                          Ver agenda
                        </Link>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-mm-link dark:text-slate-100">{item.titulo}</p>
                    <p className="text-sm text-slate-500">{item.mensaje}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                      {formatoFecha(item.creadoEn)}
                    </span>
                    {item.marcable && !item.leida && (
                      <button
                        type="button"
                        onClick={() => marcarLeida(item.id)}
                        className="rounded-full px-3 py-1 text-xs font-medium text-brand-accent transition-colors hover:bg-brand-accent/10"
                      >
                        Marcar leída
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

          {!cargando && items.length === 0 && (
            <p className="py-6 text-center text-slate-400">No tienes notificaciones pendientes.</p>
          )}
          {cargando && <p className="py-6 text-center text-slate-400">Cargando…</p>}
        </div>
      </section>
    </div>
  )
}

export default Inicio
