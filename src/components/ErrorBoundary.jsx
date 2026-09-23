import { Component } from 'react'

// Envuelve cada página. Si algo dentro revienta, esta pantalla reemplaza solo
// ese contenido (el menú, que vive fuera del boundary, sigue funcionando) y
// muestra tipo, mensaje y traza en vez de dejar la pantalla en blanco.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('Error atrapado por ErrorBoundary:', error, info)
  }

  copiarTraza = () => {
    const { error, info } = this.state
    const texto = `${error?.stack ?? error}\n\n${info?.componentStack ?? ''}`
    navigator.clipboard?.writeText(texto)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">Ocurrió un error en esta pantalla</p>
        <p className="mt-1">
          <span className="font-medium">Tipo:</span> {error.name}
        </p>
        <p>
          <span className="font-medium">Mensaje:</span> {error.message}
        </p>
        {info?.componentStack && (
          <details className="mt-2">
            <summary className="cursor-pointer">Componente y traza</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
              {info.componentStack}
            </pre>
          </details>
        )}
        <button
          type="button"
          onClick={this.copiarTraza}
          className="mt-3 rounded bg-red-700 px-3 py-1 text-white hover:bg-red-800"
        >
          Copiar traza
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
