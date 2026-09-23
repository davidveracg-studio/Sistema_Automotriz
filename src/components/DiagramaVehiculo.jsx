import { useState } from 'react'
import imagenSedan from '../assets/diagramas/sedan.jpg'
import imagenFurgon from '../assets/diagramas/furgon.jpg'
import imagenPickup from '../assets/diagramas/pickup.jpg'
import imagenHatchback from '../assets/diagramas/hatchback.jpg'
import imagenSuv from '../assets/diagramas/suv.jpg'

const IMAGENES = {
  sedan: imagenSedan,
  furgon: imagenFurgon,
  pickup: imagenPickup,
  hatchback: imagenHatchback,
  suv: imagenSuv,
}

// Recuadros (x0,y0,x1,y1 como fracción 0-1 de la imagen completa) de cada
// una de las 5 vistas dentro del dibujo combinado que compartió el cliente.
// Se detectaron programáticamente (franjas/columnas de tinta sobre fondo
// blanco) a partir de las imágenes reales, con un margen de aire agregado
// -no están a mano alzada-. Si el cliente cambia el dibujo de referencia,
// hay que volver a detectar estos recuadros, no ajustarlos a ojo.
const RECUADROS = {
  sedan: {
    superior: { x0: 0.1332, y0: 0.0868, x1: 0.8032, y1: 0.4004 },
    frontal: { x0: 0.0216, y0: 0.4298, x1: 0.3311, y1: 0.6538 },
    lateral_der: { x0: 0.3221, y0: 0.4298, x1: 0.9961, y1: 0.6538 },
    posterior: { x0: 0.0215, y0: 0.675, x1: 0.3331, y1: 0.905 },
    lateral_izq: { x0: 0.322, y0: 0.675, x1: 0.998, y1: 0.905 },
  },
  furgon: {
    superior: { x0: 0, y0: 0.0452, x1: 0.9646, y1: 0.3893 },
    frontal: { x0: 0.0342, y0: 0.3824, x1: 0.3131, y1: 0.6776 },
    lateral_der: { x0: 0.2796, y0: 0.3824, x1: 1, y1: 0.6776 },
    posterior: { x0: 0.0376, y0: 0.67, x1: 0.3187, y1: 0.9591 },
    lateral_izq: { x0: 0.2926, y0: 0.67, x1: 1, y1: 0.9591 },
  },
  pickup: {
    superior: { x0: 0.062, y0: 0.028, x1: 0.9416, y1: 0.3884 },
    frontal: { x0: 0, y0: 0.3799, x1: 0.3305, y1: 0.6874 },
    lateral_der: { x0: 0.2818, y0: 0.3799, x1: 1, y1: 0.6874 },
    posterior: { x0: 0, y0: 0.6704, x1: 0.3267, y1: 0.986 },
    lateral_izq: { x0: 0.3034, y0: 0.6704, x1: 1, y1: 0.986 },
  },
  suv: {
    superior: { x0: 0.1543, y0: 0.0945, x1: 0.792, y1: 0.4084 },
    frontal: { x0: 0.0155, y0: 0.4283, x1: 0.3283, y1: 0.6733 },
    lateral_der: { x0: 0.3256, y0: 0.4283, x1: 0.9556, y1: 0.6733 },
    posterior: { x0: 0.0155, y0: 0.6763, x1: 0.3283, y1: 0.9213 },
    lateral_izq: { x0: 0.3246, y0: 0.6763, x1: 0.9557, y1: 0.9213 },
  },
  // El dibujo de referencia del hatchback viene con un layout distinto -dos
  // filas de lateral a ancho completo en vez de compartir fila con
  // frontal/posterior-, por eso tiene su propio DISTRIBUCION más abajo en
  // vez de reusar VISTAS.
  hatchback: {
    superior: { x0: 0.1616, y0: 0.0181, x1: 0.8075, y1: 0.2865 },
    lateral_der: { x0: 0.1614, y0: 0.2915, x1: 0.8259, y1: 0.5352 },
    lateral_izq: { x0: 0.1512, y0: 0.5116, x1: 0.814, y1: 0.7535 },
    posterior: { x0: 0.1525, y0: 0.7383, x1: 0.4511, y1: 0.9856 },
    frontal: { x0: 0.5185, y0: 0.7383, x1: 0.8375, y1: 0.9856 },
  },
}

// Orden y ancho de cada vista en la grilla. La mayoría de los dibujos
// comparten fila entre frontal/lateral y posterior/lateral; el hatchback
// viene con las dos laterales a ancho completo, cada una en su propia fila.
const DISTRIBUCION_ESTANDAR = [
  { clave: 'superior', etiqueta: 'Superior', ancho: 'col-span-2' },
  { clave: 'frontal', etiqueta: 'Frontal' },
  { clave: 'lateral_der', etiqueta: 'Lateral derecho' },
  { clave: 'posterior', etiqueta: 'Posterior' },
  { clave: 'lateral_izq', etiqueta: 'Lateral izquierdo' },
]

const DISTRIBUCION_HATCHBACK = [
  { clave: 'superior', etiqueta: 'Superior', ancho: 'col-span-2' },
  { clave: 'lateral_der', etiqueta: 'Lateral derecho', ancho: 'col-span-2' },
  { clave: 'lateral_izq', etiqueta: 'Lateral izquierdo', ancho: 'col-span-2' },
  { clave: 'posterior', etiqueta: 'Posterior' },
  { clave: 'frontal', etiqueta: 'Frontal' },
]

const DISTRIBUCIONES = { hatchback: DISTRIBUCION_HATCHBACK }

