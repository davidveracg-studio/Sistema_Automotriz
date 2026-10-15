import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { textoPorcentaje } from '../lib/descuento'

const ROLES_QUE_NEGOCIAN = ['asesor', 'admin', 'socia']
const ROLES_QUE_AUTORIZAN = ['admin', 'socia']
const ETIQUETA_ESTADO = { aplicado: 'Aplicado', pendiente: 'Pendiente de autorización', rechazado: 'Rechazado' }
const COLOR_ESTADO = { aplicado: 'text-emerald-700', pendiente: 'text-amber-700', rechazado: 'text-red-700' }

function formatoMoneda(numero) {
  return `$${Math.round(numero).toLocaleString('es-CL')}`
}

// Descuento comercial sobre la mano de obra de la OT (0051_descuento_mano_obra.sql).
// El asesor aplica hasta el límite de la empresa (política interna); más que eso
// queda pendiente y lo autoriza administración (admin o socia).
function DescuentoManoObra({ incrustado = false, trabajoId, empresaId, porcentajeVigente, subtotalManoObra, bloqueada, rol, onCambio }) {
  const [limite, setLimite] = useState(15)
  const [historial, setHistorial] = useState([])
  const [porcentaje, setPorcentaje] = useState('')
  const [motivo, setMotivo] = useState('')
  const [notaResolucion, setNotaResolucion] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)

  const puedeNegociar = ROLES_QUE_NEGOCIAN.includes(rol)
  const puedeAutorizar = ROLES_QUE_AUTORIZAN.includes(rol)

  const cargar = useCallback(async () => {
    try {
      const [respLimite, respHistorial] = await Promise.all([
        supabase.from('empresas').select('descuento_max_asesor_pct').eq('id', empresaId).maybeSingle(),
        supabase
          .from('descuentos_ot')
          .select(
            'id, porcentaje, motivo, estado, nota, creado_en, resuelto_en, solicitante:usuarios!descuentos_ot_solicitado_por_fkey(nombre_completo), resolutor:usuarios!descuentos_ot_resuelto_por_fkey(nombre_completo)'
          )
          .eq('trabajo_id', trabajoId)
          .order('creado_en', { ascending: false })
          .limit(8),
      ])
      if (respLimite.data?.descuento_max_asesor_pct != null) setLimite(Number(respLimite.data.descuento_max_asesor_pct))
      if (respHistorial.error) throw respHistorial.error
      setHistorial(respHistorial.data || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cargar el historial de descuentos.')
    }
  }, [trabajoId, empresaId])

  useEffect(() => {
    cargar()
  }, [cargar, porcentajeVigente])

  const uno = (valor) => (Array.isArray(valor) ? valor[0] : valor)
  const pendiente = historial.find((fila) => fila.estado === 'pendiente')
  const numero = porcentaje === '' ? null : Number(porcentaje)
  const superaLimite = rol === 'asesor' && numero != null && numero > limite

  async function enviar(evento, porcentajeAEnviar, motivoAEnviar) {
    evento?.preventDefault()
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const { data, error: errorRpc } = await supabase.rpc('ot_descuento_mano_obra_solicitar', {
        p_trabajo_id: trabajoId,
        p_porcentaje: porcentajeAEnviar,
        p_motivo: motivoAEnviar,
      })
      if (errorRpc) throw errorRpc
      setAviso(
        data === 'pendiente'
          ? 'Solicitud enviada: administración la revisará y te avisará.'
          : porcentajeAEnviar > 0
            ? `Descuento de ${textoPorcentaje(porcentajeAEnviar)}% aplicado a la mano de obra.`
            : 'Descuento quitado.'
      )
      setPorcentaje('')
      setMotivo('')
      await cargar()
      onCambio()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo guardar el descuento. Revisa la conexión e intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  async function resolver(descuentoId, aprobar) {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const { error: errorRpc } = await supabase.rpc('ot_descuento_mano_obra_resolver', {
        p_descuento_id: descuentoId,
        p_aprobar: aprobar,
        p_nota: notaResolucion || null,
      })
      if (errorRpc) throw errorRpc
      setAviso(aprobar ? 'Descuento autorizado y aplicado.' : 'Solicitud rechazada.')
      setNotaResolucion('')
      await cargar()
      onCambio()
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo resolver la solicitud.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className={incrustado ? 'mt-4 border-t border-slate-200 pt-3' : 'mt-8 max-w-4xl'}>
      <h2 className={`mb-1 font-semibold text-slate-900 ${incrustado ? 'text-base' : 'text-lg'}`}>Descuento en mano de obra</h2>
      <p className="mb-2 text-sm text-slate-500">
        Solo aplica a la mano de obra. El asesor puede llegar hasta {textoPorcentaje(limite)}%; un descuento mayor lo autoriza administración.
      </p>

      <div className="rounded border border-slate-200 bg-white p-3 text-sm">
        <p className="text-slate-800">
          Vigente: <span className="font-semibold">{textoPorcentaje(porcentajeVigente)}%</span>
          {Number(porcentajeVigente) > 0 && subtotalManoObra > 0 && (
            <span className="text-slate-500"> (rebaja {formatoMoneda((subtotalManoObra * Number(porcentajeVigente)) / 100)} sobre {formatoMoneda(subtotalManoObra)} de mano de obra)</span>
          )}
        </p>

        {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {aviso && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">{aviso}</p>}

        {pendiente && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="font-medium">
              Solicitud pendiente: {textoPorcentaje(pendiente.porcentaje)}% · pedida por {uno(pendiente.solicitante)?.nombre_completo || 'el asesor'}
            </p>
            <p className="mt-0.5">Motivo: {pendiente.motivo}</p>
            {puedeAutorizar && !bloqueada && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={notaResolucion}
                  onChange={(evento) => setNotaResolucion(evento.target.value)}
                  placeholder="Comentario (opcional)"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-800"
                />
                <button type="button" disabled={ocupado} onClick={() => resolver(pendiente.id, true)} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  Autorizar
                </button>
                <button type="button" disabled={ocupado} onClick={() => resolver(pendiente.id, false)} className="rounded border border-red-300 bg-white px-3 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Rechazar
                </button>
              </div>
            )}
            {!puedeAutorizar && <p className="mt-1 text-xs">Mientras tanto el documento sigue con el descuento vigente.</p>}
          </div>
        )}

        {puedeNegociar && !bloqueada && (
          <form onSubmit={(evento) => enviar(evento, numero, motivo)} className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Porcentaje</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                required
                value={porcentaje}
                onChange={(evento) => setPorcentaje(evento.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-800"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Motivo o criterio de la negociación</span>
              <input
                type="text"
                required={numero > 0}
                maxLength={200}
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-800"
              />
            </label>
            <button type="submit" disabled={ocupado || numero == null} className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {superaLimite ? 'Pedir autorización' : 'Aplicar'}
            </button>
            {superaLimite && (
              <p className="text-xs text-amber-700 sm:col-span-3">
                Supera tu límite de {textoPorcentaje(limite)}%: se enviará a administración para autorizar.
              </p>
            )}
          </form>
        )}
        {puedeNegociar && !bloqueada && Number(porcentajeVigente) > 0 && (
          <button type="button" disabled={ocupado} onClick={() => enviar(null, 0, null)} className="mt-2 text-xs text-slate-500 underline hover:text-red-600">
            Quitar el descuento vigente
          </button>
        )}
        {bloqueada && <p className="mt-2 text-xs text-slate-500">La OT está cerrada: el descuento ya no se puede cambiar.</p>}

        {historial.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {historial.map((fila) => (
                <li key={fila.id}>
                  <span className={`font-medium ${COLOR_ESTADO[fila.estado]}`}>{ETIQUETA_ESTADO[fila.estado]}</span> · {textoPorcentaje(fila.porcentaje)}%
                  {fila.motivo ? ` · ${fila.motivo}` : ''} · {uno(fila.solicitante)?.nombre_completo || '—'}
                  {fila.estado !== 'pendiente' && uno(fila.resolutor)?.nombre_completo && uno(fila.resolutor).nombre_completo !== uno(fila.solicitante)?.nombre_completo
                    ? ` (resolvió ${uno(fila.resolutor).nombre_completo})`
                    : ''}
                  {fila.nota ? ` · ${fila.nota}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

export default DescuentoManoObra
