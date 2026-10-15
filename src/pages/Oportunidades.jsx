import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { invocarFuncion } from '../lib/invocarFuncion'
import { leerCorreosDemo, pedirCorreosDemo } from '../lib/correosDemo'
import { formatearPatente } from '../lib/patente'

const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  contactado: 'Contactado',
  convertido: 'Convertido',
  descartado: 'Descartado',
}

const ROLES_ENVIO_ENCUESTAS = ['admin', 'socia']

function nombreCliente(cliente) {
  if (!cliente) return '—'
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function Oportunidades() {
  const { sesion, usuario } = useAuth()
  const [oportunidades, setOportunidades] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [enviandoEncuestas, setEnviandoEncuestas] = useState(false)
  const [resultadoEnvio, setResultadoEnvio] = useState(null)

  async function cargar() {
    try {
      const { data, error: errorConsulta } = await supabase
        .from('oportunidades')
        .select('id, descripcion, fecha_sugerida, estado, notas, trabajos_taller(id, numero_ot, clientes(nombre, apellido, razon_social, telefono), vehiculos(patente, marca, modelo))')
        .neq('estado', 'descartado')
        .neq('estado', 'convertido')
        .order('fecha_sugerida', { ascending: true, nullsFirst: false })

      if (errorConsulta) {
        setError(errorConsulta.message)
      } else {
        setOportunidades(data || [])
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargar()
  }, [])

  async function actualizarEstado(id, estado) {
    try {
      const { error: errorActualizar } = await supabase.from('oportunidades').update({ estado }).eq('id', id)
      if (errorActualizar) {
        setError(errorActualizar.message)
        return
      }
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    }
  }

  async function enviarEncuestasPendientes() {
    setResultadoEnvio(null)
    setError(null)

    // En la demo los correos de prueba viajan con la llamada (no están en la base).
    let opciones = {}
    if (usuario?.empresas?.es_demo) {
      const correos = leerCorreosDemo(sesion)
      if (!correos) {
        setError('Ingresa tus correos de prueba para poder enviar la encuesta.')
        pedirCorreosDemo()
        return
      }
      opciones = { body: { correo_cliente_demo: correos.cliente, correo_asesor_demo: correos.asesor } }
    }

    setEnviandoEncuestas(true)
    try {
      const resultado = await invocarFuncion('enviar-encuestas-pendientes', opciones)
      setResultadoEnvio(resultado)
    } catch (excepcion) {
      setError(excepcion.message)
    } finally {
      setEnviandoEncuestas(false)
    }
  }

  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Oportunidades</h1>
        {ROLES_ENVIO_ENCUESTAS.includes(usuario?.rol) && (
          <button
            type="button"
            onClick={enviarEncuestasPendientes}
            disabled={enviandoEncuestas}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {enviandoEncuestas ? 'Enviando…' : 'Enviar encuestas de postventa pendientes'}
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-slate-500">
        Ítems que el cliente postergó, con fecha para retomar contacto. Es una venta agendada, no una venta perdida.
      </p>

      {resultadoEnvio && (
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Encuestas enviadas: {resultadoEnvio.enviadas} de {resultadoEnvio.pendientes_revisadas} revisadas.
          {resultadoEnvio.errores?.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-amber-800">
              {resultadoEnvio.errores.map((e, indice) => (
                <li key={indice}>{e.mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha sugerida</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Vehículo</th>
              <th className="px-3 py-2">Detalle</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!cargando &&
              oportunidades.map((oportunidad) => {
                const trabajo = oportunidad.trabajos_taller
                const vencida = oportunidad.fecha_sugerida && oportunidad.fecha_sugerida <= hoy
                return (
                  <tr key={oportunidad.id} className="border-t border-slate-100">
                    <td className={`px-3 py-2 ${vencida ? 'font-medium text-amber-700' : 'text-slate-600'}`}>
                      {oportunidad.fecha_sugerida || '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      {nombreCliente(trabajo?.clientes)}
                      <p className="text-xs text-slate-400">{trabajo?.clientes?.telefono}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {formatearPatente(trabajo?.vehiculos?.patente)} — {trabajo?.vehiculos?.marca} {trabajo?.vehiculos?.modelo}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{oportunidad.descripcion}</td>
                    <td className="px-3 py-2">
                      <select
                        value={oportunidad.estado}
                        onChange={(evento) => actualizarEstado(oportunidad.id, evento.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
                          <option key={valor} value={valor}>
                            {etiqueta}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {trabajo?.id && (
                        <Link to={`/trabajos/${trabajo.id}`} className="text-xs text-slate-500 underline hover:text-slate-700">
                          OT {trabajo.numero_ot}
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            {!cargando && oportunidades.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Sin oportunidades pendientes por ahora.
                </td>
              </tr>
            )}
            {cargando && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Oportunidades
