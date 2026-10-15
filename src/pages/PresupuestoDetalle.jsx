import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import EncabezadoDocumento from '../components/EncabezadoDocumento'
import CampoDato from '../components/CampoDato'
import BloqueTotales from '../components/BloqueTotales'

import { formatearPatente } from '../lib/patente'
import { calcularDescuentoManoObra, textoPorcentaje } from '../lib/descuento'
const ETIQUETA_ESTADO = {
  borrador: 'Borrador',
  enviado: 'Enviado · esperando respuesta',
  aceptado: 'Aceptado',
  parcial: 'Aceptado parcial',
  rechazado: 'Rechazado',
  anulado: 'Anulado',
}

const ETIQUETA_AREA = {
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes y Otros Insumos',
  servicios_externos: 'Servicios Externos',
  mano_obra: 'Mano de Obra',
}

const AREAS_ORDEN = ['repuestos', 'lubricantes_insumos', 'servicios_externos', 'mano_obra']

// Casos de políticas que se imprimen al pie (texto en politicas_presupuesto).
const OPCIONES_CONDICIONES = [
  { valor: 'sin_encargo', etiqueta: 'Sin encargo de repuestos' },
  { valor: 'encargo', etiqueta: 'Repuestos por encargo (2 a 3 días hábiles)' },
  { valor: 'importacion', etiqueta: 'Repuestos por importación (30 a 40 días hábiles)' },
]

