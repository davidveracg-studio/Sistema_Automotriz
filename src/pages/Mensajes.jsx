import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const ETIQUETA_ESTADO = {
  nuevo: 'Nuevo',
  en_conversacion: 'En conversación',
  agendado: 'Agendado',
  resuelto: 'Resuelto',
  sin_interes: 'Sin interés',
}

const COLOR_ESTADO = {
  nuevo: 'bg-blue-100 text-blue-800',
  en_conversacion: 'bg-amber-100 text-amber-800',
  agendado: 'bg-purple-100 text-purple-800',
  resuelto: 'bg-green-100 text-green-800',
  sin_interes: 'bg-slate-100 text-slate-500',
}

const FILTROS_ESTADO = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'nuevo', etiqueta: 'Nuevo' },
  { valor: 'en_conversacion', etiqueta: 'En conversación' },
  { valor: 'agendado', etiqueta: 'Agendado' },
  { valor: 'resuelto', etiqueta: 'Resuelto' },
  { valor: 'sin_interes', etiqueta: 'Sin interés' },
]

// Sondeo simple en vez de una suscripción de Supabase Realtime -este
// proyecto no usa Realtime en ninguna otra pantalla todavía-: alcanza para
// el volumen del taller y no introduce un patrón nuevo solo para esto.
const INTERVALO_ACTUALIZACION_MS = 15000

