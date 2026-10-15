import { diasEntre, hoyLocalISO, nombreVisible, ocupacionDelDia, rangoDeVista } from '../../lib/agenda'
import { formatearPatente } from '../../lib/patente'

const ENCABEZADOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MAX_PATENTES = 6

function claseBarra(pct) {
  if (pct >= 75) return 'bg-red-500'
  if (pct >= 40) return 'bg-amber-500'
  return 'bg-emerald-500'
}

// En el mes solo se ve la patente: no hay espacio para más. El detalle completo
// (hora, modelo, nombre, motivo) queda en el tooltip y en las vistas de semana y día.
function patenteDeCita(cita) {
  return cita.vehiculos ? formatearPatente(cita.vehiculos.patente) : 'Sin patente'
}

function detalleCita(cita) {
  const vehiculo = cita.vehiculos ? `${formatearPatente(cita.vehiculos.patente)} ${cita.vehiculos.marca} ${cita.vehiculos.modelo}` : 'Vehículo sin definir'
  return `${cita.hora ? cita.hora.slice(0, 5) : 'Sin hora'} · ${vehiculo} · ${nombreVisible(cita.clientes)}${cita.descripcion ? ` · ${cita.descripcion}` : ''}`
}

// Mes completo: cada día muestra cuántas citas tiene, qué tan ocupado está y
// las primeras citas (hora, patente y nombre). Pinchar un día abre su detalle.
function VistaMes({ fecha, citas, tiposIsla, horarios, corteMediodia, personal, onElegirDia }) {
  const { desde, hasta } = rangoDeVista('mes', fecha)
  const mesActual = fecha.slice(0, 7)
  const hoy = hoyLocalISO()

  const celdas = diasEntre(desde, hasta).map((dia) => {
    const citasDia = citas.filter((c) => c.fecha === dia)
    const vigentes = citasDia.filter((c) => c.estado === 'agendada' || c.estado === 'confirmada')
    const ocupacion = ocupacionDelDia(dia, citasDia, tiposIsla, horarios, corteMediodia, personal)
    return { fecha: dia, numero: Number(dia.slice(8)), delMes: dia.startsWith(mesActual), esHoy: dia === hoy, citasDia, vigentes, ocupacion }
  })

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-500">
          {ENCABEZADOS.map((nombre) => (
            <div key={nombre} className="px-2 py-1.5">
              {nombre}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {celdas.map((celda) => {
            const { vigentes, ocupacion } = celda
            const abierta = ocupacion.abierto || celda.citasDia.length > 0
            const etiquetaAccesible = `${celda.fecha}: ${vigentes.length} cita${vigentes.length === 1 ? '' : 's'}${
              ocupacion.abierto ? `, ${ocupacion.pctOcupado}% ocupado` : ', el taller no atiende'
            }`

            return (
              <button
                key={celda.fecha}
                type="button"
                onClick={(evento) => onElegirDia(celda.fecha, evento)}
                aria-label={etiquetaAccesible}
                className={`min-h-[104px] border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-deep ${
                  celda.delMes ? 'bg-white' : 'bg-slate-50/60 opacity-60'
                } ${abierta ? '' : 'bg-slate-100/60'}`}
              >
                <span className="flex items-center justify-between">
                  <span
                    className={`grid h-6 min-w-[24px] place-items-center rounded-full px-1 text-xs font-semibold ${
                      celda.esHoy ? 'bg-deep text-white' : 'text-slate-700'
                    }`}
                  >
                    {celda.numero}
                  </span>
                  {vigentes.length > 0 && (
                    <span className="rounded-full bg-deep/10 px-1.5 py-0.5 text-[10px] font-medium text-deep">{vigentes.length}</span>
                  )}
                </span>

                {ocupacion.abierto ? (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full ${claseBarra(ocupacion.pctOcupado)}`} style={{ width: `${ocupacion.pctOcupado}%` }} />
                  </span>
                ) : (
                  <span className="mt-1 block text-[10px] text-slate-400">Cerrado</span>
                )}

                <span className="mt-1 flex flex-wrap gap-0.5">
                  {vigentes.slice(0, MAX_PATENTES).map((cita) => (
                    <span key={cita.id} title={detalleCita(cita)} className="rounded bg-sky-50 px-1 py-0.5 text-[10px] font-medium text-sky-900">
                      {patenteDeCita(cita)}
                    </span>
                  ))}
                  {vigentes.length > MAX_PATENTES && (
                    <span className="px-1 py-0.5 text-[10px] text-slate-500">+{vigentes.length - MAX_PATENTES}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">La barra muestra qué tan ocupado está el día. Pincha un día para ver todo su detalle; al pasar el cursor sobre una patente se ve el resto.</p>
    </div>
  )
}

export default VistaMes
