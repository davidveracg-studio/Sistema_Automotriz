import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import EscanerCaptura from '../components/EscanerCaptura'
import { formatearPatente } from '../lib/patente'
import { borrarBorrador, cargarBorrador, guardarBorrador } from '../lib/escaner/imagen'
import { subirFotos } from '../lib/escaner/subida'

// Escáner de una OT ya creada (ruta /trabajos/:id/escaner): carga la OT, deja
// que EscanerCaptura arme la lista de fotos y las sube al confirmar. Las fotos
// aún no subidas quedan en un borrador local por si se cae la conexión.
function EscanerInspeccion() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()

  const [trabajo, setTrabajo] = useState(null)
  const [fotos, setFotos] = useState([])
  const [borradorListo, setBorradorListo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const fotosRef = useRef([])

  useEffect(() => {
    fotosRef.current = fotos
  }, [fotos])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      const { data, error: errorTrabajo } = await supabase
        .from('trabajos_taller')
        .select('id, numero_ot, vehiculo_id, vehiculos(patente, marca, modelo)')
        .eq('id', id)
        .maybeSingle()
      if (cancelado) return
      if (errorTrabajo || !data) {
        setError(errorTrabajo?.message || 'No se encontró la orden de trabajo.')
        return
      }
      setTrabajo(data)
      const guardadas = await cargarBorrador(id)
      if (cancelado) return
      setFotos(guardadas.map((f) => ({ ...f, url: URL.createObjectURL(f.blob), estado: 'pendiente' })))
      setBorradorListo(true)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [id])

  // Persiste las fotos aún no subidas (solo blobs comprimidos, nunca video).
  useEffect(() => {
    if (!borradorListo) return
    const pendientes = fotos
      .filter((f) => f.estado !== 'subida')
      .map(({ id: fotoId, blob, zona, subzona, nota, esDano, origen, ancho, alto, tomadaEn }) => ({
        id: fotoId,
        blob,
        zona,
        subzona,
        nota,
        esDano,
        origen,
        ancho,
        alto,
        tomadaEn,
      }))
    guardarBorrador(id, pendientes)
  }, [fotos, borradorListo, id])

  // Libera las URLs de miniaturas al salir.
  useEffect(
    () => () => {
      fotosRef.current.forEach((f) => URL.revokeObjectURL(f.url))
    },
    []
  )

  function actualizarFoto(fotoId, cambios) {
    setFotos((previas) => previas.map((f) => (f.id === fotoId ? { ...f, ...cambios } : f)))
  }

  async function confirmar() {
    if (!trabajo || !usuario) return
    setGuardando(true)
    setError(null)
    const { fallidas: fallaronAhora } = await subirFotos({
      fotos: fotosRef.current.filter((f) => f.estado !== 'subida'),
      trabajo,
      usuario,
      alCambiar: actualizarFoto,
    })
    setGuardando(false)
    if (fallaronAhora === 0) {
      await borrarBorrador(id)
      navigate(`/trabajos/${id}`, { state: { analizar: true } })
    } else {
      setError('Algunas fotos no se pudieron subir. Revisa la conexión y vuelve a intentar: las ya subidas no se duplican.')
    }
  }

  const fallidas = fotos.filter((f) => f.estado === 'error').length

  if (!trabajo && !error) return <p className="p-6 text-sm text-slate-500">Cargando…</p>

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Escáner de inspección</h1>
          {trabajo && (
            <p className="text-sm text-slate-500">
              OT {trabajo.numero_ot} — {formatearPatente(trabajo.vehiculos?.patente)} · {trabajo.vehiculos?.marca}{' '}
              {trabajo.vehiculos?.modelo}
            </p>
          )}
        </div>
        <Link
          to={`/trabajos/${id}`}
          className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Volver a la OT
        </Link>
      </div>

      {error && <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {trabajo && <EscanerCaptura fotos={fotos} setFotos={setFotos} />}

      <div className="sticky bottom-0 -mx-1 mt-4 flex items-center gap-3 border-t border-slate-200 bg-white/95 px-1 py-3">
        <button
          type="button"
          disabled={guardando || fotos.length === 0}
          onClick={confirmar}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {guardando ? 'Subiendo…' : fallidas > 0 ? `Reintentar ${fallidas} fallida(s)` : 'Confirmar y guardar en la OT'}
        </button>
        <span className="text-xs text-slate-500">Solo se guardan las fotos; el video no se almacena.</span>
      </div>
    </div>
  )
}

export default EscanerInspeccion
