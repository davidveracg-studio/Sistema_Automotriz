// Encabezado compartido por los tres documentos que emite el sistema
// (Orden de Ingreso, Presupuesto, Orden de Egreso). Centralizado a
// propósito: el proyecto es multi-tenant, así que el nombre/dirección/
// teléfono/correo/logo salen siempre de `empresa` (la fila de `empresas`
// del tenant actual) -nunca texto fijo de Didial en el componente-. Una
// empresa nueva que se sume a la plataforma solo necesita completar sus
// propios datos y logo; ningún documento hay que tocarlo.
function EncabezadoDocumento({ empresa, lineas, fecha, pagina = 1 }) {
  return (
    <div className="mb-2 flex items-start justify-between gap-4 border-b border-slate-800 pb-2">
      <div className="flex items-center gap-3">
        {empresa?.logo_url && (
          <img src={empresa.logo_url} alt={empresa?.nombre || 'Logo'} className="h-14 w-auto object-contain" />
        )}
        <div>
          <p className="font-bold uppercase">{empresa?.nombre}</p>
          <p>{empresa?.direccion}</p>
          <p>{empresa?.correo}</p>
          <p>{empresa?.telefono}</p>
        </div>
      </div>
      <div className="text-right">
        {lineas.map((linea, indice) => (
          <p key={indice} className={indice === 0 ? 'text-lg font-bold' : 'font-bold'}>
            {linea}
          </p>
        ))}
        <p className="font-bold">FECHA: {fecha}</p>
        <p className="mt-1 text-xs">Página: {pagina}</p>
      </div>
    </div>
  )
}

export default EncabezadoDocumento
