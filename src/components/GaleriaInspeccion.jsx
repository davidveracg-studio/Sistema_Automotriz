import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { etiquetaSubzona } from '../lib/escaner/zonas'

const BUCKET = 'inspeccion-fotos'

// Fotos de la inspección de ingreso de una OT (bucket privado: URLs firmadas).
function GaleriaInspeccion({ trabajoId, puedeEscanear }) {
  const [fotos, setFotos] = useState([])
  const [urls, setUrls] = useState({})
  const [ampliada, setAmpliada] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      const { data, error: errorFotos } = await supabase
        .from('inspeccion_fotos')
        .select('id, zona, subzona, storage_path, nota, es_dano, tomada_en, usuarios(nombre_completo)')
        .eq('trabajo_id', trabajoId)
        .order('tomada_en', { ascending: true })
      if (cancelado) return
      if (errorFotos) {
        setError(errorFotos.message)
        return
      }
      setFotos(data || [])
      if (data?.length) {
        const { data: firmadas } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(data.map((f) => f.storage_path), 3600)
        if (cancelado) return
        const mapa = {}
        ;(firmadas || []).forEach((f) => {
          if (f.signedUrl) mapa[f.path] = f.signedUrl
        })
        setUrls(mapa)
      }
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [trabajoId])

  return (
    <section className="mb-6 max-w-4xl rounded border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Fotos de inspección {fotos.length > 0 && `(${fotos.length})`}
        </h2>
        {puedeEscanear && (
          <Link
            to={`/trabajos/${trabajoId}/escaner`}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            {fotos.length > 0 ? 'Escanear más' : 'Escanear inspección'}
          </Link>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && fotos.length === 0 && <p className="text-sm text-slate-500">Esta OT aún no tiene fotos de inspección.</p>}
      {fotos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {fotos.map((foto) => (
            <li key={foto.id}>
              <button type="button" onClick={() => setAmpliada(foto)} className="relative block w-full overflow-hidden rounded border border-slate-200">
                {urls[foto.storage_path] ? (
                  <img src={urls[foto.storage_path]} alt={etiquetaSubzona(foto.zona, foto.subzona)} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/3] w-full bg-slate-100" />
                )}
                {foto.es_dano && (
                  <span className="absolute right-1 top-1 rounded bg-red-600 px-1 text-[10px] font-medium text-white">Daño</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          onClick={() => setAmpliada(null)}
          role="presentation"
        >
          <img src={urls[ampliada.storage_path]} alt="" className="max-h-[80vh] max-w-full rounded" />
          <p className="mt-2 text-center text-sm text-white">
            {ampliada.zona === 'exterior' ? 'Exterior' : 'Interior'} · {etiquetaSubzona(ampliada.zona, ampliada.subzona)}
            {ampliada.nota && ` — ${ampliada.nota}`}
            <br />
            <span className="text-xs text-slate-300">
              {new Date(ampliada.tomada_en).toLocaleString('es-CL')} · {ampliada.usuarios?.nombre_completo || 'Sin autor'}
            </span>
          </p>
        </div>
      )}
    </section>
  )
}

export default GaleriaInspeccion
