import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { rutValido } from '../lib/rut'
import {
  AVISO_RECLAMO,
  CANALES,
  ESTADOS,
  ESTADOS_ABIERTOS,
  TIPOS,
  TIPOS_CON_BLOQUEO,
  TIPOS_CON_CAUSAL,
  codigoSolicitud,
  describirPlazo,
  descargarJson,
  diasHasta,
  exportarDatosCliente,
  formatoFecha,
  hoyIso,
} from '../lib/solicitudesTitulares'

const FORMULARIO_VACIO = {
  tipo: 'acceso',
  canal: 'correo',
  nombre: '',
  rut: '',
  contacto: '',
  clienteId: '',
  detalle: '',
  causal: '',
  recibida: '',
  bloqueo: false,
}

function nombreCliente(cliente) {
  if (!cliente) return ''
  return cliente.razon_social || [cliente.nombre, cliente.apellido].filter(Boolean).join(' ')
}

function Aviso({ mensaje }) {
  if (!mensaje) return null
  const clase = mensaje.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
  return (
    <div role="status" className={`rounded border px-3 py-2 text-sm ${clase}`}>
      {mensaje.texto}
    </div>
  )
}

function InsigniaEstado({ estado, venceEn }) {
  const abierta = ESTADOS_ABIERTOS.includes(estado)
  if (!abierta) {
    const clase = estado === 'respondida' ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-700'
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${clase}`}>{ESTADOS[estado]}</span>
  }
  const plazo = describirPlazo(venceEn)
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${plazo.clase}`}>{plazo.texto}</span>
}

function FormularioNueva({ clientes, empresaId, onCreada, onCancelar }) {
  const [form, setForm] = useState({ ...FORMULARIO_VACIO, recibida: hoyIso() })
  const [enviando, setEnviando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  const cambiar = (campo) => (evento) => {
    const valor = evento.target.type === 'checkbox' ? evento.target.checked : evento.target.value
    setForm((actual) => ({ ...actual, [campo]: valor }))
  }

  async function enviar(evento) {
    evento.preventDefault()
    setMensaje(null)
    if (form.rut.trim() && !rutValido(form.rut)) {
      setMensaje({ tipo: 'error', texto: 'El RUT no es válido. Revísalo o déjalo en blanco.' })
      return
    }
    setEnviando(true)
    const { error } = await supabase.from('solicitudes_titulares').insert({
      empresa_id: empresaId,
      tipo: form.tipo,
      canal: form.canal,
      solicitante_nombre: form.nombre.trim(),
      solicitante_rut: form.rut.trim() || null,
      solicitante_contacto: form.contacto.trim(),
      cliente_id: form.clienteId || null,
      detalle: form.detalle.trim(),
      causal: TIPOS_CON_CAUSAL.includes(form.tipo) && form.causal.trim() ? form.causal.trim() : null,
      recibida_en: form.recibida,
      bloqueo_solicitado: TIPOS_CON_BLOQUEO.includes(form.tipo) && form.bloqueo,
    })
    setEnviando(false)
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
      return
    }
    await onCreada()
  }

  return (
    <form onSubmit={enviar} className="card mb-6 space-y-4 p-5">
      <h2 className="text-base font-semibold text-slate-900">Registrar solicitud</h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="sd-tipo">
            Derecho solicitado
          </label>
          <select id="sd-tipo" className="input" value={form.tipo} onChange={cambiar('tipo')}>
            {Object.entries(TIPOS).map(([valor, tipo]) => (
              <option key={valor} value={valor}>
                {tipo.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sd-canal">
            Cómo llegó
          </label>
          <select id="sd-canal" className="input" value={form.canal} onChange={cambiar('canal')}>
            {Object.entries(CANALES).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sd-recibida">
            Fecha de ingreso
          </label>
          <input id="sd-recibida" type="date" required max={hoyIso()} className="input" value={form.recibida} onChange={cambiar('recibida')} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="sd-nombre">
            Nombre de quien solicita
          </label>
          <input id="sd-nombre" required maxLength={150} className="input" value={form.nombre} onChange={cambiar('nombre')} />
        </div>
        <div>
          <label className="label" htmlFor="sd-rut">
            RUT (opcional)
          </label>
          <input id="sd-rut" maxLength={12} className="input" placeholder="12.345.678-5" value={form.rut} onChange={cambiar('rut')} />
        </div>
        <div>
          <label className="label" htmlFor="sd-contacto">
            Correo o dirección para responder
          </label>
          <input id="sd-contacto" required maxLength={200} className="input" value={form.contacto} onChange={cambiar('contacto')} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="sd-cliente">
          Ficha de cliente asociada (opcional)
        </label>
        <select id="sd-cliente" className="input" value={form.clienteId} onChange={cambiar('clienteId')}>
          <option value="">Sin vincular</option>
          {clientes.map((cliente) => (
            <option key={cliente.id} value={cliente.id}>
              {nombreCliente(cliente)}
              {cliente.rut ? ` · ${cliente.rut}` : ''}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">Vincularla permite exportar los datos del cliente al responder.</p>
      </div>

      <div>
        <label className="label" htmlFor="sd-detalle">
          Qué pide y sobre qué datos o tratamiento
        </label>
        <textarea id="sd-detalle" required rows={3} maxLength={2000} className="input" value={form.detalle} onChange={cambiar('detalle')} />
      </div>

      {TIPOS_CON_CAUSAL.includes(form.tipo) && (
        <div>
          <label className="label" htmlFor="sd-causal">
            Causal invocada y antecedentes
          </label>
          <textarea id="sd-causal" rows={2} maxLength={1000} className="input" value={form.causal} onChange={cambiar('causal')} />
        </div>
      )}

      {TIPOS_CON_BLOQUEO.includes(form.tipo) && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={form.bloqueo} onChange={cambiar('bloqueo')} />
          <span>
            Pidió además el bloqueo temporal del tratamiento mientras se resuelve. Hay que responder esa petición en 2 días hábiles.
          </span>
        </label>
      )}

      <Aviso mensaje={mensaje} />

      <div className="flex gap-2">
        <button type="submit" disabled={enviando} className="btn-primary">
          {enviando ? 'Guardando…' : 'Guardar solicitud'}
        </button>
        <button type="button" onClick={onCancelar} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function DetalleSolicitud({ solicitud, onCambio, onCerrar }) {
  const [modo, setModo] = useState(null)
  const [respuesta, setRespuesta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState(null)

  const tipo = TIPOS[solicitud.tipo]
  const abierta = ESTADOS_ABIERTOS.includes(solicitud.estado)
  const codigo = codigoSolicitud(solicitud.numero)
  const diasBloqueo = solicitud.bloqueo_solicitado ? diasHasta(solicitud.bloqueo_vence_en) : null

  async function actualizar(cambios, textoOk) {
    setTrabajando(true)
    setMensaje(null)
    const { error } = await supabase.from('solicitudes_titulares').update(cambios).eq('id', solicitud.id)
    setTrabajando(false)
    if (error) {
      setMensaje({ tipo: 'error', texto: error.message })
      return false
    }
    setMensaje({ tipo: 'ok', texto: textoOk })
    await onCambio()
    return true
  }

  async function prorrogar() {
    if (!window.confirm('La prórroga de 30 días se puede usar una sola vez y no se puede deshacer. ¿Continuar?')) return
    await actualizar({ prorrogada: true }, 'Plazo prorrogado 30 días corridos.')
  }

  async function pedirBloqueo() {
    if (!window.confirm('Se registrará el bloqueo temporal con plazo de respuesta de 2 días hábiles. ¿Continuar?')) return
    await actualizar({ bloqueo_solicitado: true }, 'Bloqueo temporal registrado.')
  }

  async function responder() {
    if (!respuesta.trim()) {
      setMensaje({ tipo: 'error', texto: 'Escribe la respuesta que se enviará a la persona.' })
      return
    }
    if (!window.confirm('Al registrar la respuesta la solicitud queda cerrada y ya no se puede modificar. ¿Continuar?')) return
    if (await actualizar({ estado: 'respondida', respuesta: respuesta.trim() }, 'Respuesta registrada.')) setModo(null)
  }

  async function rechazar() {
    if (!motivo.trim()) {
      setMensaje({ tipo: 'error', texto: 'Un rechazo debe llevar su fundamento: indica la causa y los antecedentes.' })
      return
    }
    let texto = respuesta.trim() || `Su solicitud fue rechazada por el siguiente motivo: ${motivo.trim()}`
    if (!/30 días hábiles/i.test(texto)) texto += `\n\n${AVISO_RECLAMO}`
    if (!window.confirm('Al rechazar, la solicitud queda cerrada y ya no se puede modificar. ¿Continuar?')) return
    if (await actualizar({ estado: 'rechazada', motivo_rechazo: motivo.trim(), respuesta: texto }, 'Rechazo registrado.')) setModo(null)
  }

  async function exportar() {
    setTrabajando(true)
    setMensaje(null)
    try {
      const datos = await exportarDatosCliente(solicitud.cliente_id)
      descargarJson(datos, `datos-${codigo}.json`)
      setMensaje({ tipo: 'ok', texto: 'Archivo descargado. Revísalo antes de entregarlo a la persona.' })
    } catch (error) {
      setMensaje({ tipo: 'error', texto: error.message })
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <section className="card mb-6 space-y-4 p-5" aria-label={`Solicitud ${codigo}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {codigo} · {tipo.etiqueta} <span className="text-xs font-normal text-slate-400">({tipo.articulo})</span>
          </h2>
          <p className="text-sm text-slate-500">
            {solicitud.solicitante_nombre}
            {solicitud.solicitante_rut ? ` · ${solicitud.solicitante_rut}` : ''} · {solicitud.solicitante_contacto}
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="btn-ghost">
          Cerrar
        </button>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="label">Ingreso</dt>
          <dd>{formatoFecha(solicitud.recibida_en)}</dd>
        </div>
        <div>
          <dt className="label">Vence</dt>
          <dd>
            {formatoFecha(solicitud.vence_en)}
            {solicitud.prorrogada ? ' (prorrogada)' : ''}
          </dd>
        </div>
        <div>
          <dt className="label">Canal</dt>
          <dd>{CANALES[solicitud.canal]}</dd>
        </div>
        <div>
          <dt className="label">Estado</dt>
          <dd>
            <InsigniaEstado estado={solicitud.estado} venceEn={solicitud.vence_en} />
          </dd>
        </div>
      </dl>

      <div>
        <p className="label">Qué pide</p>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{solicitud.detalle}</p>
        {solicitud.causal && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">Causal: {solicitud.causal}</p>}
      </div>

      {solicitud.bloqueo_solicitado && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Bloqueo temporal solicitado: responder a más tardar el {formatoFecha(solicitud.bloqueo_vence_en)}
          {abierta && diasBloqueo !== null && diasBloqueo < 0 ? ' (plazo vencido)' : ''}. Mientras no se resuelva no se pueden tratar los
          datos afectados; el almacenamiento no cambia.
        </div>
      )}

      <div className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <p className="mb-1 font-medium">Qué verificar ({tipo.articulo})</p>
        <ul className="list-disc space-y-1 pl-5">
          {tipo.verificar.map((punto) => (
            <li key={punto}>{punto}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Resumen de la ley como recordatorio; los casos dudosos se validan con un abogado.</p>
      </div>

      {!abierta && (
        <div className="space-y-2 rounded border border-slate-200 px-3 py-2 text-sm">
          <p className="label">
            {ESTADOS[solicitud.estado]} el {formatoFecha(solicitud.respondida_en)}
          </p>
          <p className="whitespace-pre-wrap text-slate-700">{solicitud.respuesta}</p>
          {solicitud.motivo_rechazo && <p className="whitespace-pre-wrap text-slate-600">Fundamento: {solicitud.motivo_rechazo}</p>}
          <p className="text-xs text-slate-400">Queda como respaldo y no se puede modificar.</p>
        </div>
      )}

      <Aviso mensaje={mensaje} />

      {abierta && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {solicitud.estado === 'recibida' && (
              <button type="button" disabled={trabajando} onClick={() => actualizar({ estado: 'en_proceso' }, 'Marcada en proceso.')} className="btn-ghost">
                Marcar en proceso
              </button>
            )}
            {solicitud.cliente_id && (
              <button type="button" disabled={trabajando} onClick={exportar} className="btn-ghost">
                Exportar datos del cliente
              </button>
            )}
            {!solicitud.prorrogada && (
              <button type="button" disabled={trabajando} onClick={prorrogar} className="btn-ghost">
                Prorrogar 30 días
              </button>
            )}
            {TIPOS_CON_BLOQUEO.includes(solicitud.tipo) && !solicitud.bloqueo_solicitado && (
              <button type="button" disabled={trabajando} onClick={pedirBloqueo} className="btn-ghost">
                Registrar bloqueo temporal
              </button>
            )}
            <button type="button" disabled={trabajando} onClick={() => setModo('responder')} className="btn-primary">
              Responder
            </button>
            <button type="button" disabled={trabajando} onClick={() => setModo('rechazar')} className="btn-ghost text-red-700">
              Rechazar
            </button>
          </div>

          {modo === 'responder' && (
            <div className="space-y-2">
              <label className="label" htmlFor="sd-respuesta">
                Respuesta que se envía a la persona
              </label>
              <textarea id="sd-respuesta" rows={4} className="input" value={respuesta} onChange={(evento) => setRespuesta(evento.target.value)} />
              <p className="text-xs text-slate-500">
                Envíala por escrito al contacto indicado y guarda el respaldo del envío (fecha y contenido íntegro).
              </p>
              <button type="button" disabled={trabajando} onClick={responder} className="btn-primary">
                Registrar respuesta
              </button>
            </div>
          )}

          {modo === 'rechazar' && (
            <div className="space-y-2">
              <label className="label" htmlFor="sd-motivo">
                Fundamento del rechazo (causa y antecedentes)
              </label>
              <textarea id="sd-motivo" rows={3} className="input" value={motivo} onChange={(evento) => setMotivo(evento.target.value)} />
              <label className="label" htmlFor="sd-respuesta-rechazo">
                Texto que se envía (opcional: si lo dejas vacío se usa el fundamento)
              </label>
              <textarea
                id="sd-respuesta-rechazo"
                rows={3}
                className="input"
                value={respuesta}
                onChange={(evento) => setRespuesta(evento.target.value)}
              />
              <p className="text-xs text-slate-500">Se agrega el aviso: «{AVISO_RECLAMO}»</p>
              <button type="button" disabled={trabajando} onClick={rechazar} className="btn-primary">
                Registrar rechazo
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SolicitudesTitulares() {
  const { usuario } = useAuth()
  const [solicitudes, setSolicitudes] = useState([])
  const [clientes, setClientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [filtro, setFiltro] = useState('abiertas')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [seleccionadaId, setSeleccionadaId] = useState(null)

  const cargar = useCallback(async () => {
    try {
      const [respuestaSolicitudes, respuestaClientes] = await Promise.all([
        supabase.from('solicitudes_titulares').select('*').order('vence_en', { ascending: true }),
        supabase.from('clientes').select('id, nombre, apellido, razon_social, rut').is('eliminado_en', null).order('nombre').limit(500),
      ])
      if (respuestaSolicitudes.error) {
        setError(respuestaSolicitudes.error.message)
      } else {
        setError(null)
        setSolicitudes(respuestaSolicitudes.data || [])
      }
      setClientes(respuestaClientes.data || [])
    } catch {
      setError('No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const visibles = useMemo(
    () => (filtro === 'abiertas' ? solicitudes.filter((solicitud) => ESTADOS_ABIERTOS.includes(solicitud.estado)) : solicitudes),
    [solicitudes, filtro]
  )
  const abiertas = solicitudes.filter((solicitud) => ESTADOS_ABIERTOS.includes(solicitud.estado))
  const vencidas = abiertas.filter((solicitud) => diasHasta(solicitud.vence_en) < 0).length
  const seleccionada = solicitudes.find((solicitud) => solicitud.id === seleccionadaId)
  const clientePorId = useMemo(() => new Map(clientes.map((cliente) => [cliente.id, cliente])), [clientes])

  if (!usuario) return null

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-mm-link dark:text-white">Derechos de titulares</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Solicitudes de acceso, rectificación, supresión, oposición, portabilidad y bloqueo. Se responde en 30 días corridos desde el
            ingreso (prorrogables una vez por 30 más). Si se rechaza, hay que fundarlo e informar que la persona tiene 30 días hábiles para
            reclamar ante la Agencia.
          </p>
        </div>
        {!mostrarFormulario && (
          <button type="button" className="btn-primary" onClick={() => setMostrarFormulario(true)}>
            Registrar solicitud
          </button>
        )}
      </div>

      {mostrarFormulario && (
        <FormularioNueva
          clientes={clientes}
          empresaId={usuario.empresa_id}
          onCancelar={() => setMostrarFormulario(false)}
          onCreada={async () => {
            setMostrarFormulario(false)
            await cargar()
          }}
        />
      )}

      {seleccionada && <DetalleSolicitud key={seleccionada.id} solicitud={seleccionada} onCambio={cargar} onCerrar={() => setSeleccionadaId(null)} />}

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {[
          ['abiertas', `Abiertas (${abiertas.length})`],
          ['todas', `Todas (${solicitudes.length})`],
        ].map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setFiltro(valor)}
            aria-pressed={filtro === valor}
            className={`rounded-full px-3 py-1 font-medium ${filtro === valor ? 'bg-brand-accent text-white' : 'bg-white text-slate-600 shadow-mm'}`}
          >
            {etiqueta}
          </button>
        ))}
        {vencidas > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">{vencidas} vencida(s)</span>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3">N°</th>
              <th scope="col" className="px-4 py-3">Derecho</th>
              <th scope="col" className="px-4 py-3">Solicitante</th>
              <th scope="col" className="px-4 py-3">Ingreso</th>
              <th scope="col" className="px-4 py-3">Vence</th>
              <th scope="col" className="px-4 py-3">Estado / plazo</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!cargando && visibles.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {filtro === 'abiertas'
                    ? 'No hay solicitudes abiertas. Registra aquí las que lleguen por correo, formulario o en persona.'
                    : 'Aún no hay solicitudes registradas.'}
                </td>
              </tr>
            )}
            {visibles.map((solicitud) => (
              <tr key={solicitud.id} className={solicitud.id === seleccionadaId ? 'bg-slate-50' : ''}>
                <td className="px-4 py-3 font-medium">{codigoSolicitud(solicitud.numero)}</td>
                <td className="px-4 py-3">{TIPOS[solicitud.tipo].etiqueta}</td>
                <td className="px-4 py-3">
                  {solicitud.solicitante_nombre}
                  {solicitud.cliente_id && clientePorId.get(solicitud.cliente_id) && (
                    <span className="block text-xs text-slate-400">Cliente: {nombreCliente(clientePorId.get(solicitud.cliente_id))}</span>
                  )}
                </td>
                <td className="px-4 py-3">{formatoFecha(solicitud.recibida_en)}</td>
                <td className="px-4 py-3">{formatoFecha(solicitud.vence_en)}</td>
                <td className="px-4 py-3">
                  <InsigniaEstado estado={solicitud.estado} venceEn={solicitud.vence_en} />
                  {solicitud.bloqueo_solicitado && ESTADOS_ABIERTOS.includes(solicitud.estado) && (
                    <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Bloqueo</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => setSeleccionadaId(solicitud.id)} className="font-medium text-brand-accent hover:underline">
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default SolicitudesTitulares
