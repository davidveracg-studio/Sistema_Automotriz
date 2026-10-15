import { diasEntre, hoyLocalISO, ocupacionDelDia, primerDiaDelMes, sumarMeses, ultimoDiaDelMes, lunesDe } from '../../lib/agenda'

const LETRAS_DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

// Color de un día según la ocupación; sin citas queda sin color.
function claseDia(celda) {
  if (!celda.ocupacion.abierto && celda.vigentes === 0) return 'text-slate-300'
  if (celda.vigentes === 0) return 'text-slate-600'
  if (celda.ocupacion.pctOcupado >= 75) return 'bg-red-200 font-semibold text-red-800'
  if (celda.ocupacion.pctOcupado >= 40) return 'bg-amber-200 font-semibold text-amber-900'
  return 'bg-emerald-100 font-semibold text-emerald-900'
}

// Año completo: doce meses pequeños, cada día coloreado según qué tan ocupado
// está. Sirve para ver de un vistazo las semanas cargadas y las tranquilas.
function VistaAnio({ fecha, citas, tiposIsla, horarios, corteMediodia, personal, onElegirDia, onElegirMes }) {
  const anio = fecha.slice(0, 4)
  const hoy = hoyLocalISO()

  const porFecha = new Map()
  for (const cita of citas) {
    if (!porFecha.has(cita.fecha)) porFecha.set(cita.fecha, [])
    porFecha.get(cita.fecha).push(cita)
  }

  const meses = Array.from({ length: 12 }, (_, indice) => {
    const primero = sumarMeses(`${anio}-01-01`, indice)
    const desde = lunesDe(primerDiaDelMes(primero))
    const hasta = ultimoDiaDelMes(primero)
    const nombre = new Date(Number(anio), indice, 1).toLocaleDateString('es-CL', { month: 'long' })
    const celdas = diasEntre(desde, hasta).map((dia) => {
      const citasDia = porFecha.get(dia) || []
      const vigentes = citasDia.filter((c) => c.estado === 'agendada' || c.estado === 'confirmada').length
      return {
        fecha: dia,
        numero: Number(dia.slice(8)),
        delMes: dia.startsWith(primero.slice(0, 7)),
        esHoy: dia === hoy,
        vigentes,
        ocupacion: ocupacionDelDia(dia, citasDia, tiposIsla, horarios, corteMediodia, personal),
      }
    })
    const totalCitas = celdas.filter((c) => c.delMes).reduce((suma, c) => suma + c.vigentes, 0)
    return { clave: primero, nombre, celdas, totalCitas }
  })

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {meses.map((mes) => (
          <section key={mes.clave} aria-label={mes.nombre} className="rounded-lg border border-slate-200 bg-white p-2.5">
            <button
              type="button"
              onClick={(evento) => onElegirMes(mes.clave, evento)}
              className="mb-1.5 flex w-full items-baseline justify-between rounded px-1 text-left hover:bg-slate-50"
            >
              <span className="text-sm font-semibold capitalize text-slate-900">{mes.nombre}</span>
              <span className="text-[11px] text-slate-500">
                {mes.totalCitas} cita{mes.totalCitas === 1 ? '' : 's'}
              </span>
            </button>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-400">
              {LETRAS_DIAS.map((letra, indice) => (
                <span key={`${mes.clave}-${indice}`}>{letra}</span>
              ))}
            </div>
            <div className="mt-0.5 grid grid-cols-7 gap-0.5">
              {mes.celdas.map((celda) =>
                celda.delMes ? (
                  <button
                    key={celda.fecha}
                    type="button"
                    onClick={(evento) => onElegirDia(celda.fecha, evento)}
                    title={`${celda.fecha}: ${celda.vigentes} cita${celda.vigentes === 1 ? '' : 's'}${
                      celda.ocupacion.abierto ? `, ${celda.ocupacion.pctOcupado}% ocupado` : ', el taller no atiende'
                    }`}
                    className={`grid h-6 place-items-center rounded text-[10px] hover:ring-1 hover:ring-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-deep ${claseDia(celda)} ${
                      celda.esHoy ? 'ring-2 ring-deep' : ''
                    }`}
                  >
                    {celda.numero}
                  </button>
                ) : (
                  <span key={celda.fecha} className="h-6" />
                )
              )}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-emerald-200" /> Poca ocupación
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-amber-200" /> Media
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded bg-red-200" /> Alta
        </span>
        <span>Pincha un mes o un día para acercarte.</span>
      </div>
    </div>
  )
}

export default VistaAnio
