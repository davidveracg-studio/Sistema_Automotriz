import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { CATEGORIAS_INVENTARIO } from '../lib/escaner/inventario'
import { BUCKET_INSPECCION } from '../lib/escaner/subida'
import { etiquetaSubzona } from '../lib/escaner/zonas'

const MAX_FOTOS_IMPRESAS = 8

// Parte de la orden de ingreso: inventario confirmado y fotos de daños/
// detalles marcados. No muestra nada si la OT no tiene fotos ni inventario.
function ResumenInspeccion({ trabajoId }) {
  const [inventario, setInventario] = useState([])
  const [fotos, setFotos] = useState([])
  const [urls, setUrls] = useState({})

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      const [{ data: items }, { data: fotosDano }] = await Promise.all([
        supabase.from('inspeccion_inventario').select('id, nombre, categoria, cantidad').eq('trabajo_id', trabajoId).order('creado_en'),
        supabase
          .from('inspeccion_fotos')
          .select('id, zona, subzona, nota, storage_path')
          .eq('trabajo_id', trabajoId)
          .eq('es_dano', true)
          .order('tomada_en')
          .limit(MAX_FOTOS_IMPRESAS),
      ])
      if (cancelado) return
      setInventario(items || [])
      setFotos(fotosDano || [])
      if (fotosDano?.length) {
        const { data: firmadas } = await supabase.storage.from(BUCKET_INSPECCION).createSignedUrls(
          fotosDano.map((f) => f.storage_path),
          3600
        )
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

  if (inventario.length === 0 && fotos.length === 0) return null

  return (
    <>
      {inventario.length > 0 && (
        <div className="mb-3 border-b border-slate-300 pb-3">
          <p className="mb-1 font-bold">Inventario del vehículo:</p>
          <ul className="grid grid-cols-2 gap-x-4 text-xs">
            {inventario.map((item) => (
              <li key={item.id}>
                • {item.cantidad > 1 && `${item.cantidad} × `}
                {item.nombre} <span className="text-slate-500">({CATEGORIAS_INVENTARIO[item.categoria] || item.categoria})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fotos.length > 0 && (
        <div className="mb-3 border-b border-slate-300 pb-3">
          <p className="mb-1 font-bold">Fotos de daños/detalles al ingreso:</p>
          <ul className="grid grid-cols-4 gap-2">
            {fotos.map((foto) => (
              <li key={foto.id} className="text-[10px] leading-tight">
                {urls[foto.storage_path] && <img src={urls[foto.storage_path]} alt="" className="aspect-[4/3] w-full rounded border border-slate-300 object-cover" />}
                <span className="text-slate-600">
                  {etiquetaSubzona(foto.zona, foto.subzona)}
                  {foto.nota && ` — ${foto.nota}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export default ResumenInspeccion
