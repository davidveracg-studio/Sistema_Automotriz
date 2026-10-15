import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import EncabezadoDocumento from '../components/EncabezadoDocumento'
import CampoDato from '../components/CampoDato'
import BloqueFirma from '../components/BloqueFirma'
import BloqueTotales from '../components/BloqueTotales'

import { formatearPatente } from '../lib/patente'
import { calcularDescuentoManoObra, textoPorcentaje } from '../lib/descuento'
const ETIQUETA_AREA = {
  repuestos: 'Repuestos',
  lubricantes_insumos: 'Lubricantes y Otros Insumos',
  servicios_externos: 'Servicios Externos',
  mano_obra: 'Mano de Obra',
}

const AREAS_ORDEN = ['mano_obra', 'repuestos', 'lubricantes_insumos', 'servicios_externos']

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

function formatoHora(fechaIso) {
  if (!fechaIso) return ''
  return new Date(fechaIso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

function OrdenEgreso() {
  const { id } = useParams()
  const { usuario } = useAuth()

  const [trabajo, setTrabajo] = useState(null)
  const [clienteSolicita, setClienteSolicita] = useState('')
  const [egreso, setEgreso] = useState(null)
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [
        { data: trabajoData, error: errorTrabajo },
        { data: inspeccionData },
        { data: egresoData },
        { data: itemsData, error: errorItems },
      ] = await Promise.all([
        supabase
          .from('trabajos_taller')
          .select(
            'numero_ot, fecha_entrega, descuento_mano_obra_pct, tipo_documento, numero_documento_facturacion, estado_pago, fecha_vencimiento_pago, ' +
              'clientes(nombre, apellido, razon_social, rut, tipo, direccion, email, telefono), ' +
              'vehiculos(patente, marca, modelo, anio, color, kilometraje)'
          )
          .eq('id', id)
          .maybeSingle(),
        supabase.from('inspecciones_ingreso').select('cliente_solicita').eq('trabajo_id', id).maybeSingle(),
        supabase
          .from('egresos_vehiculo')
          .select('retirado_por_nombre, retirado_por_rut, retirado_por_contacto, comentario, observaciones_cierre, kilometraje_egreso, firma_png')
          .eq('trabajo_id', id)
          .maybeSingle(),
        supabase
          .from('ot_detalle_con_permiso')
          .select('id, area, codigo, detalle, cantidad, precio_unitario, total_linea, decision')
          .eq('trabajo_id', id)
          .eq('decision', 'aceptado')
          .order('creado_en'),
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
      setEgreso(egresoData)
      setItems(itemsData || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    cargar()
  }, [cargar])

  if (cargando) return <div className="p-6 text-slate-500">Cargando…</div>
  if (error) return <div className="p-6 text-red-600">{error}</div>
  if (!trabajo) return <div className="p-6 text-slate-500">OT no encontrada.</div>

  const empresa = usuario?.empresas
  const itemsPorArea = items.reduce((acumulado, item) => {
    if (!acumulado[item.area]) acumulado[item.area] = []
    acumulado[item.area].push(item)
    return acumulado
  }, {})
  const { descuento, total, totalBruto, porcentaje } = calcularDescuentoManoObra(items, trabajo.descuento_mano_obra_pct)
  const colorCirculo = trabajo.clientes?.tipo === 'empresa' ? '#2563eb' : '#16a34a'

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
        <Link to={`/trabajos/${id}`} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          Ver OT
        </Link>
        {['admin', 'socia', 'encargado_presupuestos', 'asesor'].includes(usuario?.rol) && (
          <Link
            to={`/facturacion/nuevo?trabajo=${id}`}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
          >
            Emitir documento tributario
          </Link>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600 print:hidden">{error}</p>}

      <div className="max-w-3xl rounded border border-slate-200 bg-white p-6 text-sm text-slate-900 print:flex print:min-h-[250mm] print:flex-col print:border-0 print:p-0">
        <EncabezadoDocumento
          empresa={empresa}
          lineas={['ORDEN DE EGRESO', `OT N° ${trabajo.numero_ot}`]}
          fecha={formatoFecha(trabajo.fecha_entrega) || '—'}
        />

        <div className="mb-3 flex items-center gap-2 border-b border-slate-300 pb-3">
          <span
            title={trabajo.clientes?.tipo === 'empresa' ? 'Cliente empresa' : 'Cliente particular'}
            style={{ backgroundColor: colorCirculo }}
            className="inline-block h-3 w-3 rounded-full"
          />
          <span className="text-xs text-slate-500">
            {trabajo.clientes?.tipo === 'empresa' ? 'Cliente empresa' : 'Cliente particular'}
          </span>
        </div>

        <div className="mb-3 grid grid-cols-4 gap-x-4 gap-y-2 border-b border-slate-300 pb-3">
          <CampoDato etiqueta="Nombre Cliente" valor={nombreCliente(trabajo.clientes)} className="col-span-3" />
          <CampoDato etiqueta="R.U.T." valor={trabajo.clientes?.rut} />
          <CampoDato etiqueta="Dirección" valor={trabajo.clientes?.direccion} className="col-span-4" />
          <CampoDato etiqueta="Email" valor={trabajo.clientes?.email} className="col-span-2" />
          <CampoDato etiqueta="Fonos" valor={trabajo.clientes?.telefono} className="col-span-2" />
          <CampoDato etiqueta="Marca" valor={trabajo.vehiculos?.marca} />
          <CampoDato etiqueta="Modelo" valor={trabajo.vehiculos?.modelo} />
          <CampoDato etiqueta="Color" valor={trabajo.vehiculos?.color} />
          <CampoDato etiqueta="Año" valor={trabajo.vehiculos?.anio} />
          <CampoDato etiqueta="Patente" valor={formatearPatente(trabajo.vehiculos?.patente)} className="col-span-2" />
          <CampoDato
            etiqueta="Kilometraje"
            valor={egreso?.kilometraje_egreso || trabajo.vehiculos?.kilometraje}
            className="col-span-2"
          />
        </div>

        {clienteSolicita && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <p className="font-bold">Cliente Solicita:</p>
            <p className="whitespace-pre-line">{clienteSolicita}</p>
          </div>
        )}

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

        <div className="mb-3 flex items-end justify-between border-b border-slate-300 pb-3">
          <p className="text-xs text-slate-600">
            {trabajo.numero_documento_facturacion
              ? `${trabajo.tipo_documento === 'factura' ? 'Factura' : 'Boleta'} N° ${trabajo.numero_documento_facturacion}` +
                (trabajo.tipo_documento === 'factura'
                  ? ` · ${trabajo.estado_pago === 'pendiente' ? `Pago pendiente, vence ${trabajo.fecha_vencimiento_pago || 'sin fecha'}` : 'Pagada'}`
                  : '')
              : ''}
          </p>
          <BloqueTotales
            filas={
              descuento > 0
                ? [
                    { etiqueta: 'SUBTOTAL', valor: formatoNumero(totalBruto) },
                    { etiqueta: `Desc. M.O. (${textoPorcentaje(porcentaje)}%)`, valor: `-${formatoNumero(descuento)}` },
                    { etiqueta: 'TOTAL', valor: formatoNumero(total), destacado: true },
                  ]
                : [{ etiqueta: 'TOTAL', valor: formatoNumero(total), destacado: true }]
            }
          />
        </div>

        <div className="mb-3 border-b border-slate-300 pb-3">
          <p className="text-xs">
            Recibo el vehículo en plena satisfacción respecto a los servicios realizados por {empresa?.nombre || 'la empresa'}, he
            revisado las pertenencias y detalles de carrocería indicadas en la orden de ingreso dejando excluida a{' '}
            {empresa?.nombre || 'la empresa'} de cualquier reclamo excepto si hay garantías.
          </p>
          <p className="mt-1 text-xs">
            Garantías: Los servicios de mano de obra tienen garantía de 30 días, repuestos usados y reparaciones en
            servicios externos no tienen garantía y los repuestos nuevos tienen garantía de 90 días.
          </p>
          <p className="mt-2">Hora de salida: {formatoHora(trabajo.fecha_entrega)}</p>
          {egreso?.observaciones_cierre && (
            <p className="mt-2">
              <span className="font-bold">Observaciones:</span> {egreso.observaciones_cierre}
            </p>
          )}
          {egreso?.comentario && (
            <p className="mt-1">
              <span className="font-bold">Comentario:</span> {egreso.comentario}
            </p>
          )}
        </div>

        <BloqueFirma titulo="FIRMA CLIENTE" firmaPng={egreso?.firma_png} />
      </div>
    </div>
  )
}

export default OrdenEgreso
