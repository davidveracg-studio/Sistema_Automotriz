import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { CATEGORIAS_INVENTARIO, normalizarNombre } from '../lib/escaner/inventario'

// Inventario del vehículo al ingreso. Lo que sugiere la IA (en las fotos de
// interior) NO es inventario hasta que una persona lo acepta; también se puede
// agregar a mano. Lo confirmado es lo que se imprime en la orden de ingreso.
function InventarioInspeccion({ trabajoId, fotos, puedeEditar, onFotoActualizada }) {
  const { usuario } = useAuth()
  const [confirmados, setConfirmados] = useState([])
  const [error, setError] = useState(null)
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('otros')
  const [cantidad, setCantidad] = useState(1)

  const cargar = useCallback(async () => {
    const { data, error: errorCarga } = await supabase
      .from('inspeccion_inventario')
      .select('id, nombre, categoria, cantidad, origen, foto_id')
      .eq('trabajo_id', trabajoId)
      .order('creado_en', { ascending: true })
    if (errorCarga) setError(errorCarga.message)
    else setConfirmados(data || [])
  }, [trabajoId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const sugerencias = useMemo(() => {
    const yaConfirmados = new Set(confirmados.map((c) => normalizarNombre(c.nombre)))
    const vistas = new Set()
    const lista = []
    fotos.forEach((foto) => {
      ;(foto.inventario_sugerido || []).forEach((objeto, indice) => {
        const clave = normalizarNombre(objeto.nombre)
        if (yaConfirmados.has(clave) || vistas.has(clave)) return
        vistas.add(clave)
        lista.push({ fotoId: foto.id, indice, objeto })
      })
    })
    return lista
  }, [fotos, confirmados])

  async function insertar(fila) {
    setError(null)
    const { data, error: errorInsert } = await supabase
      .from('inspeccion_inventario')
      .insert({
        empresa_id: usuario.empresa_id,
        trabajo_id: trabajoId,
        creado_por: usuario.id,
        ...fila,
      })
      .select('id, nombre, categoria, cantidad, origen, foto_id')
      .single()
    if (errorInsert) {
      setError(errorInsert.message)
      return false
    }
    setConfirmados((previos) => [...previos, data])
    return true
  }

  function aceptar({ fotoId, objeto }) {
    return insertar({
      foto_id: fotoId,
      nombre: objeto.nombre,
      categoria: objeto.categoria,
      cantidad: objeto.cantidad || 1,
      origen: 'sugerido_ia',
    })
  }

  async function descartar({ fotoId, indice }) {
    const foto = fotos.find((f) => f.id === fotoId)
    const restantes = (foto?.inventario_sugerido || []).filter((_, i) => i !== indice)
    const { error: errorUpdate } = await supabase.from('inspeccion_fotos').update({ inventario_sugerido: restantes }).eq('id', fotoId)
    if (errorUpdate) {
      setError(errorUpdate.message)
      return
    }
    onFotoActualizada(fotoId, { inventario_sugerido: restantes })
  }

  async function agregarManual(evento) {
    evento.preventDefault()
    if (!nombre.trim()) return
    const exito = await insertar({ nombre: nombre.trim(), categoria, cantidad: Number(cantidad) || 1, origen: 'manual' })
    if (exito) {
      setNombre('')
      setCantidad(1)
    }
  }

  async function quitar(id) {
    const { error: errorDelete } = await supabase.from('inspeccion_inventario').delete().eq('id', id)
    if (errorDelete) setError(errorDelete.message)
    else setConfirmados((previos) => previos.filter((c) => c.id !== id))
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Inventario del vehículo</h3>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

      {confirmados.length > 0 ? (
        <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
          {confirmados.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-slate-800">
                {item.cantidad > 1 && `${item.cantidad} × `}
                {item.nombre}{' '}
                <span className="text-xs text-slate-400">
                  · {CATEGORIAS_INVENTARIO[item.categoria] || item.categoria}
                  {item.origen === 'sugerido_ia' && ' · sugerido por IA'}
                </span>
              </span>
              {puedeEditar && (
                <button type="button" onClick={() => quitar(item.id)} className="text-xs text-red-700 hover:underline">
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-500">Aún no hay inventario confirmado.</p>
      )}

      {puedeEditar && sugerencias.length > 0 && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium text-amber-900">
            La IA detectó estos objetos en las fotos del interior. Confirma solo los que realmente están en el vehículo.
          </p>
          <ul className="space-y-1 text-sm">
            {sugerencias.map((sugerencia) => (
              <li key={`${sugerencia.fotoId}-${sugerencia.indice}`} className="flex items-center justify-between gap-2">
                <span className="text-slate-800">
                  {sugerencia.objeto.cantidad > 1 && `${sugerencia.objeto.cantidad} × `}
                  {sugerencia.objeto.nombre}{' '}
                  <span className="text-xs text-slate-500">
                    · {CATEGORIAS_INVENTARIO[sugerencia.objeto.categoria] || sugerencia.objeto.categoria} ·{' '}
                    {Math.round((sugerencia.objeto.confianza || 0) * 100)}%
                  </span>
                </span>
                <span className="flex gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => aceptar(sugerencia)}
                    className="rounded-lg bg-brand-accent px-2 py-1 font-medium text-white hover:bg-deep"
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    onClick={() => descartar(sugerencia)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-white"
                  >
                    Descartar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {puedeEditar && (
        <form onSubmit={agregarManual} className="flex flex-wrap items-center gap-2 text-sm">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Agregar objeto (ej. Extintor)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent">
            {Object.entries(CATEGORIAS_INVENTARIO).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            max="99"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
            Agregar
          </button>
        </form>
      )}
    </div>
  )
}

export default InventarioInspeccion