function nombreCliente(cliente) {
  if (!cliente) return ''
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoNumero(numero) {
  if (numero === null || numero === undefined) return ''
  return Math.round(numero).toLocaleString('es-CL')
}

function formatoFecha(fechaIso) {
  if (!fechaIso) return null
  const fecha = new Date(fechaIso)
  return `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`
}

function PresupuestoDetalle() {
  const { id } = useParams()
  const { usuario } = useAuth()

  const [presupuesto, setPresupuesto] = useState(null)
  const [trabajo, setTrabajo] = useState(null)
  const [clienteSolicita, setClienteSolicita] = useState('')
  const [items, setItems] = useState([])
  const [politicas, setPoliticas] = useState({})
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [actualizando, setActualizando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const { data: presupuestoData, error: errorPresupuesto } = await supabase
        .from('presupuestos_taller')
        .select('id, correlativo, estado, creado_en, fecha_envio, fecha_respuesta, notas, trabajo_id, condiciones')
        .eq('id', id)
        .maybeSingle()

      if (errorPresupuesto) {
        setError(errorPresupuesto.message)
        return
      }
      if (!presupuestoData) {
        setError('Presupuesto no encontrado.')
        return
      }
      setPresupuesto(presupuestoData)

      const [
        { data: trabajoData, error: errorTrabajo },
        { data: inspeccionData },
        { data: itemsData, error: errorItems },
        { data: politicasData },
      ] =
        await Promise.all([
          supabase
            .from('trabajos_taller')
            .select(
              'numero_ot, descuento_mano_obra_pct, clientes(nombre, apellido, razon_social, rut, telefono_norm), vehiculos(patente, marca, modelo, anio, color)'
            )
            .eq('id', presupuestoData.trabajo_id)
            .maybeSingle(),
          supabase.from('inspecciones_ingreso').select('cliente_solicita').eq('trabajo_id', presupuestoData.trabajo_id).maybeSingle(),
          supabase
            .from('ot_detalle_con_permiso')
            .select('id, area, codigo, detalle, cantidad, precio_unitario, total_linea')
            .eq('presupuesto_id', id)
            .order('creado_en'),
          supabase.from('politicas_presupuesto').select('condicion, texto'),
        ])

      if (errorTrabajo) {
        setError(errorTrabajo.message)
        return
      }
      if (errorItems) {
        setError(errorItems.message)
        return
      }

      setTrabajo(trabajoData)
      setClienteSolicita(inspeccionData?.cliente_solicita || '')
      setItems(itemsData || [])
      setPoliticas(Object.fromEntries((politicasData || []).map((fila) => [fila.condicion, fila.texto])))
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function cambiarEstado(nuevoEstado) {
    setActualizando(true)
    setError(null)
    try {
      const payload = { estado: nuevoEstado }
      if (['aceptado', 'parcial', 'rechazado'].includes(nuevoEstado)) {
        payload.fecha_respuesta = new Date().toISOString()
      }
      const { error: errorUpdate } = await supabase.from('presupuestos_taller').update(payload).eq('id', id)
      if (errorUpdate) {
        setError(errorUpdate.message)
        return
      }
      await cargar()
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setActualizando(false)
    }
  }

  async function cambiarCondiciones(nuevas) {
    const anteriores = presupuesto.condiciones
    setPresupuesto((previo) => ({ ...previo, condiciones: nuevas }))
    setError(null)
    try {
      const { error: errorUpdate } = await supabase.from('presupuestos_taller').update({ condiciones: nuevas }).eq('id', id)
      if (errorUpdate) {
        setError(errorUpdate.message)
        setPresupuesto((previo) => ({ ...previo, condiciones: anteriores }))
      }
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      setPresupuesto((previo) => ({ ...previo, condiciones: anteriores }))
    }
  }

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>
  if (error && !presupuesto) return <div className="p-6 text-red-600">{error}</div>
  if (!presupuesto) return null

  const empresa = usuario?.empresas
  const itemsPorArea = items.reduce((acumulado, item) => {
    if (!acumulado[item.area]) acumulado[item.area] = []
    acumulado[item.area].push(item)
    return acumulado
  }, {})
  const { descuento, total, totalBruto, porcentaje } = calcularDescuentoManoObra(items, trabajo?.descuento_mano_obra_pct)
  const neto = Math.round(total / 1.19)
  const iva = total - neto
  const textoPoliticas = politicas[presupuesto.condiciones] || null
  const tieneRepuestos = Boolean(itemsPorArea.repuestos?.length)

  const telefonoCliente = trabajo?.clientes?.telefono_norm
  const linkWhatsapp = telefonoCliente
    ? `https://wa.me/${telefonoCliente.replace('+', '')}?text=${encodeURIComponent(
        [
          `Hola ${nombreCliente(trabajo?.clientes)}, te compartimos el presupuesto ${presupuesto.correlativo} para tu ${trabajo?.vehiculos?.marca} ${trabajo?.vehiculos?.modelo} (${formatearPatente(trabajo?.vehiculos?.patente)}):`,
          '',
          ...items.map((item) => `- ${item.detalle}: $${formatoNumero(item.total_linea)}`),
          '',
          ...(descuento > 0 ? [`Descuento en mano de obra (${textoPorcentaje(porcentaje)}%): -${formatoNumero(descuento)}`] : []),
          `Total: ${formatoNumero(total)}`,
          '',
          'Quedamos atentos a tus consultas.',
        ].join('\n')
      )}`
    : null

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Imprimir / guardar como PDF
        </button>
        {linkWhatsapp ? (
          <a
            href={linkWhatsapp}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Enviar por WhatsApp
          </a>
        ) : (
          <span className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            El cliente no tiene teléfono registrado
          </span>
        )}
        <Link
          to={`/trabajos/${presupuesto.trabajo_id}`}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Ver OT
        </Link>
        <Link to="/presupuestos" className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          Volver a Presupuestos
        </Link>

        <span className="ml-2 rounded bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
          {ETIQUETA_ESTADO[presupuesto.estado] || presupuesto.estado}
        </span>

        {presupuesto.estado === 'enviado' && (
          <>
            <button
              type="button"
              disabled={actualizando}
              onClick={() => cambiarEstado('aceptado')}
              className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              Marcar aceptado
            </button>
            <button
              type="button"
              disabled={actualizando}
              onClick={() => cambiarEstado('parcial')}
              className="rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              Aceptado parcial
            </button>
            <button
              type="button"
              disabled={actualizando}
              onClick={() => cambiarEstado('rechazado')}
              className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              Marcar rechazado
            </button>
            <button
              type="button"
              disabled={actualizando}
              onClick={() => cambiarEstado('anulado')}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Anular
            </button>
          </>
        )}
        {['aceptado', 'parcial', 'rechazado'].includes(presupuesto.estado) && (
          <button
            type="button"
            disabled={actualizando}
            onClick={() => cambiarEstado('enviado')}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Revertir a &quot;enviado&quot;
          </button>
        )}
      </div>

      {presupuesto.estado !== 'anulado' && (
        <div className="mb-3 max-w-3xl print:hidden">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Políticas del presupuesto</span>
            <select
              value={presupuesto.condiciones}
              onChange={(evento) => cambiarCondiciones(evento.target.value)}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 sm:w-96"
            >
              {OPCIONES_CONDICIONES.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.etiqueta}
                </option>
              ))}
            </select>
          </label>
          {tieneRepuestos && presupuesto.condiciones === 'sin_encargo' && (
            <p className="mt-1 text-xs text-amber-700">
              Este presupuesto incluye repuestos: si hay que encargarlos, cambia las políticas para que salga el plazo y el abono.
            </p>
          )}
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 print:hidden">{error}</p>}

      {(presupuesto.fecha_envio || presupuesto.fecha_respuesta) && (
        <p className="mb-3 text-xs text-slate-500 print:hidden">
          {presupuesto.fecha_envio && `Enviado: ${formatoFecha(presupuesto.fecha_envio)}`}
          {presupuesto.fecha_respuesta && ` · Respondido: ${formatoFecha(presupuesto.fecha_respuesta)}`}
        </p>
      )}

      <div className="max-w-3xl rounded border border-slate-200 bg-white p-6 text-sm text-slate-900 print:flex print:min-h-[250mm] print:flex-col print:border-0 print:p-0">
        <EncabezadoDocumento
          empresa={empresa}
          lineas={[`PRESUPUESTO N° ${presupuesto.correlativo}`]}
          fecha={formatoFecha(presupuesto.creado_en)}
        />

        <div className="mb-3 grid grid-cols-4 gap-x-4 gap-y-2 border-b border-slate-300 pb-3">
          <CampoDato etiqueta="Patente" valor={formatearPatente(trabajo?.vehiculos?.patente)} />
          <CampoDato etiqueta="R.U.T." valor={trabajo?.clientes?.rut} />
          <CampoDato etiqueta="Color" valor={trabajo?.vehiculos?.color} />
          <CampoDato etiqueta="Año" valor={trabajo?.vehiculos?.anio} />
          <CampoDato etiqueta="Nombre Cliente" valor={nombreCliente(trabajo?.clientes)} className="col-span-2" />
          <CampoDato etiqueta="Marca" valor={trabajo?.vehiculos?.marca} />
          <CampoDato etiqueta="Modelo" valor={trabajo?.vehiculos?.modelo} />
        </div>

        <div className="mb-3 border-b border-slate-300 pb-3">
          <p className="font-bold">Cliente Solicita:</p>
          <p className="whitespace-pre-line">{clienteSolicita || 'Presupuesto creado sin solicitud.'}</p>
        </div>

        {AREAS_ORDEN.filter((area) => itemsPorArea[area]?.length).map((area) => {
          const itemsArea = itemsPorArea[area]
          const subtotal = itemsArea.reduce((acumulado, item) => acumulado + (item.total_linea || 0), 0)
          const esManoObra = area === 'mano_obra'
          return (
            <div key={area} className="mb-3">
              <p className="font-bold">{ETIQUETA_AREA[area]}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-400 text-slate-600">
                    {!esManoObra && <th className="py-1 text-left">CÓDIGO</th>}
                    <th className="py-1 text-left">DETALLE</th>
                    {!esManoObra && <th className="py-1 text-right">CANTIDAD</th>}
                    {!esManoObra && <th className="py-1 text-right">PRECIO</th>}
                    <th className="py-1 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsArea.map((item) => (
                    <tr key={item.id}>
                      {!esManoObra && <td className="py-0.5">{item.codigo || ''}</td>}
                      <td className="py-0.5">{item.detalle}</td>
                      {!esManoObra && <td className="py-0.5 text-right">{item.cantidad}</td>}
                      {!esManoObra && <td className="py-0.5 text-right">{formatoNumero(item.precio_unitario)}</td>}
                      <td className="py-0.5 text-right">{formatoNumero(item.total_linea)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-right text-xs font-bold">
                Subtotal {ETIQUETA_AREA[area]}: {formatoNumero(subtotal)}
              </p>
            </div>
          )
        })}

        {items.length === 0 && <p className="mb-3 text-slate-400">Sin ítems vinculados a este presupuesto.</p>}

        <div className="mt-2 print:mt-auto">
          <BloqueTotales
            filas={[
              ...(descuento > 0
                ? [
                    { etiqueta: 'SUBTOTAL', valor: formatoNumero(totalBruto) },
                    { etiqueta: `Desc. M.O. (${textoPorcentaje(porcentaje)}%)`, valor: `-${formatoNumero(descuento)}` },
                  ]
                : []),
              { etiqueta: 'NETO', valor: formatoNumero(neto) },
              { etiqueta: 'I.V.A.', valor: formatoNumero(iva) },
              { etiqueta: 'TOTAL', valor: formatoNumero(total), destacado: true },
            ]}
          />
          {textoPoliticas && (
            <div className="mt-3 border-t border-slate-300 pt-2 text-[10px] leading-snug text-slate-700">
              {textoPoliticas.split('\n').map((linea, indice) => (
                <p key={indice} className={indice === 0 ? 'font-bold' : ''}>
                  {linea}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PresupuestoDetalle
