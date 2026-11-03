import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { analizarFotos } from '../lib/inspeccionIa'
import { ETIQUETA_SEVERIDAD, ETIQUETA_TIPO_DANO } from '../lib/escaner/inventario'
import { BUCKET_INSPECCION } from '../lib/escaner/subida'
import { etiquetaSubzona } from '../lib/escaner/zonas'
import InventarioInspeccion from './InventarioInspeccion'

// Fotos de la inspección de ingreso de una OT (bucket privado: URLs firmadas),
// con análisis por IA (daños e inventario sugerido) y borrado de fotos.
function GaleriaInspeccion({ trabajoId, puedeEscanear }) {
  const location = useLocation()
  const analisisAutomatico = useRef(Boolean(location.state?.analizar))

  const [fotos, setFotos] = useState([])
  const [urls, setUrls] = useState({})
  const [ampliada, setAmpliada] = useState(null)
  const [error, setError] = useState(null)
  const [progreso, setProgreso] = useState(null) // { hechas, total } mientras analiza
  const [aviso, setAviso] = useState(null)

  const ejecutarAnalisis = useCallback(
    async (ids) => {
      if (ids.length === 0) return
      setError(null)
      setAviso(null)
      setProgreso({ hechas: 0, total: ids.length })
      try {
        const { analizadas, errores } = await analizarFotos(trabajoId, ids, setProgreso)
        setAviso(
          errores.length > 0
            ? `Se analizaron ${analizadas} foto(s); ${errores.length} fallaron (${errores[0].mensaje}). Puedes reintentar.`
            : `Se analizaron ${analizadas} foto(s).`
        )
      } catch (e) {
        setError(e.message)
      } finally {
        setProgreso(null)
      }
    },
    [trabajoId]
  )

  const cargar = useCallback(async () => {
    const { data, error: errorFotos } = await supabase
      .from('inspeccion_fotos')
      .select(
        'id, zona, subzona, storage_path, nota, es_dano, tomada_en, inventario_sugerido, danos_detectados, analizado_en, analisis_error, usuarios(nombre_completo)'
      )
      .eq('trabajo_id', trabajoId)
      .order('tomada_en', { ascending: true })
    if (errorFotos) {
      setError(errorFotos.message)
      return []
    }
    setFotos(data || [])
    if (data?.length) {
      const { data: firmadas } = await supabase.storage.from(BUCKET_INSPECCION).createSignedUrls(
        data.map((f) => f.storage_path),
        3600
      )
      const mapa = {}
      ;(firmadas || []).forEach((f) => {
        if (f.signedUrl) mapa[f.path] = f.signedUrl
      })
      setUrls(mapa)
    }
    return data || []
  }, [trabajoId])

  useEffect(() => {
    let cancelado = false
    async function iniciar() {
      const cargadas = await cargar()
      if (cancelado) return
      // Al venir del escáner se analiza solo, una vez.
      if (analisisAutomatico.current && puedeEscanear) {
        analisisAutomatico.current = false
        await ejecutarAnalisis(cargadas.filter((f) => !f.analizado_en).map((f) => f.id))
        if (!cancelado) await cargar()
      }
    }
    iniciar()
    return () => {
      cancelado = true
    }
  }, [cargar, ejecutarAnalisis, puedeEscanear])

  async function analizarPendientes() {
    await ejecutarAnalisis(fotos.filter((f) => !f.analizado_en).map((f) => f.id))
    await cargar()
  }

  function actualizarFotoLocal(fotoId, cambios) {
    setFotos((previas) => previas.map((f) => (f.id === fotoId ? { ...f, ...cambios } : f)))
  }

  async function eliminar(foto) {
    if (!window.confirm('¿Eliminar esta foto de la inspección? No se puede deshacer.')) return
    setError(null)
    const { error: errorBorrado } = await supabase.from('inspeccion_fotos').delete().eq('id', foto.id)
    if (errorBorrado) {
      setError(errorBorrado.message)
      return
    }
    // El archivo se borra después; si falla, solo queda un objeto huérfano.
    await supabase.storage.from(BUCKET_INSPECCION).remove([foto.storage_path])
    setAmpliada(null)
    setFotos((previas) => previas.filter((f) => f.id !== foto.id))
  }

  const pendientes = fotos.filter((f) => !f.analizado_en).length
  const totalDanos = fotos.reduce((suma, f) => suma + (f.danos_detectados?.length || 0), 0)

  return (
    <section className="mb-6 max-w-4xl rounded-2xl bg-white p-4 shadow-mm print:shadow-none">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Fotos de inspección {fotos.length > 0 && `(${fotos.length})`}
        </h2>
        {puedeEscanear && (
          <div className="flex gap-2">
            {pendientes > 0 && (
              <button
                type="button"
                onClick={analizarPendientes}
                disabled={Boolean(progreso)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {progreso ? `Analizando ${progreso.hechas}/${progreso.total}…` : `Analizar con IA (${pendientes})`}
              </button>
            )}
            <Link
              to={`/trabajos/${trabajoId}/escaner`}
              className="rounded-lg bg-brand-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-deep"
            >
              {fotos.length > 0 ? 'Escanear más' : 'Escanear inspección'}
            </Link>
          </div>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mb-2 text-sm text-slate-600">{aviso}</p>}
      {progreso && !puedeEscanear && <p className="mb-2 text-sm text-slate-500">Analizando…</p>}
      {totalDanos > 0 && (
        <p className="mb-2 text-sm text-amber-800">
          La IA detectó {totalDanos} posible(s) daño(s). Ábrelas para verlas marcadas; es una ayuda, confírmalo en el vehículo.
        </p>
      )}
      {!error && fotos.length === 0 && <p className="text-sm text-slate-500">Esta OT aún no tiene fotos de inspección.</p>}

      {fotos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {fotos.map((foto) => (
            <li key={foto.id}>
              <button
                type="button"
                onClick={() => setAmpliada(foto)}
                className="relative block w-full overflow-hidden rounded-xl border border-slate-200"
              >
                {urls[foto.storage_path] ? (
                  <img src={urls[foto.storage_path]} alt={etiquetaSubzona(foto.zona, foto.subzona)} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="aspect-[4/3] w-full bg-slate-100" />
                )}
                {foto.es_dano && (
                  <span className="absolute right-1 top-1 rounded bg-red-600 px-1 text-[10px] font-medium text-white">Daño</span>
                )}
                {foto.danos_detectados?.length > 0 && (
                  <span className="absolute bottom-1 right-1 rounded bg-amber-600 px-1 text-[10px] font-medium text-white">
                    IA: {foto.danos_detectados.length}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <InventarioInspeccion trabajoId={trabajoId} fotos={fotos} puedeEditar={puedeEscanear} onFotoActualizada={actualizarFotoLocal} />

      {ampliada && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-black/80 p-4"
          onClick={() => setAmpliada(null)}
          role="presentation"
        >
          <div className="relative inline-block" onClick={(e) => e.stopPropagation()} role="presentation">
            <img src={urls[ampliada.storage_path]} alt="" className="block max-h-[70vh] max-w-full rounded" />
            {(ampliada.danos_detectados || []).map((dano, indice) => (
              <div
                key={indice}
                title={dano.descripcion}
                className="pointer-events-none absolute rounded-sm border-2 border-amber-400 bg-amber-400/10"
                style={{
                  left: `${dano.caja.x * 100}%`,
                  top: `${dano.caja.y * 100}%`,
                  width: `${dano.caja.ancho * 100}%`,
                  height: `${dano.caja.alto * 100}%`,
                }}
              />
            ))}
          </div>
          <div className="mt-2 max-w-xl text-center text-sm text-white" onClick={(e) => e.stopPropagation()} role="presentation">
            <p>
              {ampliada.zona === 'exterior' ? 'Exterior' : 'Interior'} · {etiquetaSubzona(ampliada.zona, ampliada.subzona)}
              {ampliada.nota && ` — ${ampliada.nota}`}
            </p>
            <p className="text-xs text-slate-300">
              {new Date(ampliada.tomada_en).toLocaleString('es-CL')} · {ampliada.usuarios?.nombre_completo || 'Sin autor'}
            </p>
            {(ampliada.danos_detectados || []).length > 0 && (
              <ul className="mt-2 space-y-0.5 text-left text-xs text-amber-200">
                {ampliada.danos_detectados.map((dano, indice) => (
                  <li key={indice}>
                    ▢ {ETIQUETA_TIPO_DANO[dano.tipo] || dano.tipo} ({ETIQUETA_SEVERIDAD[dano.severidad] || dano.severidad}): {dano.descripcion}
                  </li>
                ))}
              </ul>
            )}
            {ampliada.analisis_error && <p className="mt-1 text-xs text-red-300">Error de análisis: {ampliada.analisis_error}</p>}
            <div className="mt-3 flex justify-center gap-2">
              {puedeEscanear && (
                <button
                  type="button"
                  onClick={() => eliminar(ampliada)}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-200 hover:bg-red-900/40"
                >
                  Eliminar foto
                </button>
              )}
              <button
                type="button"
                onClick={() => setAmpliada(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default GaleriaInspeccion
