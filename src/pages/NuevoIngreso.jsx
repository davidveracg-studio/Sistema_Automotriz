import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import FirmaCanvas from '../components/FirmaCanvas'
import DiagramaVehiculo from '../components/DiagramaVehiculo'
import EncabezadoDocumento from '../components/EncabezadoDocumento'
import CampoDato from '../components/CampoDato'
import BloqueFirma from '../components/BloqueFirma'
import BloqueTotales from '../components/BloqueTotales'

function normalizarPatenteLocal(patente) {
  return (patente || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function nombreVisible(cliente) {
  if (!cliente) return ''
  if (cliente.tipo === 'empresa') return cliente.razon_social || cliente.nombre
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

// citas.fecha es un `date` sin hora ("2026-09-15"): parsearlo con `new
// Date()` lo interpreta como medianoche UTC y `toLocaleDateString` lo
// muestra un día antes en cualquier huso con offset negativo (Chile
// incluido). Reformatea el string directo, sin pasar por Date.
function formatoFechaCorto(fechaIso) {
  if (!fechaIso) return ''
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}-${mes}-${anio}`
}

const PREGUNTAS_DESCUBRIMIENTO = [
  { clave: 'sintoma', etiqueta: '¿Qué nota que le pasa al vehículo?' },
  { clave: 'desde_cuando', etiqueta: '¿Desde cuándo lo nota?' },
  { clave: 'condiciones', etiqueta: '¿En qué condiciones ocurre (frío, velocidad, frenando)?' },
]

function NuevoIngreso() {
  const { usuario } = useAuth()

  // --- Paso 1: patente ---------------------------------------------------
  const [patenteBusqueda, setPatenteBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [busquedaHecha, setBusquedaHecha] = useState(false)
  const [vehiculo, setVehiculo] = useState(null)
  const [clientesDelVehiculo, setClientesDelVehiculo] = useState([])
  const [errorBusqueda, setErrorBusqueda] = useState(null)

  // --- Retrabajo (opcional): el vehículo ya tiene OT anteriores ----------
  const [trabajosAnteriores, setTrabajosAnteriores] = useState([])
  const [trabajoOriginalId, setTrabajoOriginalId] = useState('')

  // --- Cita agendada (opcional): de acá sale el estado inicial en ClickUp -
  const [citasAbiertas, setCitasAbiertas] = useState([])
  const [citaId, setCitaId] = useState('')

  // --- Vehículo nuevo (si la patente no aparece) --------------------------
  const [creandoVehiculoNuevo, setCreandoVehiculoNuevo] = useState(false)
  const [marcaNueva, setMarcaNueva] = useState('')
  const [modeloNuevo, setModeloNuevo] = useState('')
  const [anioNuevo, setAnioNuevo] = useState('')

  // --- Datos del vehículo para la Orden de Trabajo impresa (existente o
  // nuevo: se completan/corrigen en cada ingreso si faltan) ----------------
  const [colorVehiculo, setColorVehiculo] = useState('')
  const [vinVehiculo, setVinVehiculo] = useState('')
  const [puertasVehiculo, setPuertasVehiculo] = useState('')
  const [aseguradoraVehiculo, setAseguradoraVehiculo] = useState('')
  const [tipoCarroceria, setTipoCarroceria] = useState('sedan')
  const [tipoCombustible, setTipoCombustible] = useState('bencina')
  const [propietarioVehiculo, setPropietarioVehiculo] = useState(null)

  // --- Cliente ------------------------------------------------------------
  const [clienteId, setClienteId] = useState(null)
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null)
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [terminoCliente, setTerminoCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState([])
  const [creandoClienteNuevo, setCreandoClienteNuevo] = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [apellidoNuevo, setApellidoNuevo] = useState('')
  const [telefonoNuevo, setTelefonoNuevo] = useState('')
  const [rutNuevo, setRutNuevo] = useState('')
  const [avisosDuplicado, setAvisosDuplicado] = useState([])

  // --- Formulario de ingreso ------------------------------------------------
  const [tipoIngreso, setTipoIngreso] = useState('diagnostico')
  const [kilometraje, setKilometraje] = useState('')
  const [nivelCombustible, setNivelCombustible] = useState('1/2')
  const [clienteSolicita, setClienteSolicita] = useState('')
  const [diagramaDanos, setDiagramaDanos] = useState([])
  const [danosVisibles, setDanosVisibles] = useState('')
  const [accesorios, setAccesorios] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [respuestasDescubrimiento, setRespuestasDescubrimiento] = useState({})
  const [firmaPng, setFirmaPng] = useState(null)
  const [firmadoPor, setFirmadoPor] = useState('')
  const [firmadoCelular, setFirmadoCelular] = useState('')
  const [rolPersonaPresente, setRolPersonaPresente] = useState('dueno')
  const [avisoKilometraje, setAvisoKilometraje] = useState(null)

  // --- Envío / resultado ----------------------------------------------------
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [otCreada, setOtCreada] = useState(null)

  async function cargarCitasAbiertas(idCliente) {
    try {
      const { data } = await supabase
        .from('citas')
        .select('id, fecha, hora, descripcion')
        .eq('cliente_id', idCliente)
        .in('estado', ['agendada', 'confirmada'])
        .is('trabajo_id', null)
        .order('fecha', { ascending: false })
      setCitasAbiertas(data || [])
    } catch {
      // Ayuda para preseleccionar la cita, no un paso obligatorio: si falla
      // la conexión, el asesor sigue sin marcar ninguna.
    }
  }

  async function buscarVehiculo(evento) {
    evento.preventDefault()
    setBuscando(true)
    setErrorBusqueda(null)
    setBusquedaHecha(false)
    setVehiculo(null)
    setClientesDelVehiculo([])
    setClienteId(null)
    setClienteSeleccionado(null)
    setCreandoVehiculoNuevo(false)
    setTrabajosAnteriores([])
    setTrabajoOriginalId('')
    setCitasAbiertas([])
    setCitaId('')
    setColorVehiculo('')
    setVinVehiculo('')
    setPuertasVehiculo('')
    setAseguradoraVehiculo('')
    setTipoCarroceria('sedan')
    setTipoCombustible('bencina')
    setDiagramaDanos([])
    setPropietarioVehiculo(null)

    try {
      const patenteNorm = normalizarPatenteLocal(patenteBusqueda)
      const { data, error: errorConsulta } = await supabase
        .from('vehiculos')
        .select('id, patente, marca, modelo, anio, kilometraje, color, vin, puertas, aseguradora, tipo_carroceria, tipo_combustible')
        .eq('patente_norm', patenteNorm)
        .is('eliminado_en', null)
        .maybeSingle()

      if (errorConsulta) {
        setErrorBusqueda(errorConsulta.message)
        return
      }

      if (data) {
        setVehiculo(data)
        setColorVehiculo(data.color || '')
        setVinVehiculo(data.vin || '')
        setPuertasVehiculo(data.puertas || '')
        setAseguradoraVehiculo(data.aseguradora || '')
        setTipoCarroceria(data.tipo_carroceria || 'sedan')
        setTipoCombustible(data.tipo_combustible || 'bencina')
        const { data: vinculos, error: errorVinculos } = await supabase
          .from('clientes_vehiculos')
          .select('es_propietario, clientes(id, tipo, nombre, apellido, razon_social, rut, telefono, email, direccion)')
          .eq('vehiculo_id', data.id)
        if (errorVinculos) {
          setErrorBusqueda(errorVinculos.message)
          return
        }
        const clientes = (vinculos || []).map((v) => v.clientes)
        setClientesDelVehiculo(clientes)
        setPropietarioVehiculo((vinculos || []).find((v) => v.es_propietario)?.clientes || null)
        if (clientes.length === 1) {
          setClienteId(clientes[0].id)
          setClienteSeleccionado(clientes[0])
          await cargarCitasAbiertas(clientes[0].id)
        }

        const { data: anteriores } = await supabase
          .from('trabajos_taller')
          .select('id, numero_ot, fecha_ingreso')
          .eq('vehiculo_id', data.id)
          .order('fecha_ingreso', { ascending: false })
        setTrabajosAnteriores(anteriores || [])
      } else {
        setCreandoVehiculoNuevo(true)
      }

      setBusquedaHecha(true)
    } catch {
      setErrorBusqueda('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setBuscando(false)
    }
  }

  async function buscarCliente(evento) {
    evento.preventDefault()
    setBuscandoCliente(true)
    try {
      const termino = terminoCliente.trim()
      const soloDigitos = termino.replace(/\D/g, '')
      let consulta = supabase
        .from('clientes')
        .select('id, tipo, nombre, apellido, razon_social, rut, telefono, email, direccion')
        .is('eliminado_en', null)
        .limit(10)

      const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
      if (soloDigitos) {
        condiciones.push(`rut_norm.ilike.%${soloDigitos}%`)
        condiciones.push(`telefono_norm.ilike.%${soloDigitos}%`)
      }
      consulta = consulta.or(condiciones.join(','))

      const { data, error: errorConsulta } = await consulta
      if (errorConsulta) {
        setError(errorConsulta.message)
        return
      }
      setResultadosCliente(data || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setBuscandoCliente(false)
    }
  }

  async function elegirCliente(cliente) {
    setClienteId(cliente.id)
    setClienteSeleccionado(cliente)
    setResultadosCliente([])
    setCreandoClienteNuevo(false)
    setCitaId('')
    await cargarCitasAbiertas(cliente.id)
  }

  async function revisarDuplicadosClienteNuevo() {
    if (!nombreNuevo && !rutNuevo && !telefonoNuevo) return
    try {
      const { data, error: errorRpc } = await supabase.rpc('clientes_buscar_posibles_duplicados', {
        p_rut: rutNuevo || null,
        p_telefono: telefonoNuevo || null,
        p_nombre: `${nombreNuevo} ${apellidoNuevo}`.trim() || null,
      })
      if (!errorRpc) {
        setAvisosDuplicado(data || [])
      }
    } catch {
      // Revisión de duplicados es una ayuda, no un paso obligatorio: si falla
      // la conexión, se deja pasar en silencio y la creación de más abajo
      // igual mostrará el error de red si corresponde.
    }
  }

  async function crearClienteNuevo() {
    setError(null)
    setGuardando(true)
    try {
      const { data, error: errorInsercion } = await supabase
        .from('clientes')
        .insert({
          empresa_id: usuario.empresa_id,
          tipo: 'persona',
          nombre: nombreNuevo,
          apellido: apellidoNuevo || null,
          telefono: telefonoNuevo || null,
          rut: rutNuevo || null,
        })
        .select()
        .single()

      if (errorInsercion) {
        setError(errorInsercion.message)
        return
      }
      elegirCliente(data)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarEnvioFinal(evento) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)

    try {
      let vehiculoId = vehiculo?.id

      // Vehículo nuevo: se crea (y se vincula al cliente) recién ahora, junto
      // con el resto, para no dejar vehículos huérfanos si el asesor
      // abandona el formulario a mitad de camino.
      if (!vehiculoId) {
        const { data: nuevoVehiculo, error: errorVehiculo } = await supabase
          .from('vehiculos')
          .insert({
            empresa_id: usuario.empresa_id,
            patente: patenteBusqueda,
            marca: marcaNueva,
            modelo: modeloNuevo,
            anio: anioNuevo ? Number(anioNuevo) : null,
            color: colorVehiculo || null,
            vin: vinVehiculo || null,
            puertas: puertasVehiculo ? Number(puertasVehiculo) : null,
            aseguradora: aseguradoraVehiculo || null,
            tipo_carroceria: tipoCarroceria,
            tipo_combustible: tipoCombustible,
          })
          .select()
          .single()

        if (errorVehiculo) {
          setError(
            errorVehiculo.code === '23505'
              ? 'Ya existe un vehículo con esa patente. Vuelve a buscarla arriba.'
              : errorVehiculo.message
          )
          return
        }
        vehiculoId = nuevoVehiculo.id

        const { error: errorVinculo } = await supabase
          .from('clientes_vehiculos')
          .insert({ cliente_id: clienteId, vehiculo_id: vehiculoId, es_propietario: true })
        if (errorVinculo) {
          setError(errorVinculo.message)
          return
        }
      }

      const kilometrajeNumero = kilometraje ? Number(kilometraje) : null

      const { data: trabajo, error: errorTrabajo } = await supabase
        .from('trabajos_taller')
        .insert({
          empresa_id: usuario.empresa_id,
          cliente_id: clienteId,
          vehiculo_id: vehiculoId,
          tipo_ingreso: tipoIngreso,
          asesor_id: usuario.id,
          kilometraje_ingreso: kilometrajeNumero,
          nivel_combustible: nivelCombustible,
          trabajo_original_id: trabajoOriginalId || null,
          cita_id: citaId || null,
        })
        .select()
        .single()

      if (errorTrabajo) {
        setError(errorTrabajo.message)
        return
      }

      if (citaId) {
        await supabase.from('citas').update({ estado: 'completada', trabajo_id: trabajo.id }).eq('id', citaId)
      }

      const { error: errorInspeccion } = await supabase.from('inspecciones_ingreso').insert({
        trabajo_id: trabajo.id,
        cliente_solicita: clienteSolicita || null,
        diagrama_danos: diagramaDanos.length > 0 ? diagramaDanos : null,
        danos_visibles: danosVisibles || null,
        accesorios: accesorios || null,
        observaciones: observaciones || null,
        preguntas_descubrimiento: tipoIngreso === 'diagnostico' ? respuestasDescubrimiento : null,
        firma_png: firmaPng,
        firmado_por: firmadoPor || nombreVisible(clienteSeleccionado),
        firmado_celular: firmadoCelular || null,
        rol_persona_presente: rolPersonaPresente || null,
        firmado_en: firmaPng ? new Date().toISOString() : null,
      })

      if (errorInspeccion) {
        setError(errorInspeccion.message)
        return
      }

      // Si el vehículo ya existía, los campos de color/chasis/puertas/
      // aseguradora se completan u corrigen en este mismo ingreso -son
      // datos que antes no se pedían y muchos vehículos van a llegar sin
      // ellos-. Si era nuevo, ya se guardaron en el insert de arriba.
      if (vehiculo) {
        await supabase
          .from('vehiculos')
          .update({
            color: colorVehiculo || null,
            vin: vinVehiculo || null,
            puertas: puertasVehiculo ? Number(puertasVehiculo) : null,
            aseguradora: aseguradoraVehiculo || null,
            tipo_carroceria: tipoCarroceria,
            tipo_combustible: tipoCombustible,
          })
          .eq('id', vehiculoId)
      }

      if (kilometrajeNumero !== null) {
        if (vehiculo && vehiculo.kilometraje && kilometrajeNumero < vehiculo.kilometraje) {
          setAvisoKilometraje(
            `El kilometraje ingresado (${kilometrajeNumero}) es menor al último registrado (${vehiculo.kilometraje}). Se guardó igual; revisa si hay un error de tipeo.`
          )
        }
        await supabase.from('vehiculos').update({ kilometraje: kilometrajeNumero }).eq('id', vehiculoId)
      }

      setOtCreada(trabajo)
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  // --- Confirmación / documento imprimible ---------------------------------
  if (otCreada) {
    const fechaOt = new Date(otCreada.fecha_ingreso)
    const fechaFormateada = `${String(fechaOt.getDate()).padStart(2, '0')}-${String(fechaOt.getMonth() + 1).padStart(2, '0')}-${fechaOt.getFullYear()}`
    const marcaImpresa = vehiculo ? vehiculo.marca : marcaNueva
    const modeloImpreso = vehiculo ? vehiculo.modelo : modeloNuevo
    const anioImpreso = vehiculo ? vehiculo.anio : anioNuevo
    const nombreDueno = propietarioVehiculo ? nombreVisible(propietarioVehiculo) : nombreVisible(clienteSeleccionado)
    const empresa = usuario?.empresas

    return (
      <div className="p-6">
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-4 text-green-900 print:hidden">
          <p className="font-medium">Ingreso registrado — OT {otCreada.numero_ot}</p>
          {avisoKilometraje && <p className="mt-1 text-sm text-amber-700">{avisoKilometraje}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Imprimir / guardar como PDF
            </button>
            <Link
              to={`/trabajos/${otCreada.id}`}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Ver OT
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Registrar otro ingreso
            </button>
          </div>
        </div>

        <div className="max-w-3xl rounded border border-slate-200 bg-white p-6 text-sm text-slate-900 print:flex print:min-h-[250mm] print:flex-col print:border-0 print:p-0">
          <EncabezadoDocumento
            empresa={empresa}
            lineas={[`ORDEN DE TRABAJO N° ${otCreada.numero_ot}`]}
            fecha={fechaFormateada}
          />

          <div className="mb-3 grid grid-cols-4 gap-x-4 gap-y-2 border-b border-slate-300 pb-3">
            <CampoDato etiqueta="Nombre Cliente" valor={nombreVisible(clienteSeleccionado)} className="col-span-3" />
            <CampoDato etiqueta="R.U.T." valor={clienteSeleccionado?.rut} />
            <CampoDato etiqueta="Dirección" valor={clienteSeleccionado?.direccion} className="col-span-2" />
            <CampoDato etiqueta="Dueño Vehículo" valor={nombreDueno} className="col-span-2" />
            <CampoDato etiqueta="Email" valor={clienteSeleccionado?.email} className="col-span-2" />
            <CampoDato etiqueta="Fonos" valor={clienteSeleccionado?.telefono} className="col-span-2" />
            <CampoDato etiqueta="Marca" valor={marcaImpresa} />
            <CampoDato etiqueta="Modelo" valor={modeloImpreso} />
            <CampoDato etiqueta="Color" valor={colorVehiculo} />
            <CampoDato etiqueta="Año" valor={anioImpreso} />
            <CampoDato etiqueta="Chasis / VIN" valor={vinVehiculo} />
            <CampoDato etiqueta="Puertas" valor={puertasVehiculo} />
            <CampoDato etiqueta="Cía. Aseguradora" valor={aseguradoraVehiculo} className="col-span-2" />
            <CampoDato etiqueta="Kilometraje" valor={kilometraje} className="col-span-2" />
            <CampoDato etiqueta="Patente" valor={patenteBusqueda.toUpperCase()} className="col-span-2" />
          </div>

          <div className="mb-3 border-b border-slate-300 pb-3">
            <p className="font-bold">Cliente Solicita:</p>
            <p className="whitespace-pre-line">{clienteSolicita || '—'}</p>
          </div>

          {diagramaDanos.length > 0 && (
            <div className="mb-3 border-b border-slate-300 pb-3">
              <p className="mb-1 font-bold">Diagrama de daños/detalles:</p>
              <div className="max-w-xs print:max-w-[45%]">
                <DiagramaVehiculo tipo={tipoCarroceria} marcas={diagramaDanos} onCambio={() => {}} soloLectura />
              </div>
            </div>
          )}

          <div className="mb-3 border-b border-slate-300 pb-3 text-xs">
            <p className="mb-1 font-bold">POLITICAS DE SERVICIO</p>
            <p className="mb-1">
              1) CLIENTE: Autorizo a {empresa?.nombre || 'la empresa'} para efectuar trabajos indicados en esta orden
              de ingreso y en presupuesto efectuado. También autorizo la movilización del vehículo por calles y
              carretera con el fin de efectuar pruebas pertinentes.
            </p>
            <p>
              2) EMPRESA: La entidad solo se hace responsable por el servicio prestado conforme a la petición del
              cliente, NO por desperfectos ajenos al trabajo efectuado, ya sea por cumplimiento de la vida útil de
              las piezas del mismo vehículo o por el uso dado por el cliente.
            </p>
          </div>

          <BloqueFirma
            titulo="FIRMA CLIENTE INGRESO"
            firmaPng={firmaPng}
            campos={[
              { etiqueta: 'Nombre y apellido', valor: firmadoPor || nombreVisible(clienteSeleccionado) },
              { etiqueta: 'N° de celular', valor: firmadoCelular },
              { etiqueta: '¿Eres dueño o conductor?', valor: rolPersonaPresente === 'conductor' ? 'Conductor' : 'Dueño' },
            ]}
          />

          <BloqueTotales className="mt-3" filas={[{ etiqueta: 'TOTAL', valor: 0, destacado: true }]} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Nuevo ingreso</h1>

      {/* Paso 1: patente */}
      <form onSubmit={buscarVehiculo} className="mb-6 flex max-w-md gap-2">
        <input
          type="text"
          required
          value={patenteBusqueda}
          onChange={(evento) => setPatenteBusqueda(evento.target.value)}
          placeholder="Patente (GH TY 34)"
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase"
        />
        <button
          type="submit"
          disabled={buscando}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {errorBusqueda && <p className="mb-4 text-sm text-red-600">{errorBusqueda}</p>}

      {busquedaHecha && vehiculo && (
        <div className="mb-6 max-w-md rounded border border-slate-200 bg-white p-4">
          <p className="font-medium text-slate-800">
            {vehiculo.patente} — {vehiculo.marca} {vehiculo.modelo} {vehiculo.anio || ''}
          </p>
          {clientesDelVehiculo.length === 0 && (
            <p className="mt-2 text-sm text-amber-700">Este vehículo no tiene un cliente vinculado todavía.</p>
          )}
          {clientesDelVehiculo.length > 1 && (
            <div className="mt-2 space-y-1 text-sm">
              <p className="text-slate-600">¿Quién trae el vehículo hoy?</p>
              {clientesDelVehiculo.map((cliente) => (
                <label key={cliente.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={clienteId === cliente.id}
                    onChange={() => elegirCliente(cliente)}
                  />
                  {nombreVisible(cliente)}
                </label>
              ))}
            </div>
          )}
          {clientesDelVehiculo.length === 1 && (
            <p className="mt-1 text-sm text-slate-600">Cliente: {nombreVisible(clientesDelVehiculo[0])}</p>
          )}
        </div>
      )}

      {busquedaHecha && creandoVehiculoNuevo && (
        <div className="mb-6 max-w-md rounded border border-amber-300 bg-amber-50 p-4">
          <p className="mb-3 text-sm font-medium text-amber-900">
            No hay ningún vehículo con esa patente. Se creará uno nuevo.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Marca</label>
              <input
                required
                value={marcaNueva}
                onChange={(evento) => setMarcaNueva(evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Modelo</label>
              <input
                required
                value={modeloNuevo}
                onChange={(evento) => setModeloNuevo(evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="mb-1 w-32">
            <label className="mb-1 block text-sm font-medium text-slate-700">Año</label>
            <input
              type="number"
              value={anioNuevo}
              onChange={(evento) => setAnioNuevo(evento.target.value)}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Cliente: solo se pide buscar/crear si el vehículo es nuevo o no tiene cliente vinculado */}
      {busquedaHecha && !clienteId && (creandoVehiculoNuevo || clientesDelVehiculo.length === 0) && (
        <div className="mb-6 max-w-md rounded border border-slate-200 bg-white p-4">
          <p className="mb-2 font-medium text-slate-800">¿Quién trae el vehículo?</p>

          <form onSubmit={buscarCliente} className="mb-3 flex gap-2">
            <input
              type="text"
              value={terminoCliente}
              onChange={(evento) => setTerminoCliente(evento.target.value)}
              placeholder="Buscar cliente por nombre, RUT o teléfono"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={buscandoCliente}
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              Buscar
            </button>
          </form>

          {resultadosCliente.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {resultadosCliente.map((cliente) => (
                <li key={cliente.id}>
                  <button
                    type="button"
                    onClick={() => elegirCliente(cliente)}
                    className="text-slate-700 underline hover:text-slate-900"
                  >
                    {nombreVisible(cliente)} {cliente.rut ? `· ${cliente.rut}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!creandoClienteNuevo ? (
            <button
              type="button"
              onClick={() => setCreandoClienteNuevo(true)}
              className="text-sm text-slate-500 underline hover:text-slate-700"
            >
              + Cliente nuevo
            </button>
          ) : (
            <div className="mt-2 border-t border-slate-100 pt-3">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <input
                  placeholder="Nombre"
                  value={nombreNuevo}
                  onChange={(evento) => setNombreNuevo(evento.target.value)}
                  onBlur={revisarDuplicadosClienteNuevo}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Apellido"
                  value={apellidoNuevo}
                  onChange={(evento) => setApellidoNuevo(evento.target.value)}
                  onBlur={revisarDuplicadosClienteNuevo}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Teléfono"
                  value={telefonoNuevo}
                  onChange={(evento) => setTelefonoNuevo(evento.target.value)}
                  onBlur={revisarDuplicadosClienteNuevo}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  placeholder="RUT"
                  value={rutNuevo}
                  onChange={(evento) => setRutNuevo(evento.target.value)}
                  onBlur={revisarDuplicadosClienteNuevo}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              {avisosDuplicado.length > 0 && (
                <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  Ya existen clientes parecidos: {avisosDuplicado.map((a) => nombreVisible(a)).join(', ')}. Revisa
                  antes de crear uno nuevo.
                </div>
              )}
              <button
                type="button"
                onClick={crearClienteNuevo}
                disabled={!nombreNuevo}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Crear y continuar
              </button>
            </div>
          )}
        </div>
      )}

      {clienteId && (vehiculo || (marcaNueva && modeloNuevo)) && (
        <form onSubmit={manejarEnvioFinal} className="max-w-2xl rounded border border-slate-200 bg-white p-4">
          <p className="mb-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Ingresando a <span className="font-medium">{nombreVisible(clienteSeleccionado)}</span>
          </p>

          <div className="mb-4 rounded border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">
              Datos del vehículo para la Orden de Trabajo {vehiculo && '(completa lo que falte)'}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Color</label>
                <input
                  value={colorVehiculo}
                  onChange={(evento) => setColorVehiculo(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Chasis / VIN</label>
                <input
                  value={vinVehiculo}
                  onChange={(evento) => setVinVehiculo(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">N° de puertas</label>
                <input
                  type="number"
                  value={puertasVehiculo}
                  onChange={(evento) => setPuertasVehiculo(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Cía. aseguradora</label>
                <input
                  value={aseguradoraVehiculo}
                  onChange={(evento) => setAseguradoraVehiculo(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Tipo de carrocería</label>
                <select
                  value={tipoCarroceria}
                  onChange={(evento) => setTipoCarroceria(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="sedan">Sedán</option>
                  <option value="hatchback">Hatchback</option>
                  <option value="suv">SUV</option>
                  <option value="furgon">Furgón</option>
                  <option value="pickup">Pick up</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Combustible</label>
                <select
                  value={tipoCombustible}
                  onChange={(evento) => setTipoCombustible(evento.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  <option value="bencina">Bencina</option>
                  <option value="diesel">Diésel</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mb-4 rounded border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Diagrama de daños/detalles al ingreso</p>
            <DiagramaVehiculo tipo={tipoCarroceria} marcas={diagramaDanos} onCambio={setDiagramaDanos} />
          </div>

          <div className="mb-4 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={tipoIngreso === 'diagnostico'}
                onChange={() => setTipoIngreso('diagnostico')}
              />
              Tipo A — Diagnóstico
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={tipoIngreso === 'servicio_agendado'}
                onChange={() => setTipoIngreso('servicio_agendado')}
              />
              Tipo B — Servicio agendado
            </label>
          </div>

          {citasAbiertas.length > 0 && (
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                ¿Viene de una cita agendada? (opcional)
              </label>
              <select
                value={citaId}
                onChange={(evento) => setCitaId(evento.target.value)}
                className="w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Sin cita, ingreso directo</option>
                {citasAbiertas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatoFechaCorto(c.fecha)}
                    {c.hora ? ` ${c.hora}` : ''} {c.descripcion ? `— ${c.descripcion}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Marca esto si el cliente había reservado hora en Agenda. Define el estado con el que nace la tarjeta
                en ClickUp.
              </p>
            </div>
          )}

          {trabajosAnteriores.length > 0 && (
            <div className="mb-3">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                ¿Retrabajo de una OT anterior? (opcional)
              </label>
              <select
                value={trabajoOriginalId}
                onChange={(evento) => setTrabajoOriginalId(evento.target.value)}
                className="w-full max-w-xs rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">No es un retrabajo</option>
                {trabajosAnteriores.map((t) => (
                  <option key={t.id} value={t.id}>
                    OT {t.numero_ot} — {new Date(t.fecha_ingreso).toLocaleDateString('es-CL')}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Marca esto si el vehículo vuelve por el mismo problema que una OT anterior. Alimenta el informe de
                calidad por técnico.
              </p>
            </div>
          )}

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Kilometraje</label>
              <input
                type="number"
                value={kilometraje}
                onChange={(evento) => setKilometraje(evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Combustible</label>
              <select
                value={nivelCombustible}
                onChange={(evento) => setNivelCombustible(evento.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="vacio">Vacío</option>
                <option value="1/4">1/4</option>
                <option value="1/2">1/2</option>
                <option value="3/4">3/4</option>
                <option value="lleno">Lleno</option>
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Cliente solicita</label>
            <textarea
              value={clienteSolicita}
              onChange={(evento) => setClienteSolicita(evento.target.value)}
              rows={3}
              placeholder="Lo que el cliente pide revisar o reparar, tal como lo dice"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Daños visibles</label>
            <textarea
              value={danosVisibles}
              onChange={(evento) => setDanosVisibles(evento.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Accesorios</label>
            <textarea
              value={accesorios}
              onChange={(evento) => setAccesorios(evento.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">Observaciones</label>
            <textarea
              value={observaciones}
              onChange={(evento) => setObservaciones(evento.target.value)}
              rows={2}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {tipoIngreso === 'diagnostico' && (
            <div className="mb-4 rounded border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-700">Preguntas de descubrimiento</p>
              {PREGUNTAS_DESCUBRIMIENTO.map((pregunta) => (
                <div key={pregunta.clave} className="mb-2">
                  <label className="mb-1 block text-xs text-slate-500">{pregunta.etiqueta}</label>
                  <input
                    value={respuestasDescubrimiento[pregunta.clave] || ''}
                    onChange={(evento) =>
                      setRespuestasDescubrimiento((actual) => ({ ...actual, [pregunta.clave]: evento.target.value }))
                    }
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">Firma de conformidad</label>
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <input
                placeholder="Nombre de quien firma"
                value={firmadoPor}
                onChange={(evento) => setFirmadoPor(evento.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="N° de celular"
                value={firmadoCelular}
                onChange={(evento) => setFirmadoCelular(evento.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={rolPersonaPresente}
                onChange={(evento) => setRolPersonaPresente(evento.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="dueno">Es dueño</option>
                <option value="conductor">Es conductor</option>
              </select>
            </div>
            <FirmaCanvas onCambio={setFirmaPng} />
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar ingreso'}
          </button>
        </form>
      )}
    </div>
  )
}

export default NuevoIngreso
