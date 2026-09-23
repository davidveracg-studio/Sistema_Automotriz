// Caja de totales compartida por los 3 documentos: un recuadro de ancho fijo
// para que los montos siempre aparezcan en el mismo lugar y con el mismo
// espacio, venga o no el documento con ítems cargados. Pasar
// `className="print:mt-auto"` desde quien la usa cuando además deba quedar
// anclada al final de la hoja impresa (el contenedor del documento debe
// declarar `print:flex print:flex-col` para que ese margen automático
// tenga efecto).
function BloqueTotales({ filas, className = '' }) {
  return (
    <div className={`ml-auto w-56 border border-slate-400 text-sm ${className}`}>
      {filas.map((fila, indice) => (
        <div
          key={indice}
          className={`flex justify-between px-3 py-1 ${indice < filas.length - 1 ? 'border-b border-slate-300' : ''} ${
            fila.destacado ? 'bg-slate-100 font-bold' : ''
          }`}
        >
          <span>{fila.etiqueta}</span>
          <span>{fila.valor}</span>
        </div>
      ))}
    </div>
  )
}

export default BloqueTotales
