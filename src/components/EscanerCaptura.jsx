import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analizarFrame, CONFIG_POR_DEFECTO, decidirCaptura } from '../lib/escaner/analisis'
import { comprimirAJpeg, comprimirArchivo } from '../lib/escaner/imagen'
import { etiquetaSubzona, ZONAS_POR_FASE } from '../lib/escaner/zonas'
const CLAVE_CONFIG = 'escaner-inspeccion-config'
const ANCHO_ANALISIS = 240
const PERIODO_ANALISIS_MS = 250

// Mensajes de la guía en pantalla según el veredicto del motor de captura.
const GUIA = {
  captura: { texto: 'Foto tomada', clase: 'bg-green-600' },
  borroso: { texto: 'Imagen borrosa — enfoca y sostén el teléfono', clase: 'bg-amber-600' },
  rapido: { texto: 'Muy rápido — muévete más despacio', clase: 'bg-red-600' },
  repetido: { texto: 'Mismo encuadre — avanza a otra parte', clase: 'bg-slate-700' },
  espera: { texto: 'Buscando el siguiente encuadre…', clase: 'bg-slate-700' },
  limite: { texto: 'Límite de fotos alcanzado', clase: 'bg-red-600' },
  inicio: { texto: 'Recorre el vehículo despacio', clase: 'bg-slate-700' },
}

function leerConfig() {
  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE_CONFIG) || 'null')
    return { ...CONFIG_POR_DEFECTO, ...(guardada || {}) }
  } catch {
    return { ...CONFIG_POR_DEFECTO }
  }
}

function formatoKb(bytes) {
  return `${Math.round(bytes / 1024)} KB`
}

