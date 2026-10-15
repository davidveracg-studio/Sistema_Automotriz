import { diasEntre, etiquetaDiaCorta, hoyLocalISO, mejoresMomentos, ocupacionDelDia, rangoDeVista } from '../../lib/agenda'
import TarjetaCita from './TarjetaCita'

// Color de una celda del mapa de disponibilidad según cuántos puestos quedan libres.
function claseDisponibilidad(libres, total) {
  if (total === 0) return 'bg-slate-100 text-slate-400'
  const proporcion = libres / total
  if (libres === 0) return 'bg-red-100 font-semibold text-red-800'
  if (proporcion >= 0.6) return 'bg-emerald-50 text-emerald-800'
  if (proporcion >= 0.3) return 'bg-amber-50 text-amber-800'
  return 'bg-red-50 text-red-700'
}

function claseBarra(pct) {
  if (pct >= 75) return 'bg-red-500'
  if (pct >= 40) return 'bg-amber-500'
  return 'bg-emerald-500'
}

// Semana completa: una columna por día con sus citas (patente, modelo y nombre,
// desplegables) y, abajo, un mapa de disponibilidad por bloque de 30 minutos
// para ver de un vistazo cuándo conviene atender a un cliente.
function VistaSemana({ fecha, citas, tiposIsla, horarios, corteMediodia, personal, expandidas, onAlternar, onCambiarEstado, onReagendar, onElegirDia }) {
  const { desde, hasta } = rangoDeVista('semana', fecha)
  const hoy = hoyLocalISO()

  const todosLosDias = diasEntre(desde, hasta).map((dia) => {
    const citasDia = citas.filter((c) => c.fecha === dia)
    const ocupacion = ocupacionDelDia(dia, citasDia, tiposIsla, horarios, corteMediodia, personal)
    return { dia, citasDia, ocupacion }
  })
  // Un día en que el taller no atiende (el domingo) solo aparece si tiene citas.
  const dias = todosLosDias.filter((d) => d.ocupacion.abierto || d.citasDia.length > 0)

  const ocupacionPorDia = Object.fromEntries(dias.filter((d) => d.dia >= hoy).map((d) => [d.dia, d.ocupacion]))
  const mejores = mejoresMomentos(ocupacionPorDia, 3)

  const horasDelMapa = [...new Set(dias.flatMap((d) => d.ocupacion.bloques.map((b) => b.bloque)))].sort()
  const nombreIsla = (id) => tiposIsla.find((isla) => isla.id === id)?.nombre
  const tarjeta = (cita) => (
    <TarjetaCita
      key={cita.id}
      cita={cita}
      nombreIsla={nombreIsla(cita.tipo_isla_id)}
      expandida={expandidas.has(cita.id)}
      onAlternar={onAlternar}
      onCambiarEstado={onCambiarEstado}
      onReagendar={onReagendar}
    />
  )

  return (
    <div className="space-y-6">
      {mejores.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">Más disponibilidad:</span>
          {mejores.map((m) => (
            <button
              key={`${m.fecha}-${m.bloque}`}
              type="button"
              onClick={(evento) => onElegirDia(m.fecha, evento)}
              className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              {etiquetaDiaCorta(m.fecha)} · {m.bloque} · {m.libres}/{m.total} libres
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${dias.length}, minmax(190px, 1fr))` }}>
          {dias.map(({ dia, citasDia, ocupacion }) => {
            const vigentes = citasDia.filter((c) => c.estado === 'agendada' || c.estado === 'confirmada').length
            return (
              <section
                key={dia}
                aria-label={etiquetaDiaCorta(dia)}
                className={`rounded-lg border bg-white ${dia === hoy ? 'border-deep ring-1 ring-deep' : 'border-slate-200'}`}
              >
                <button
                  type="button"
                  onClick={(evento) => onElegirDia(dia, evento)}
                  className="block w-full rounded-t-lg border-b border-slate-100 px-2.5 py-2 text-left hover:bg-slate-50"
                >
                  <span className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold capitalize text-slate-900">{etiquetaDiaCorta(dia)}</span>
                    <span className="text-[11px] text-slate-500">
                      {vigentes} cita{vigentes === 1 ? '' : 's'}
                    </span>
                  </span>
                  {ocupacion.abierto ? (
                    <>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <span className={`block h-full ${claseBarra(ocupacion.pctOcupado)}`} style={{ width: `${ocupacion.pctOcupado}%` }} />
                      </span>
                      <span className="mt-0.5 block text-[10px] text-slate-500">{ocupacion.pctOcupado}% ocupado</span>
                    </>
                  ) : (
                    <span className="mt-1 block text-[10px] text-slate-400">El taller no atiende</span>
                  )}
                </button>

                <div className="space-y-1.5 p-1.5">
                  {citasDia.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-slate-400">Sin citas</p>
                  ) : (
                    citasDia.map(tarjeta)
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      {horasDelMapa.length > 0 && (
        <section aria-label="Mapa de disponibilidad">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Disponibilidad por horario</h2>
          <p className="mb-2 text-xs text-slate-500">
            Puestos libres sobre el total de todas las islas en cada bloque de 30 minutos. Pincha un horario para ver ese día en detalle.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-left font-medium text-slate-500">Hora</th>
                  {dias.map(({ dia }) => (
                    <th key={dia} className="border-l border-slate-100 bg-slate-50 px-2 py-1.5 text-center font-medium capitalize text-slate-700">
                      {etiquetaDiaCorta(dia)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {horasDelMapa.map((hora) => (
                  <tr key={hora}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-0.5 text-slate-500">{hora}</td>
                    {dias.map(({ dia, ocupacion }) => {
                      const bloque = ocupacion.bloques.find((b) => b.bloque === hora)
                      if (!bloque) {
                        return (
                          <td key={dia} className="border-l border-slate-100 bg-slate-50 px-1 py-0.5 text-center text-slate-300">
                            —
                          </td>
                        )
                      }
                      return (
                        <td key={dia} className="border-l border-slate-100 p-0.5 text-center">
                          <button
                            type="button"
                            onClick={(evento) => onElegirDia(dia, evento)}
                            title={`${etiquetaDiaCorta(dia)} ${hora}: ${bloque.libres} de ${bloque.total} puestos libres`}
                            className={`block w-full rounded px-1 py-0.5 ${claseDisponibilidad(bloque.libres, bloque.total)}`}
                          >
                            {bloque.libres}/{bloque.total}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-emerald-200" /> Mucha disponibilidad
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-amber-200" /> Media
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded bg-red-200" /> Poca o ninguna
            </span>
            <span>Los días en que el taller no atiende solo aparecen si tienen citas.</span>
          </div>
        </section>
      )}
    </div>
  )
}

export default VistaSemana
