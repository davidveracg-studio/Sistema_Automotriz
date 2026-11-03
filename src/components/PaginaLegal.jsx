import { Link } from 'react-router-dom'
import { DOCUMENTOS, hayMarcadoresPendientes } from '../lib/legal/datos'

// Marco de las páginas públicas /privacidad y /terminos. Recibe las secciones
// ya armadas en src/lib/legal/. Muestra un aviso visible mientras el documento
// sea un borrador o tenga marcadores pendientes.

function Tabla({ columnas, filas }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {columnas.map((columna) => (
              <th key={columna} scope="col" className="px-3 py-2 font-semibold">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {filas.map((fila) => (
            <tr key={fila[0]}>
              {fila.map((celda, indice) => (
                <td key={indice} className="px-3 py-2 align-top">
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaginaLegal({ titulo, secciones, otroDocumento }) {
  const textoCompleto = JSON.stringify(secciones)
  const pendiente = DOCUMENTOS.estado === 'borrador' || hayMarcadoresPendientes(textoCompleto)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/login" className="flex items-center gap-3">
            <img src="/logo-vpai-completo.png" alt="VPAI" className="h-9 w-auto" />
          </Link>
          <Link to={otroDocumento.to} className="text-sm font-medium text-vpai-blue underline-offset-2 hover:underline">
            {otroDocumento.etiqueta}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold text-ink">{titulo}</h1>
        <p className="mt-2 text-sm text-slate-500">
          Versión {DOCUMENTOS.version} · {DOCUMENTOS.fecha}
        </p>

        {pendiente && (
          <div role="note" className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>Borrador pendiente de revisión legal.</strong> Este texto aún no es la versión vigente: los datos
            marcados como [POR COMPLETAR] o [POR CONFIRMAR] deben completarse y un abogado debe revisarlo antes de
            publicarlo.
          </div>
        )}

        <nav aria-label="Contenido" className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Contenido</p>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">
            {secciones.map((seccion) => (
              <li key={seccion.id}>
                <a href={`#${seccion.id}`} className="text-vpai-blue underline-offset-2 hover:underline">
                  {seccion.titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8 space-y-8">
          {secciones.map((seccion) => (
            <section key={seccion.id} id={seccion.id} className="scroll-mt-6">
              <h2 className="text-xl font-semibold text-ink">{seccion.titulo}</h2>
              {seccion.parrafos?.map((parrafo) => (
                <p key={parrafo} className="mt-3 leading-relaxed text-slate-700">
                  {parrafo}
                </p>
              ))}
              {seccion.tabla && <Tabla columnas={seccion.tabla.columnas} filas={seccion.tabla.filas} />}
              {seccion.items && (
                <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-slate-700">
                  {seccion.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <p className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-400">
          Borrador elaborado a partir de la Ley 21.719 (vigente desde el {DOCUMENTOS.vigenciaLey}). No constituye
          asesoría legal.
        </p>
      </main>
    </div>
  )
}

export default PaginaLegal
