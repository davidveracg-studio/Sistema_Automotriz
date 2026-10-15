import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatearPatente } from '../../lib/patente'
import { horaAMinutos, hoyLocalISO, minutosAHora, nombreVisible } from '../../lib/agenda'

export const ETIQUETA_ESTADO = {
  agendada: 'Agendada',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada: 'Cancelada',
  no_asistio: 'No asistió',
}

const COLOR_ESTADO = {
  agendada: 'border-sky-300 bg-sky-50 text-sky-900',
  confirmada: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  completada: 'border-slate-300 bg-slate-100 text-slate-600',
  cancelada: 'border-red-200 bg-red-50 text-red-700',
  no_asistio: 'border-amber-300 bg-amber-50 text-amber-900',
}

export function horarioDeCita(cita) {
  if (!cita.hora) return 'Sin hora definida'
  const inicio = cita.hora.slice(0, 5)
  if (!cita.duracion_estimada_minutos) return inicio
  const fin = minutosAHora(horaAMinutos(cita.hora) + cita.duracion_estimada_minutos)
  return `${inicio} – ${fin} (${cita.duracion_estimada_minutos} min)`
}

function Dato({ etiqueta, children }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-60">{etiqueta}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

// Recuadro de una cita: patente, modelo y nombre de la persona a la vista; al
// pincharlo se amplía y muestra el motivo/observaciones y el resto del detalle.
function TarjetaCita({ cita, nombreIsla, expandida, onAlternar, onCambiarEstado, onReagendar }) {
  const [reagendando, setReagendando] = useState(false)
  const [nuevaFecha, setNuevaFecha] = useState(cita.fecha)
  const [nuevaHora, setNuevaHora] = useState(cita.hora ? cita.hora.slice(0, 5) : '')
  const [guardando, setGuardando] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState(null)
  // Solo una cita vigente se puede mover: una completada ya tiene su OT y una
  // cancelada no ocupa lugar.
  const puedeReagendar = Boolean(onReagendar) && (cita.estado === 'agendada' || cita.estado === 'confirmada')

  function abrirReagendar() {
    setNuevaFecha(cita.fecha)
    setNuevaHora(cita.hora ? cita.hora.slice(0, 5) : '')
    setMotivoRechazo(null)
    setReagendando(true)
  }

  async function guardarReagendamiento(evento) {
    evento.preventDefault()
    setGuardando(true)
    setMotivoRechazo(null)
    try {
      const resultado = await onReagendar(cita, nuevaFecha, nuevaHora)
      if (resultado.ok) setReagendando(false)
      else setMotivoRechazo(resultado.motivo)
    } finally {
      setGuardando(false)
    }
  }
  const vehiculo = cita.vehiculos
  const cliente = nombreVisible(cita.clientes) || 'Cliente sin nombre'
  const servicio = cita.catalogo_servicios
  const titulo = vehiculo ? `${formatearPatente(vehiculo.patente)} · ${vehiculo.marca} ${vehiculo.modelo}` : 'Vehículo sin definir'
  const color = COLOR_ESTADO[cita.estado] || COLOR_ESTADO.agendada
  const ordenTrabajo = Array.isArray(cita.trabajos_taller) ? cita.trabajos_taller[0] : cita.trabajos_taller

  return (
    <div className={`rounded border text-left text-[11px] leading-tight ${color}`}>
      <button
        type="button"
        aria-expanded={expandida}
        onClick={() => onAlternar(cita.id)}
        className="block w-full rounded px-1.5 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-deep"
      >
        <span className="flex items-baseline justify-between gap-1">
          <span className="truncate font-semibold">{titulo}</span>
          <span aria-hidden="true" className="shrink-0 text-[11px] opacity-60">
            {expandida ? '−' : '+'}
          </span>
        </span>
        <span className="block truncate">{cliente}</span>
        <span className="block truncate text-[10px] opacity-70">
          {cita.hora ? cita.hora.slice(0, 5) : 'Sin hora'}
          {nombreIsla ? ` · ${nombreIsla}` : ''}
          {cita.estado !== 'agendada' && cita.estado !== 'confirmada' ? ` · ${ETIQUETA_ESTADO[cita.estado] || cita.estado}` : ''}
        </span>
      </button>

      {expandida && (
        <dl className="space-y-1.5 border-t border-black/10 px-1.5 py-1.5">
          <Dato etiqueta="Motivo / observaciones">
            <span className="whitespace-pre-line font-medium">{cita.descripcion || 'Sin observaciones registradas.'}</span>
          </Dato>
          {servicio && (
            <Dato etiqueta="Servicio del catálogo">
              {servicio.categoria} · {servicio.servicio}
            </Dato>
          )}
          <Dato etiqueta="Horario">{horarioDeCita(cita)}</Dato>
          {nombreIsla && <Dato etiqueta="Isla">{nombreIsla}</Dato>}
          <Dato etiqueta="Cliente">
            {cliente}
            {cita.clientes?.telefono && (
              <>
                {' · '}
                <a href={`tel:${cita.clientes.telefono}`} className="underline">
                  {cita.clientes.telefono}
                </a>
              </>
            )}
          </Dato>
          {vehiculo && (
            <Dato etiqueta="Vehículo">
              {formatearPatente(vehiculo.patente)} — {vehiculo.marca} {vehiculo.modelo}
            </Dato>
          )}
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {cita.origen === 'bot_whatsapp' && <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-medium">por WhatsApp</span>}
            {cita.clickup_task_id && <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-medium">en ClickUp</span>}
            {ordenTrabajo?.numero_ot && cita.trabajo_id && (
              <Link to={`/trabajos/${cita.trabajo_id}`} className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-medium underline">
                OT {ordenTrabajo.numero_ot}
              </Link>
            )}
          </div>
          {puedeReagendar && !reagendando && (
            <button
              type="button"
              onClick={abrirReagendar}
              className="rounded border border-current px-2 py-0.5 text-[11px] font-medium hover:bg-white/60"
            >
              Reagendar (cambiar día u hora)
            </button>
          )}
          {reagendando && (
            <form onSubmit={guardarReagendamiento} className="space-y-1.5 rounded border border-slate-200 bg-white p-1.5 text-slate-800">
              <p className="text-[10px] font-semibold uppercase tracking-wide">Nuevo día y hora</p>
              <div className="flex flex-wrap gap-1">
                <input
                  type="date"
                  required
                  min={hoyLocalISO()}
                  value={nuevaFecha}
                  onChange={(evento) => setNuevaFecha(evento.target.value)}
                  aria-label="Nuevo día"
                  className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                />
                <input
                  type="time"
                  required
                  step="900"
                  value={nuevaHora}
                  onChange={(evento) => setNuevaHora(evento.target.value)}
                  aria-label="Nueva hora"
                  className="w-24 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                />
              </div>
              {motivoRechazo && (
                <p role="alert" className="text-[11px] font-medium text-red-700">
                  {motivoRechazo}
                </p>
              )}
              <div className="flex gap-1">
                <button
                  type="submit"
                  disabled={guardando}
                  className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={() => setReagendando(false)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
          {onCambiarEstado && (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Estado</span>
              <select
                value={cita.estado}
                onChange={(evento) => onCambiarEstado(cita.id, evento.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-800"
              >
                {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>
          )}
        </dl>
      )}
    </div>
  )
}

export default TarjetaCita
