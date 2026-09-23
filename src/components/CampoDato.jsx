// Campo de identificación (cliente/vehículo) para los documentos impresos.
// Espacio fijo con etiqueta arriba y valor abajo, para que el documento se
// vea ordenado sin importar si el valor está vacío o es largo -a diferencia
// de un <p> suelto, cuyo ancho visual cambia según el contenido-.
function CampoDato({ etiqueta, valor, className = '' }) {
  return (
    <div className={`border-b border-slate-300 pb-0.5 ${className}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className="truncate">{valor || ' '}</p>
    </div>
  )
}

export default CampoDato
