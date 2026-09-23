import { useRef, useState } from 'react'

// Firma digital a mano alzada. El canvas dibuja a una resolución fija
// (600x200) independiente del tamaño en pantalla, por eso posicionRelativa
// reescala el puntero a las coordenadas reales del buffer.
function FirmaCanvas({ onCambio }) {
  const canvasRef = useRef(null)
  const dibujando = useRef(false)
  const [vacio, setVacio] = useState(true)

  function posicionRelativa(evento) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((evento.clientX - rect.left) * canvas.width) / rect.width,
      y: ((evento.clientY - rect.top) * canvas.height) / rect.height,
    }
  }

  function iniciar(evento) {
    dibujando.current = true
    const contexto = canvasRef.current.getContext('2d')
    const { x, y } = posicionRelativa(evento)
    contexto.beginPath()
    contexto.moveTo(x, y)
  }

  function dibujar(evento) {
    if (!dibujando.current) return
    const contexto = canvasRef.current.getContext('2d')
    const { x, y } = posicionRelativa(evento)
    contexto.strokeStyle = '#1e293b'
    contexto.lineWidth = 2.5
    contexto.lineCap = 'round'
    contexto.lineTo(x, y)
    contexto.stroke()
    setVacio(false)
  }

  function terminar() {
    if (!dibujando.current) return
    dibujando.current = false
    onCambio?.(canvasRef.current.toDataURL('image/png'))
  }

  function limpiar() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setVacio(true)
    onCambio?.(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        onPointerDown={iniciar}
        onPointerMove={dibujar}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        className="w-full touch-none rounded border border-slate-300 bg-white"
        style={{ aspectRatio: '3 / 1' }}
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-400">{vacio ? 'Sin firmar' : 'Firmado'}</p>
        <button type="button" onClick={limpiar} className="text-xs text-slate-500 underline hover:text-slate-700">
          Limpiar
        </button>
      </div>
    </div>
  )
}

export default FirmaCanvas