// Escáner de inspección reutilizable: cámara + captura automática + zonas +
// revisión de las fotos. No sabe a dónde van las fotos: el padre es dueño de la
// lista (`fotos` / `setFotos`) y decide cuándo y dónde guardarlas (la OT ya
// creada, o el formulario de nuevo ingreso, que las sube al crear la OT).
// El video nunca se graba ni se sube; solo se conservan fotos JPEG comprimidas.
function EscanerCaptura({ fotos, setFotos }) {
  const [fase, setFase] = useState('exterior') // exterior | interior | revision
  const [subzona, setSubzona] = useState({ exterior: 'frontal', interior: 'tablero' })
  const [camaraActiva, setCamaraActiva] = useState(false)
  const [veredicto, setVeredicto] = useState('inicio')
  const [config, setConfig] = useState(leerConfig)
  const [mostrarAjustes, setMostrarAjustes] = useState(false)
  const [error, setError] = useState(null)
  const [destinoManual, setDestinoManual] = useState('exterior:frontal')

  const videoRef = useRef(null)
  const flujoRef = useRef(null)
  const lienzoAnalisisRef = useRef(null)
  const analisisPrevioRef = useRef(null)
  const ultimoHashRef = useRef(null)
  const ultimaCapturaRef = useRef(null)
  const capturandoRef = useRef(false)
  const veredictoRef = useRef('inicio')
  const fotosRef = useRef([])
  const faseRef = useRef(fase)
  const subzonaRef = useRef(subzona)
  const configRef = useRef(config)

  useEffect(() => {
    fotosRef.current = fotos
  }, [fotos])
  useEffect(() => {
    faseRef.current = fase
  }, [fase])
  useEffect(() => {
    subzonaRef.current = subzona
  }, [subzona])
  useEffect(() => {
    configRef.current = config
    try {
      localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config))
    } catch {
      /* sin almacenamiento local */
    }
  }, [config])

  // --- Cámara --------------------------------------------------------------
  const detenerCamara = useCallback(() => {
    flujoRef.current?.getTracks().forEach((pista) => pista.stop())
    flujoRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamaraActiva(false)
  }, [])

  const iniciarCamara = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no permite usar la cámara (se requiere HTTPS y un navegador actualizado).')
      return
    }
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      flujoRef.current = flujo
      if (videoRef.current) {
        videoRef.current.srcObject = flujo
        await videoRef.current.play()
      }
      analisisPrevioRef.current = null
      setCamaraActiva(true)
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.'
          : `No se pudo abrir la cámara: ${e?.message || e}`
      )
    }
  }, [])

  useEffect(() => detenerCamara, [detenerCamara])

  // --- Captura -------------------------------------------------------------
  const agregarFoto = useCallback((datos) => {
    const foto = {
      id: crypto.randomUUID(),
      nota: '',
      esDano: false,
      tomadaEn: Date.now(),
      estado: 'pendiente',
      ...datos,
      url: URL.createObjectURL(datos.blob),
    }
    setFotos((previas) => [...previas, foto])
    navigator.vibrate?.(40)
  }, [setFotos])

  const capturar = useCallback(
    async ({ origen, esDano }) => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || capturandoRef.current) return
      capturandoRef.current = true
      try {
        const cfg = configRef.current
        const { blob, ancho, alto } = await comprimirAJpeg(video, video.videoWidth, video.videoHeight, {
          ladoMaximo: cfg.ladoMaximo,
          calidad: cfg.calidadJpeg,
        })
        const zona = faseRef.current
        agregarFoto({ blob, ancho, alto, zona, subzona: subzonaRef.current[zona], origen, esDano })
        ultimaCapturaRef.current = Date.now()
        ultimoHashRef.current = analisisPrevioRef.current?.hash || null
      } catch (e) {
        setError(`No se pudo capturar la foto: ${e?.message || e}`)
      } finally {
        capturandoRef.current = false
      }
    },
    [agregarFoto]
  )

  // Bucle de análisis: muestrea el stream a baja resolución, mide nitidez y
  // cambio de escena y dispara la captura automática. Todo en el dispositivo.
  useEffect(() => {
    if (!camaraActiva || fase === 'revision') return undefined
    const temporizador = setInterval(() => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth || capturandoRef.current) return
      if (!lienzoAnalisisRef.current) {
        lienzoAnalisisRef.current = document.createElement('canvas')
      }
      const lienzo = lienzoAnalisisRef.current
      const alto = Math.round((ANCHO_ANALISIS * video.videoHeight) / video.videoWidth)
      lienzo.width = ANCHO_ANALISIS
      lienzo.height = alto
      const ctx = lienzo.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, ANCHO_ANALISIS, alto)
      const imagen = ctx.getImageData(0, 0, ANCHO_ANALISIS, alto)

      const analisis = analizarFrame(imagen, analisisPrevioRef.current)
      analisisPrevioRef.current = analisis

      const decision = decidirCaptura({
        analisis,
        ultimoHash: ultimoHashRef.current,
        ultimaCapturaMs: ultimaCapturaRef.current,
        ahoraMs: Date.now(),
        totalFotos: fotosRef.current.length,
        config: configRef.current,
      })
      if (decision !== veredictoRef.current) {
        veredictoRef.current = decision
        setVeredicto(decision)
      }
      if (decision === 'captura') capturar({ origen: 'auto', esDano: false })
    }, PERIODO_ANALISIS_MS)
    return () => clearInterval(temporizador)
  }, [camaraActiva, fase, capturar])

  // --- Navegación entre fases ---------------------------------------------
  const irAFase = useCallback(
    (nueva) => {
      setFase(nueva)
      if (nueva === 'revision') detenerCamara()
    },
    [detenerCamara]
  )

  const zonasFase = ZONAS_POR_FASE[fase] || []

  function siguienteZona() {
    const indice = zonasFase.findIndex((z) => z.id === subzona[fase])
    const siguiente = zonasFase[Math.min(indice + 1, zonasFase.length - 1)]
    setSubzona((previa) => ({ ...previa, [fase]: siguiente.id }))
  }

  const conteoPorSubzona = useMemo(() => {
    const conteo = {}
    fotos.forEach((f) => {
      const clave = `${f.zona}:${f.subzona}`
      conteo[clave] = (conteo[clave] || 0) + 1
    })
    return conteo
  }, [fotos])

  const zonasCubiertas = zonasFase.filter((z) => conteoPorSubzona[`${fase}:${z.id}`]).length

  // --- Revisión ------------------------------------------------------------
  function actualizarFoto(fotoId, cambios) {
    setFotos((previas) => previas.map((f) => (f.id === fotoId ? { ...f, ...cambios } : f)))
  }

  function eliminarFoto(fotoId) {
    const foto = fotosRef.current.find((f) => f.id === fotoId)
    if (foto) URL.revokeObjectURL(foto.url)
    setFotos((previas) => previas.filter((f) => f.id !== fotoId))
  }

  function repetirFoto(foto) {
    eliminarFoto(foto.id)
    setSubzona((previa) => ({ ...previa, [foto.zona]: foto.subzona }))
    setFase(foto.zona)
    iniciarCamara()
  }

  async function agregarManual(evento) {
    const archivos = Array.from(evento.target.files || [])
    evento.target.value = ''
    const [zona, sz] = destinoManual.split(':')
    try {
      for (const archivo of archivos) {
        const { blob, ancho, alto } = await comprimirArchivo(archivo, {
          ladoMaximo: config.ladoMaximo,
          calidad: config.calidadJpeg,
        })
        agregarFoto({ blob, ancho, alto, zona, subzona: sz, origen: 'manual', esDano: false })
      }
    } catch (e) {
      setError(`No se pudo procesar la imagen: ${e?.message || e}`)
    }
  }
  const bytesTotales = fotos.reduce((suma, f) => suma + f.blob.size, 0)

  const guia = GUIA[veredicto] || GUIA.inicio

  return (
    <div>
      {error && <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="mb-4 flex gap-2 text-sm">
        {[
          ['exterior', 'Exterior'],
          ['interior', 'Interior'],
          ['revision', `Revisión (${fotos.length})`],
        ].map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            onClick={() => irAFase(clave)}
            className={`rounded px-3 py-1.5 font-medium ${
              fase === clave ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {/* El <video> es solo la vista previa: nunca se graba ni se sube. */}
      <div className={fase === 'revision' ? 'hidden' : ''}>
        <div className="relative mb-3 overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} playsInline muted autoPlay className="aspect-[3/4] w-full object-cover sm:aspect-video" />
          {!camaraActiva && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 p-4">
              <button
                type="button"
                onClick={iniciarCamara}
                className="rounded bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
              >
                Activar cámara
              </button>
            </div>
          )}
          {camaraActiva && (
            <>
              <div
                className={`absolute left-2 right-2 top-2 rounded px-3 py-1.5 text-center text-sm font-medium text-white ${guia.clase}`}
              >
                {guia.texto}
              </div>
              <div className="absolute bottom-2 left-2 rounded bg-black/60 px-3 py-1 text-sm text-white">
                {fotos.length} foto(s) · {zonasCubiertas}/{zonasFase.length} zonas
              </div>
            </>
          )}
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {zonasFase.map((z) => {
            const cantidad = conteoPorSubzona[`${fase}:${z.id}`] || 0
            const activa = subzona[fase] === z.id
            return (
              <button
                key={z.id}
                type="button"
                onClick={() => setSubzona((previa) => ({ ...previa, [fase]: z.id }))}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  activa ? 'ring-2 ring-slate-900' : ''
                } ${cantidad ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-slate-600'}`}
              >
                {z.etiqueta}
                {cantidad > 0 && ` · ${cantidad}`}
              </button>
            )
          })}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!camaraActiva}
            onClick={() => capturar({ origen: 'manual', esDano: false })}
            className="rounded-lg bg-brand-accent px-3 py-2 text-sm font-medium text-white hover:bg-deep disabled:opacity-50"
          >
            Tomar foto ahora
          </button>
          <button
            type="button"
            disabled={!camaraActiva}
            onClick={() => capturar({ origen: 'manual', esDano: true })}
            className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Marcar daño
          </button>
          <button
            type="button"
            onClick={siguienteZona}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Siguiente zona
          </button>
          {fase === 'exterior' ? (
            <button
              type="button"
              onClick={() => setFase('interior')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Pasar al interior
            </button>
          ) : (
            <button
              type="button"
              onClick={() => irAFase('revision')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Revisar fotos
            </button>
          )}
          <button
            type="button"
            onClick={() => setMostrarAjustes((v) => !v)}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Ajustes
          </button>
        </div>

        {mostrarAjustes && (
          <div className="mb-3 grid gap-3 rounded-2xl bg-white p-3 text-sm sm:grid-cols-2 shadow-mm print:shadow-none">
            <label className="block">
              <span className="text-slate-600">Intervalo mínimo: {(config.intervaloMinMs / 1000).toFixed(1)} s</span>
              <input
                type="range"
                min="500"
                max="5000"
                step="250"
                value={config.intervaloMinMs}
                onChange={(e) => setConfig({ ...config, intervaloMinMs: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-slate-600">Exigencia de nitidez: {config.umbralNitidez}</span>
              <input
                type="range"
                min="5"
                max="150"
                step="5"
                value={config.umbralNitidez}
                onChange={(e) => setConfig({ ...config, umbralNitidez: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-slate-600">Cambio de encuadre exigido: {config.umbralCambio} / 144</span>
              <input
                type="range"
                min="8"
                max="72"
                step="1"
                value={config.umbralCambio}
                onChange={(e) => setConfig({ ...config, umbralCambio: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-slate-600">Calidad JPEG: {Math.round(config.calidadJpeg * 100)}%</span>
              <input
                type="range"
                min="0.4"
                max="0.95"
                step="0.05"
                value={config.calidadJpeg}
                onChange={(e) => setConfig({ ...config, calidadJpeg: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <button
              type="button"
              onClick={() => setConfig({ ...CONFIG_POR_DEFECTO })}
              className="justify-self-start text-xs text-slate-500 underline"
            >
              Restablecer valores
            </button>
          </div>
        )}
      </div>

      {fase === 'revision' && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              {fotos.length} foto(s) · {formatoKb(bytesTotales)}
            </span>
            <select
              value={destinoManual}
              onChange={(e) => setDestinoManual(e.target.value)}
              className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              {Object.entries(ZONAS_POR_FASE).flatMap(([zona, lista]) =>
                lista.map((z) => (
                  <option key={`${zona}:${z.id}`} value={`${zona}:${z.id}`}>
                    {zona === 'exterior' ? 'Exterior' : 'Interior'} · {z.etiqueta}
                  </option>
                ))
              )}
            </select>
            <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
              Agregar foto
              <input type="file" accept="image/*" capture="environment" multiple onChange={agregarManual} className="hidden" />
            </label>
          </div>

          {fotos.length === 0 && (
            <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              Aún no hay fotos. Vuelve a Exterior o Interior para escanear, o agrega una manualmente.
            </p>
          )}

          {['exterior', 'interior'].map((zona) => {
            const deZona = fotos.filter((f) => f.zona === zona)
            if (deZona.length === 0) return null
            return (
              <div key={zona} className="mb-5">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {zona === 'exterior' ? 'Exterior' : 'Interior'} ({deZona.length})
                </h2>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {deZona.map((foto) => (
                    <li key={foto.id} className="overflow-hidden rounded-2xl bg-white shadow-mm print:shadow-none">
                      <div className="relative">
                        <img src={foto.url} alt={etiquetaSubzona(foto.zona, foto.subzona)} className="aspect-[4/3] w-full object-cover" />
                        <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white">
                          {etiquetaSubzona(foto.zona, foto.subzona)}
                        </span>
                        {foto.esDano && (
                          <span className="absolute right-1 top-1 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                            Daño
                          </span>
                        )}
                        {foto.estado !== 'pendiente' && (
                          <span
                            className={`absolute bottom-1 left-1 rounded-full px-1.5 py-0.5 text-xs text-white ${
                              foto.estado === 'subida' ? 'bg-green-600' : foto.estado === 'error' ? 'bg-red-600' : 'bg-slate-700'
                            }`}
                          >
                            {foto.estado === 'subida' ? 'Subida' : foto.estado === 'error' ? 'Error' : 'Subiendo…'}
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <input
                          type="text"
                          value={foto.nota}
                          disabled={foto.estado === 'subida'}
                          onChange={(e) => actualizarFoto(foto.id, { nota: e.target.value })}
                          placeholder="Nota (ej. raya en puerta)"
                          className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
                        />
                        {foto.estado !== 'subida' && (
                          <div className="flex flex-wrap gap-1 text-xs">
                            <button
                              type="button"
                              onClick={() => actualizarFoto(foto.id, { esDano: !foto.esDano })}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
                            >
                              {foto.esDano ? 'Quitar daño' : 'Marcar daño'}
                            </button>
                            <button
                              type="button"
                              onClick={() => repetirFoto(foto)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
                            >
                              Repetir
                            </button>
                            <button
                              type="button"
                              onClick={() => eliminarFoto(foto.id)}
                              className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                            >
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

export default EscanerCaptura
