// Pie de firma compartido por Orden de Ingreso y Orden de Egreso. `campos`
// es opcional (Ingreso pide nombre/celular/dueño-conductor, Egreso no).
// `print:mt-auto` lo empuja al final de la hoja impresa -el contenedor del
// documento debe declarar `print:flex print:flex-col print:min-h-[...]`
// para que este margen automático tenga efecto-.
function BloqueFirma({ titulo, firmaPng, campos }) {
  return (
    <div className="print:mt-auto">
      {campos && campos.length > 0 && (
        <div className="mb-8 grid gap-6 text-xs" style={{ gridTemplateColumns: `repeat(${campos.length}, minmax(0, 1fr))` }}>
          {campos.map((campo, indice) => (
            <div key={indice} className="text-center">
              <p className="mb-1 min-h-[1.25rem]">{campo.valor || ' '}</p>
              <p className="border-t border-slate-800 pt-0.5 uppercase text-slate-600">{campo.etiqueta}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex h-24 items-end justify-center border-b border-slate-400">
        {firmaPng && <img src={firmaPng} alt="Firma del cliente" className="max-h-24" />}
      </div>
      <p className="pt-1 text-center text-xs">{titulo}</p>
    </div>
  )
}

export default BloqueFirma
