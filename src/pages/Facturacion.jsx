import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  COLOR_ESTADO_DTE,
  ETIQUETA_ESTADO_DTE,
  ROLES_PUEDEN_EMITIR,
  TIPOS_DTE,
  formatoFechaIso,
  formatoNumero,
} from '../lib/facturacion'

function Facturacion() {
  const { usuario } = useAuth()
  const [documentos, setDocumentos] = useState([])
  const [config, setConfig] = useState(null)
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function cargar() {
      try {
        const [{ data: docs, error: errorDocs }, { data: configuracion, error: errorConfig }] = await Promise.all([
          supabase
            .from('documentos_tributarios')
            .select('id, tipo_dte, estado, folio, simulado, fecha_emision, receptor_razon_social, receptor_rut, monto_total, trabajo_id, trabajos_taller(numero_ot)')
            .order('creado_en', { ascending: false })
            .limit(200),
          supabase.from('facturacion_config').select('proveedor, ambiente, activo').maybeSingle(),
        ])
        if (errorDocs) throw errorDocs
        if (errorConfig) throw errorConfig
        setDocumentos(docs || [])
        setConfig(configuracion)
      } catch (excepcion) {
        setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [])

  const filtrados = documentos.filter(
    (d) => (filtroTipo === 'todos' || String(d.tipo_dte) === filtroTipo) && (filtroEstado === 'todos' || d.estado === filtroEstado)
  )
  const puedeEmitir = ROLES_PUEDEN_EMITIR.includes(usuario?.rol)

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Facturación electrónica</h1>
        {puedeEmitir && (
          <Link to="/facturacion/nuevo" className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Nuevo documento
          </Link>
        )}
      </div>

      {config?.proveedor === 'sandbox' && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Modo de simulación: los documentos que se emitan aquí <strong>no tienen validez tributaria</strong> ni se envían al SII.
          Se usa para probar el flujo hasta conectar un proveedor de facturación electrónica.
        </p>
      )}
      {config && !config.activo && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">La facturación electrónica está desactivada para esta empresa.</p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPOS_DTE).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="todos">Todos los estados</option>
          {Object.entries(ETIQUETA_ESTADO_DTE).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Documento</th>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Receptor</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">OT</th>
            </tr>
          </thead>
          <tbody>
            {!cargando &&
              filtrados.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-600">{formatoFechaIso(d.fecha_emision)}</td>
                  <td className="px-3 py-2">
                    <Link to={`/facturacion/${d.id}`} className="text-slate-900 underline hover:text-slate-700">
                      {TIPOS_DTE[d.tipo_dte]}
                    </Link>
                    {d.simulado && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">SIMULADO</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{d.folio ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-800">
                    {d.receptor_razon_social || <span className="text-slate-400">Sin receptor</span>}
                    {d.receptor_rut && <p className="text-xs text-slate-400">{d.receptor_rut}</p>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-800">${formatoNumero(d.monto_total)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_DTE[d.estado] || ''}`}>{ETIQUETA_ESTADO_DTE[d.estado] || d.estado}</span>
                  </td>
                  <td className="px-3 py-2">
                    {d.trabajo_id && (
                      <Link to={`/trabajos/${d.trabajo_id}`} className="text-xs text-slate-500 underline hover:text-slate-700">
                        OT {d.trabajos_taller?.numero_ot}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            {!cargando && filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Sin documentos para este filtro.
                </td>
              </tr>
            )}
            {cargando && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Facturacion
