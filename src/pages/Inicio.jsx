import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'

const ETIQUETA_TIPO = {
  presupuesto_pendiente: 'Presupuesto',
  encuesta_negativa: 'Encuesta negativa',
  cita_nueva: 'Cita nueva',
  listo_para_entrega: 'Listo para entrega',
  compra_reptos_pendiente: 'Compra de repuestos',
  factura_vencida: 'Factura vencida',
  whatsapp_desconectado: 'WhatsApp desconectado',
  repuesto_pendiente_presupuesto: 'Repuesto sin presupuesto',
}

const COLOR_TIPO = {
  presupuesto_pendiente: 'border-l-amber-400',
  encuesta_negativa: 'border-l-red-500',
  cita_nueva: 'border-l-blue-400',
  listo_para_entrega: 'border-l-emerald-500',
  compra_reptos_pendiente: 'border-l-orange-400',
  factura_vencida: 'border-l-red-500',
  whatsapp_desconectado: 'border-l-red-500',
  repuesto_pendiente_presupuesto: 'border-l-amber-400',
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
      patente: notificacion.trabajos_taller?.vehiculos?.patente,
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
      patente: factura.vehiculos?.patente,
      marcable: false,
    })),
  ].sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn))

  const noLeidas = items.filter((item) => !item.leida).length

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-slate-900">Hola, {usuario?.nombre_completo || usuario?.correo}</h1>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Notificaciones</h2>
          {noLeidas > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">{noLeidas}</span>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="space-y-2">
          {!cargando &&
            items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start justify-between gap-3 rounded border-l-4 bg-white p-3 shadow-sm ${
                  COLOR_TIPO[item.tipo] || 'border-l-slate-300'
                } ${item.leida ? 'opacity-60' : ''}`}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {ETIQUETA_TIPO[item.tipo] || item.tipo}
                    </span>
                    {item.numeroOt && (
                      <Link
                        to={`/trabajos/${item.trabajoId}`}
                        className="text-xs text-slate-500 underline hover:text-slate-700"
                      >
                        {item.patente ? `${item.patente} · ` : ''}OT {item.numeroOt}
                      </Link>
                    )}
                    {item.tipo === 'cita_nueva' && (
                      <Link to="/agenda" className="text-xs text-slate-500 underline hover:text-slate-700">
                        Ver agenda
                      </Link>
                    )}
                    <span className="text-xs text-slate-400">{formatoFecha(item.creadoEn)}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{item.titulo}</p>
                  <p className="text-sm text-slate-600">{item.mensaje}</p>
                </div>
                {item.marcable && !item.leida && (
                  <button
                    type="button"
                    onClick={() => marcarLeida(item.id)}
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    Marcar leída
                  </button>
                )}
              </div>
            ))}

          {!cargando && items.length === 0 && (
            <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-400">
              No tienes notificaciones pendientes.
            </p>
          )}
          {cargando && <p className="p-6 text-center text-slate-400">Cargando…</p>}
        </div>
      </div>
    </div>
  )
}

export default Inicio
