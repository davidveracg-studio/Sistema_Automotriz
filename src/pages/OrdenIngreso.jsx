import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import DiagramaVehiculo from '../components/DiagramaVehiculo'
import EncabezadoDocumento from '../components/EncabezadoDocumento'
import CampoDato from '../components/CampoDato'
import BloqueFirma from '../components/BloqueFirma'
import BloqueTotales from '../components/BloqueTotales'
import { formatearPatente } from '../lib/patente'

function nombreCliente(cliente) {
  if (!cliente) return ''
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoFecha(fechaIso) {
  if (!fechaIso) return null
  const fecha = new Date(fechaIso)
  return `${String(fecha.getDate()).padStart(2, '0')}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${fecha.getFullYear()}`
}

// Orden de ingreso (ORDEN DE TRABAJO) de una OT ya registrada: mismo documento
// que se ve al terminar el ingreso, armado desde lo guardado en la base para
// poder volver a verlo o imprimirlo cuando se necesite.
function OrdenIngreso() {
  const { id } = useParams()
  const { usuario } = useAuth()

  const [trabajo, setTrabajo] = useState(null)
  const [inspeccion, setInspeccion] = useState(null)
  const [propietario, setPropietario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [{ data: trabajoData, error: errorTrabajo }, { data: inspeccionData, error: errorInspeccion }] = await Promise.all([
        supabase
          .from('trabajos_taller')
          .select(
            'numero_ot, fecha_ingreso, kilometraje_ingreso, vehiculo_id, ' +
              'clientes(nombre, apellido, razon_social, rut, tipo, direccion, email, telefono), ' +
              'vehiculos(patente, marca, modelo, anio, color, vin, puertas, aseguradora, kilometraje, tipo_carroceria)'
          )
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('inspecciones_ingreso')
          .select('cliente_solicita, diagrama_danos, firma_png, firmado_por, firmado_celular, rol_persona_presente')
          .eq('trabajo_id', id)
          .maybeSingle(),
      ])
      if (errorTrabajo) throw errorTrabajo
      if (errorInspeccion) throw errorInspeccion
      setTrabajo(trabajoData)
      setInspeccion(inspeccionData)

      if (trabajoData?.vehiculo_id) {
        const { data: vinculos } = await supabase
          .from('clientes_vehiculos')
          .select('es_propietario, clientes(nombre, apellido, razon_social)')
          .eq('vehiculo_id', trabajoData.vehiculo_id)
        setPropietario((vinculos || []).find((v) => v.es_propietario)?.clientes || null)
      }
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
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
  const cliente = trabajo.clientes
  const vehiculo = trabajo.vehiculos
  const marcas = Array.isArray(inspeccion?.diagrama_danos) ? inspeccion.diagrama_danos : []

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
      </div>

      <div className="max-w-3xl rounded border border-slate-200 bg-white p-6 text-sm text-slate-900 print:flex print:min-h-[250mm] print:flex-col print:border-0 print:p-0">
        <EncabezadoDocumento empresa={empresa} lineas={[`ORDEN DE TRABAJO N° ${trabajo.numero_ot}`]} fecha={formatoFecha(trabajo.fecha_ingreso) || '—'} />

        <div className="mb-3 grid grid-cols-4 gap-x-4 gap-y-2 border-b border-slate-300 pb-3">
          <CampoDato etiqueta="Nombre Cliente" valor={nombreCliente(cliente)} className="col-span-3" />
          <CampoDato etiqueta="R.U.T." valor={cliente?.rut} />
          <CampoDato etiqueta="Dirección" valor={cliente?.direccion} className="col-span-2" />
          <CampoDato etiqueta="Dueño Vehículo" valor={propietario ? nombreCliente(propietario) : nombreCliente(cliente)} className="col-span-2" />
          <CampoDato etiqueta="Email" valor={cliente?.email} className="col-span-2" />
          <CampoDato etiqueta="Fonos" valor={cliente?.telefono} className="col-span-2" />
          <CampoDato etiqueta="Marca" valor={vehiculo?.marca} />
          <CampoDato etiqueta="Modelo" valor={vehiculo?.modelo} />
          <CampoDato etiqueta="Color" valor={vehiculo?.color} />
          <CampoDato etiqueta="Año" valor={vehiculo?.anio} />
          <CampoDato etiqueta="Chasis / VIN" valor={vehiculo?.vin} />
          <CampoDato etiqueta="Puertas" valor={vehiculo?.puertas} />
          <CampoDato etiqueta="Cía. Aseguradora" valor={vehiculo?.aseguradora} className="col-span-2" />
          <CampoDato etiqueta="Kilometraje" valor={trabajo.kilometraje_ingreso ?? vehiculo?.kilometraje} className="col-span-2" />
          <CampoDato etiqueta="Patente" valor={formatearPatente(vehiculo?.patente)} className="col-span-2" />
        </div>

        <div className="mb-3 border-b border-slate-300 pb-3">
          <p className="font-bold">Cliente Solicita:</p>
          <p className="whitespace-pre-line">{inspeccion?.cliente_solicita || '—'}</p>
        </div>

        {marcas.length > 0 && (
          <div className="mb-3 border-b border-slate-300 pb-3">
            <p className="mb-1 font-bold">Diagrama de daños/detalles:</p>
            <div className="max-w-xs print:max-w-[45%]">
              <DiagramaVehiculo tipo={vehiculo?.tipo_carroceria} marcas={marcas} onCambio={() => {}} soloLectura />
            </div>
          </div>
        )}

        <div className="mb-3 border-b border-slate-300 pb-3 text-xs">
          <p className="mb-1 font-bold">POLITICAS DE SERVICIO</p>
          <p className="mb-1">
            1) CLIENTE: Autorizo a {empresa?.nombre || 'la empresa'} para efectuar trabajos indicados en esta orden de ingreso y en
            presupuesto efectuado. También autorizo la movilización del vehículo por calles y carretera con el fin de efectuar pruebas
            pertinentes.
          </p>
          <p>
            2) EMPRESA: La entidad solo se hace responsable por el servicio prestado conforme a la petición del cliente, NO por
            desperfectos ajenos al trabajo efectuado, ya sea por cumplimiento de la vida útil de las piezas del mismo vehículo o por el
            uso dado por el cliente.
          </p>
        </div>

        <BloqueFirma
          titulo="FIRMA CLIENTE INGRESO"
          firmaPng={inspeccion?.firma_png}
          campos={[
            { etiqueta: 'Nombre y apellido', valor: inspeccion?.firmado_por || nombreCliente(cliente) },
            { etiqueta: 'N° de celular', valor: inspeccion?.firmado_celular },
            { etiqueta: '¿Eres dueño o conductor?', valor: inspeccion?.rol_persona_presente === 'conductor' ? 'Conductor' : 'Dueño' },
          ]}
        />

        <BloqueTotales className="mt-3" filas={[{ etiqueta: 'TOTAL', valor: 0, destacado: true }]} />
      </div>
    </div>
  )
}

export default OrdenIngreso