function nombreCliente(cliente) {
  if (!cliente) return null
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function formatoHora(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Solo mensajes de texto se muestran con su contenido real; el resto
// (imagen, documento, audio...) se etiqueta genérico -verlos de verdad
// requiere descargar el archivo desde la Graph API con el token, fuera de
// alcance de esta primera versión del panel-.
function resumenMensaje(mensaje) {
  if (!mensaje) return ''
  if (mensaje.tipo_mensaje === 'text') return mensaje.contenido?.text?.body || ''
  return `[${mensaje.tipo_mensaje}]`
}

function Mensajes() {
  const [cuentas, setCuentas] = useState([])
  const [contactos, setContactos] = useState([])
  const [ultimoPorContacto, setUltimoPorContacto] = useState({})
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [seleccionado, setSeleccionado] = useState(null)
  const [mensajes, setMensajes] = useState([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)

  const [terminoCliente, setTerminoCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState([])
  const [buscandoCliente, setBuscandoCliente] = useState(false)
  const [vehiculosCliente, setVehiculosCliente] = useState([])

  const cargarBandeja = useCallback(async () => {
    try {
      const [
        { data: cuentasData, error: errorCuentas },
        { data: contactosData, error: errorContactos },
        { data: recientes, error: errorRecientes },
      ] = await Promise.all([
        supabase.from('whatsapp_cuentas').select('phone_number_id, etiqueta, telefono_visible'),
        supabase
          .from('whatsapp_contactos')
          .select(
            'id, phone_number_id, wa_id, nombre_whatsapp, estado, cliente_id, vehiculo_id, bot_pausado, actualizado_en, clientes(nombre, apellido, razon_social), vehiculos(patente, marca, modelo)'
          )
          .order('actualizado_en', { ascending: false }),
        supabase
          .from('whatsapp_mensajes')
          .select('wamid, phone_number_id, wa_id, direccion, tipo_mensaje, contenido, wa_timestamp')
          .order('wa_timestamp', { ascending: false })
          .limit(300),
      ])

      if (errorCuentas) throw errorCuentas
      if (errorContactos) throw errorContactos
      if (errorRecientes) throw errorRecientes

      setCuentas(cuentasData || [])
      setContactos(contactosData || [])

      const ultimos = {}
      for (const mensaje of recientes || []) {
        const clave = `${mensaje.phone_number_id}|${mensaje.wa_id}`
        if (!ultimos[clave]) ultimos[clave] = mensaje
      }
      setUltimoPorContacto(ultimos)
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargarBandeja()
    const intervalo = setInterval(cargarBandeja, INTERVALO_ACTUALIZACION_MS)
    return () => clearInterval(intervalo)
  }, [cargarBandeja])

  const cargarHilo = useCallback(async (contacto) => {
    try {
      const { data, error: errorHilo } = await supabase
        .from('whatsapp_mensajes')
        .select('wamid, direccion, origen, tipo_mensaje, contenido, estado_entrega, wa_timestamp')
        .eq('phone_number_id', contacto.phone_number_id)
        .eq('wa_id', contacto.wa_id)
        .order('wa_timestamp', { ascending: true })
      if (errorHilo) throw errorHilo
      setMensajes(data || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cargar la conversación.')
    }
  }, [])

  function seleccionarContacto(contacto) {
    setSeleccionado(contacto)
    setTerminoCliente('')
    setResultadosCliente([])
    setVehiculosCliente([])
    cargarHilo(contacto)
  }

  useEffect(() => {
    if (!seleccionado) return undefined
    const intervalo = setInterval(() => cargarHilo(seleccionado), INTERVALO_ACTUALIZACION_MS)
    return () => clearInterval(intervalo)
  }, [seleccionado, cargarHilo])

  async function cambiarEstado(nuevoEstado) {
    if (!seleccionado) return
    try {
      const { error: errorUpdate } = await supabase.from('whatsapp_contactos').update({ estado: nuevoEstado }).eq('id', seleccionado.id)
      if (errorUpdate) throw errorUpdate
      setSeleccionado((anterior) => ({ ...anterior, estado: nuevoEstado }))
      setContactos((anterior) => anterior.map((c) => (c.id === seleccionado.id ? { ...c, estado: nuevoEstado } : c)))
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cambiar el estado.')
    }
  }

  // El bot de agendamiento (0034_agenda_calendario_y_bot.sql) se pausa solo
  // apenas alguien de Recepción responde -desde acá o desde la app del
  // celular-, para no contestar por encima de una conversación humana.
  // Reactivarlo también limpia bot_estado: si no, retomaría a mitad de un
  // menú que el cliente ya olvidó.
  async function cambiarBotPausado(pausado) {
    if (!seleccionado) return
    try {
      const cambios = pausado ? { bot_pausado: true } : { bot_pausado: false, bot_estado: null, bot_contexto: null }
      const { error: errorUpdate } = await supabase.from('whatsapp_contactos').update(cambios).eq('id', seleccionado.id)
      if (errorUpdate) throw errorUpdate
      setSeleccionado((anterior) => ({ ...anterior, bot_pausado: pausado }))
      setContactos((anterior) => anterior.map((c) => (c.id === seleccionado.id ? { ...c, bot_pausado: pausado } : c)))
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo cambiar el estado del bot.')
    }
  }

  async function buscarCliente(evento) {
    evento.preventDefault()
    const termino = terminoCliente.trim()
    if (!termino) {
      setResultadosCliente([])
      return
    }
    setBuscandoCliente(true)
    try {
      const soloDigitos = termino.replace(/\D/g, '')
      let consulta = supabase.from('clientes').select('id, nombre, apellido, razon_social, telefono').is('eliminado_en', null).limit(10)
      const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
      if (soloDigitos) condiciones.push(`telefono_norm.ilike.%${soloDigitos}%`)
      consulta = consulta.or(condiciones.join(','))

      const { data, error: errorBusqueda } = await consulta
      if (errorBusqueda) throw errorBusqueda
      setResultadosCliente(data || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo buscar el cliente.')
    } finally {
      setBuscandoCliente(false)
    }
  }

  async function vincularCliente(cliente) {
    if (!seleccionado) return
    try {
      const { error: errorUpdate } = await supabase
        .from('whatsapp_contactos')
        .update({ cliente_id: cliente.id, estado: seleccionado.estado === 'nuevo' ? 'en_conversacion' : seleccionado.estado })
        .eq('id', seleccionado.id)
      if (errorUpdate) throw errorUpdate

      const { data: vehiculosData, error: errorVehiculos } = await supabase
        .from('clientes_vehiculos')
        .select('vehiculos(id, patente, marca, modelo)')
        .eq('cliente_id', cliente.id)
      if (errorVehiculos) throw errorVehiculos

      const actualizado = {
        ...seleccionado,
        cliente_id: cliente.id,
        clientes: cliente,
        estado: seleccionado.estado === 'nuevo' ? 'en_conversacion' : seleccionado.estado,
      }
      setSeleccionado(actualizado)
      setContactos((anterior) => anterior.map((c) => (c.id === seleccionado.id ? actualizado : c)))
      setVehiculosCliente((vehiculosData || []).map((fila) => fila.vehiculos).filter(Boolean))
      setResultadosCliente([])
      setTerminoCliente('')
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo vincular el cliente.')
    }
  }

  async function vincularVehiculo(vehiculoIdCrudo) {
    if (!seleccionado) return
    const vehiculoId = vehiculoIdCrudo || null
    try {
      const { error: errorUpdate } = await supabase.from('whatsapp_contactos').update({ vehiculo_id: vehiculoId }).eq('id', seleccionado.id)
      if (errorUpdate) throw errorUpdate
      setSeleccionado((anterior) => ({ ...anterior, vehiculo_id: vehiculoId }))
      setContactos((anterior) => anterior.map((c) => (c.id === seleccionado.id ? { ...c, vehiculo_id: vehiculoId } : c)))
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo vincular el vehículo.')
    }
  }

  async function enviarMensaje(evento) {
    evento.preventDefault()
    if (!seleccionado || !texto.trim()) return
    setEnviando(true)
    try {
      const { data, error: errorEnvio } = await supabase.functions.invoke('whatsapp', {
        body: { phone_number_id: seleccionado.phone_number_id, wa_id: seleccionado.wa_id, texto: texto.trim() },
      })
      if (errorEnvio) throw errorEnvio
      if (data?.error) throw new Error(data.error.mensaje || 'Meta rechazó el envío.')
      setTexto('')
      // La función ya marcó bot_pausado=true del lado del servidor (un
      // humano está respondiendo); se refleja acá para no esperar al
      // próximo sondeo de la bandeja.
      setSeleccionado((anterior) => ({ ...anterior, bot_pausado: true }))
      setContactos((anterior) => anterior.map((c) => (c.id === seleccionado.id ? { ...c, bot_pausado: true } : c)))
      await cargarHilo(seleccionado)
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo enviar el mensaje.')
    } finally {
      setEnviando(false)
    }
  }

  const contactosFiltrados = contactos.filter((contacto) => filtroEstado === 'todos' || contacto.estado === filtroEstado)

  return (
    <div className="flex h-screen flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mensajes de WhatsApp</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="flex flex-1 overflow-hidden rounded border border-slate-200 bg-white">
        <div className="flex w-80 shrink-0 flex-col border-r border-slate-200">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2">
            {FILTROS_ESTADO.map((filtro) => (
              <button
                key={filtro.valor}
                type="button"
                onClick={() => setFiltroEstado(filtro.valor)}
                className={`rounded px-2 py-1 text-xs ${
                  filtroEstado === filtro.valor ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {filtro.etiqueta}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {cargando && <p className="p-4 text-center text-sm text-slate-400">Cargando…</p>}
            {!cargando && contactosFiltrados.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-400">Sin conversaciones para este filtro.</p>
            )}
            {contactosFiltrados.map((contacto) => {
              const clave = `${contacto.phone_number_id}|${contacto.wa_id}`
              const ultimo = ultimoPorContacto[clave]
              const cuenta = cuentas.find((c) => c.phone_number_id === contacto.phone_number_id)
              return (
                <button
                  key={contacto.id}
                  type="button"
                  onClick={() => seleccionarContacto(contacto)}
                  className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${
                    seleccionado?.id === contacto.id ? 'bg-slate-100' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {nombreCliente(contacto.clientes) || contacto.nombre_whatsapp || contacto.wa_id}
                    </p>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${COLOR_ESTADO[contacto.estado] || ''}`}>
                      {ETIQUETA_ESTADO[contacto.estado] || contacto.estado}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {cuenta?.etiqueta || '—'} · {contacto.vehiculos?.patente || 'sin vehículo vinculado'}
                  </p>
                  {ultimo && <p className="mt-1 truncate text-xs text-slate-400">{resumenMensaje(ultimo)}</p>}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-1 flex-col">
          {!seleccionado ? (
            <p className="flex flex-1 items-center justify-center text-sm text-slate-400">Elige una conversación de la izquierda.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {nombreCliente(seleccionado.clientes) || seleccionado.nombre_whatsapp || seleccionado.wa_id}
                  </p>
                  <p className="text-xs text-slate-500">{seleccionado.wa_id}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-1 text-[11px] font-medium ${
                      seleccionado.bot_pausado ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {seleccionado.bot_pausado ? 'Bot en pausa' : 'Bot activo'}
                  </span>
                  <button
                    type="button"
                    onClick={() => cambiarBotPausado(!seleccionado.bot_pausado)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    {seleccionado.bot_pausado ? 'Reactivar bot' : 'Tomar la conversación'}
                  </button>
                  <select
                    value={seleccionado.estado}
                    onChange={(evento) => cambiarEstado(evento.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                  >
                    {Object.entries(ETIQUETA_ESTADO).map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>
                        {etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-b border-slate-200 p-3">
                {seleccionado.cliente_id ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>Vinculado a {nombreCliente(seleccionado.clientes)}.</span>
                    {vehiculosCliente.length > 0 && (
                      <select
                        value={seleccionado.vehiculo_id || ''}
                        onChange={(evento) => vincularVehiculo(evento.target.value)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="">Sin vehículo</option>
                        {vehiculosCliente.map((vehiculo) => (
                          <option key={vehiculo.id} value={vehiculo.id}>
                            {vehiculo.patente} — {vehiculo.marca} {vehiculo.modelo}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <form onSubmit={buscarCliente} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={terminoCliente}
                      onChange={(evento) => setTerminoCliente(evento.target.value)}
                      placeholder="Buscar cliente por nombre o teléfono para vincular…"
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={buscandoCliente}
                      className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                    >
                      Buscar
                    </button>
                    {resultadosCliente.length > 0 && (
                      <div className="w-full space-y-1">
                        {resultadosCliente.map((cliente) => (
                          <button
                            key={cliente.id}
                            type="button"
                            onClick={() => vincularCliente(cliente)}
                            className="block w-full rounded border border-slate-200 px-2 py-1 text-left text-xs hover:bg-slate-100"
                          >
                            {nombreCliente(cliente)} {cliente.telefono ? `· ${cliente.telefono}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </form>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {mensajes.map((mensaje) => (
                  <div key={mensaje.wamid} className={`flex ${mensaje.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded px-3 py-2 text-sm ${
                        mensaje.direccion === 'saliente' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      <p>{resumenMensaje(mensaje)}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {formatoHora(mensaje.wa_timestamp)}
                        {mensaje.direccion === 'saliente' && mensaje.origen === 'app_celular' && ' · desde el celular'}
                        {mensaje.estado_entrega ? ` · ${mensaje.estado_entrega}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
                {mensajes.length === 0 && <p className="text-center text-sm text-slate-400">Sin mensajes todavía.</p>}
              </div>

              <form onSubmit={enviarMensaje} className="flex gap-2 border-t border-slate-200 p-3">
                <input
                  type="text"
                  value={texto}
                  onChange={(evento) => setTexto(evento.target.value)}
                  placeholder="Escribe una respuesta…"
                  className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={enviando || !texto.trim()}
                  className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  Enviar
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Mensajes