// Recorta una región de la imagen completa posicionando un <img> real más
// grande que su contenedor (con overflow:hidden), en vez de background-image
// -que Chrome/el motor de impresión no imprime a menos que la persona tenga
// activado "Gráficos de fondo" al exportar a PDF-. Con un <img> de verdad el
// recorte se ve siempre, tanto en pantalla como al imprimir.
function estiloImagenRecortada(caja) {
  const anchoFraccion = caja.x1 - caja.x0
  const altoFraccion = caja.y1 - caja.y0
  return {
    width: `${(1 / anchoFraccion) * 100}%`,
    height: `${(1 / altoFraccion) * 100}%`,
    left: `${-(caja.x0 / anchoFraccion) * 100}%`,
    top: `${-(caja.y0 / altoFraccion) * 100}%`,
    maxWidth: 'none',
  }
}

// Las 5 vistas tienen proporciones muy distintas entre sí (la superior es
// ancha, las laterales aún más, frontal/posterior casi cuadradas). Para que
// las 5 se vean del mismo tamaño de recuadro sin deformar el dibujo, el
// recuadro de cada vista se ajusta -como "object-fit: contain"- dentro de un
// recuadro fijo (BOX_ANCHO x BOX_ALTO): se calcula a mano cuál lado manda
// (ancho o alto) en vez de dejarlo en manos de aspect-ratio solo, porque un
// elemento sin contenido propio (todo el dibujo va en un <img> absoluto
// adentro) no tiene un tamaño "natural" del que el navegador pueda partir.
const BOX_ANCHO = 160
const BOX_ALTO = 112

function estiloContenedorRecorte(caja) {
  const anchoFraccion = caja.x1 - caja.x0
  const altoFraccion = caja.y1 - caja.y0
  const relacionCrop = anchoFraccion / altoFraccion
  const relacionCaja = BOX_ANCHO / BOX_ALTO
  const base = { aspectRatio: `${anchoFraccion} / ${altoFraccion}` }
  if (relacionCrop >= relacionCaja) {
    return { ...base, width: '100%', height: 'auto' }
  }
  return { ...base, height: '100%', width: 'auto' }
}

function DiagramaVehiculo({ tipo, marcas, onCambio, soloLectura }) {
  const [vistaActiva, setVistaActiva] = useState(null)
  const recuadros = RECUADROS[tipo] || RECUADROS.sedan
  const imagen = IMAGENES[tipo] || IMAGENES.sedan
  const vistas = DISTRIBUCIONES[tipo] || DISTRIBUCION_ESTANDAR

  function manejarClick(vista, evento) {
    if (soloLectura) return
    const rect = evento.currentTarget.getBoundingClientRect()
    const x = (evento.clientX - rect.left) / rect.width
    const y = (evento.clientY - rect.top) / rect.height
    const nueva = { vista, x, y, nota: '' }
    onCambio([...marcas, nueva])
    setVistaActiva(marcas.length)
  }

  function actualizarNota(indice, texto) {
    const copia = marcas.map((marca, i) => (i === indice ? { ...marca, nota: texto } : marca))
    onCambio(copia)
  }

  function quitarMarca(indice) {
    onCambio(marcas.filter((_, i) => i !== indice))
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {vistas.map((vista) => {
          const caja = recuadros[vista.clave]
          return (
            <div key={vista.clave} className={vista.ancho}>
              <p className="mb-1 text-xs text-slate-500">{vista.etiqueta}</p>
              {/* Recuadro de tamaño fijo e igual para las 5 vistas -las cajas
                  detectadas tienen proporciones distintas entre sí, así que
                  el recorte se ajusta (como "object-fit: contain") dentro de
                  este recuadro en vez de estirarlo, para no deformar ni
                  recortar de más el dibujo. */}
              <div
                className="mx-auto flex items-center justify-center rounded border border-slate-200 bg-white"
                style={{ width: BOX_ANCHO, height: BOX_ALTO }}
              >
                <div
                  className="relative cursor-crosshair overflow-hidden"
                  style={estiloContenedorRecorte(caja)}
                  onClick={(evento) => manejarClick(vista.clave, evento)}
                >
                  <img
                    src={imagen}
                    alt={vista.etiqueta}
                    draggable={false}
                    className="absolute select-none"
                    style={estiloImagenRecortada(caja)}
                  />
                  {marcas.map((marca, indice) =>
                    marca.vista === vista.clave ? (
                      <button
                        key={indice}
                        type="button"
                        onClick={(evento) => {
                          evento.stopPropagation()
                          if (!soloLectura) setVistaActiva(indice)
                        }}
                        title={marca.nota || `Marca ${indice + 1}`}
                        className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white ring-2 ring-white"
                        style={{ left: `${marca.x * 100}%`, top: `${marca.y * 100}%` }}
                      >
                        {indice + 1}
                      </button>
                    ) : null
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {marcas.length > 0 && (
        <div className="mt-3 space-y-1">
          {marcas.map((marca, indice) => (
            <div key={indice} className="flex items-center gap-2 text-sm">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                {indice + 1}
              </span>
              {soloLectura ? (
                <span className="text-slate-700">{marca.nota || '(sin nota)'}</span>
              ) : (
                <>
                  <input
                    value={marca.nota}
                    onChange={(evento) => actualizarNota(indice, evento.target.value)}
                    autoFocus={vistaActiva === indice}
                    placeholder="Ej. rayón, abolladura, parabrisas trizado…"
                    className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => quitarMarca(indice)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    quitar
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {!soloLectura && marcas.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">Click sobre el dibujo para marcar un daño o detalle.</p>
      )}
    </div>
  )
}

export default DiagramaVehiculo
