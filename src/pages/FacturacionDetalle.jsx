import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { invocarFuncion } from '../lib/invocarFuncion'
import BloqueTotales from '../components/BloqueTotales'
import {
  CODIGOS_REFERENCIA,
  COLOR_ESTADO_DTE,
  ETIQUETA_ESTADO_DTE,
  INDICADORES_TRASLADO,
  ROLES_PUEDEN_EMITIR,
  TIPOS_DTE,
  TIPOS_REFERENCIABLES,
  calcularMontos,
  formatoFechaIso,
  formatoNumero,
  nombreReceptorDeCliente,
} from '../lib/facturacion'

import { formatearPatente } from '../lib/patente'
import { aplicarDescuentoALineas, textoPorcentaje } from '../lib/descuento'
const RECEPTOR_VACIO = { rut: '', razon_social: '', giro: '', direccion: '', comuna: '', ciudad: '', correo: '' }
const TIPOS_QUE_REFERENCIAN = [56, 61]
const TIPOS_DE_VENTA_A_OT = [33, 34, 39, 41]

function hoyChile() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

function lineaVacia() {
  return { nombre: '', cantidad: 1, precio_unitario: 0, exento: false }
}

function FacturacionDetalle() {
  const { id } = useParams()
  const [parametros] = useSearchParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const esNuevo = id === 'nuevo'

  const [documento, setDocumento] = useState(null)
  const [documentoId, setDocumentoId] = useState(esNuevo ? null : id)
  const [tipo, setTipo] = useState(33)
  const [fecha, setFecha] = useState(hoyChile())
  const [receptor, setReceptor] = useState(RECEPTOR_VACIO)
  const [clienteId, setClienteId] = useState(null)
  const [trabajoId, setTrabajoId] = useState(null)
  const [lineas, setLineas] = useState([lineaVacia()])
  const [referenciaId, setReferenciaId] = useState('')
  const [referenciaCodigo, setReferenciaCodigo] = useState(1)
  const [referenciaRazon, setReferenciaRazon] = useState('')
  const [guiaTraslado, setGuiaTraslado] = useState(1)

  const [config, setConfig] = useState(null)
  const [referenciables, setReferenciables] = useState([])
  const [avisos, setAvisos] = useState([])
  const [terminoCliente, setTerminoCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState([])
  const [buscandoCliente, setBuscandoCliente] = useState(false)

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  const [mensaje, setMensaje] = useState(null)

  const estado = documento?.estado || 'borrador'
  const puedeEmitir = ROLES_PUEDEN_EMITIR.includes(usuario?.rol)
  const editable = puedeEmitir && estado === 'borrador'

  const aplicarDocumento = useCallback((doc, lineasDoc) => {
    setDocumento(doc)
    setTipo(doc.tipo_dte)
    setFecha(doc.fecha_emision)
    setReceptor({
      rut: doc.receptor_rut || '',
      razon_social: doc.receptor_razon_social || '',
      giro: doc.receptor_giro || '',
      direccion: doc.receptor_direccion || '',
      comuna: doc.receptor_comuna || '',
      ciudad: doc.receptor_ciudad || '',
      correo: doc.receptor_correo || '',
    })
    setClienteId(doc.cliente_id)
    setTrabajoId(doc.trabajo_id)
    setReferenciaId(doc.referencia_documento_id || '')
    setReferenciaCodigo(doc.referencia_codigo || 1)
    setReferenciaRazon(doc.referencia_razon || '')
    setGuiaTraslado(doc.guia_indicador_traslado || 1)
    setLineas(
      lineasDoc.length > 0
        ? lineasDoc.map((l) => ({ nombre: l.nombre, cantidad: Number(l.cantidad), precio_unitario: l.precio_unitario, exento: l.exento }))
        : [lineaVacia()]
    )
  }, [])

  const cargarDocumento = useCallback(
    async (docId) => {
      const [{ data: doc, error: errorDoc }, { data: lineasDoc, error: errorLineas }] = await Promise.all([
        supabase.from('documentos_tributarios').select('*').eq('id', docId).maybeSingle(),
        supabase.from('documento_tributario_lineas').select('*').eq('documento_id', docId).order('numero_linea'),
      ])
      if (errorDoc) throw errorDoc
      if (errorLineas) throw errorLineas
      if (!doc) throw new Error('Documento no encontrado.')
      aplicarDocumento(doc, lineasDoc || [])
    },
    [aplicarDocumento]
  )

  // Prefill de un documento nuevo desde una OT (?trabajo=) o como nota de
  // crédito/débito de otro documento (?ref=&tipo=&codigo=).
  const prepararNuevo = useCallback(async () => {
    const trabajoParam = parametros.get('trabajo')
    const refParam = parametros.get('ref')

    if (refParam) {
      const [{ data: original, error: errorOriginal }, { data: lineasOriginal }] = await Promise.all([
        supabase.from('documentos_tributarios').select('*').eq('id', refParam).maybeSingle(),
        supabase.from('documento_tributario_lineas').select('*').eq('documento_id', refParam).order('numero_linea'),
      ])
      if (errorOriginal) throw errorOriginal
      if (!original) throw new Error('No se encontró el documento a referenciar.')

      const tipoNuevo = Number(parametros.get('tipo')) === 56 ? 56 : 61
      const codigo = Number(parametros.get('codigo')) || 1
      setTipo(tipoNuevo)
      setReferenciaId(original.id)
      setReferenciaCodigo(codigo)
      setReferenciaRazon(codigo === 1 ? `Anula ${TIPOS_DTE[original.tipo_dte]} N° ${original.folio}` : '')
      setReceptor({
        rut: original.receptor_rut || '',
        razon_social: original.receptor_razon_social || '',
        giro: original.receptor_giro || '',
        direccion: original.receptor_direccion || '',
        comuna: original.receptor_comuna || '',
        ciudad: original.receptor_ciudad || '',
        correo: original.receptor_correo || '',
      })
      setClienteId(original.cliente_id)
      setTrabajoId(original.trabajo_id)
      // Una NC que anula copia las líneas: debe tener exactamente el mismo monto.
      if (codigo === 1) {
        setLineas((lineasOriginal || []).map((l) => ({ nombre: l.nombre, cantidad: Number(l.cantidad), precio_unitario: l.precio_unitario, exento: l.exento })))
      }
      return
    }

    if (trabajoParam) {
      const [{ data: trabajo, error: errorTrabajo }, { data: items, error: errorItems }, { data: previos }] = await Promise.all([
        supabase
          .from('trabajos_taller')
          .select('id, numero_ot, descuento_mano_obra_pct, tipo_documento, clientes(id, tipo, nombre, apellido, razon_social, rut, email, direccion), vehiculos(patente)')
          .eq('id', trabajoParam)
          .maybeSingle(),
        supabase
          .from('ot_detalle_con_permiso')
          .select('area, detalle, cantidad, precio_unitario, provisto_por_cliente')
          .eq('trabajo_id', trabajoParam)
          .eq('decision', 'aceptado')
          .order('creado_en'),
        supabase
          .from('documentos_tributarios')
          .select('id, tipo_dte, estado, folio')
          .eq('trabajo_id', trabajoParam)
          .in('estado', ['borrador', 'emitiendo', 'aceptado'])
          .in('tipo_dte', TIPOS_DE_VENTA_A_OT),
      ])
      if (errorTrabajo) throw errorTrabajo
      if (errorItems) throw errorItems
      if (!trabajo) throw new Error('No se encontró la OT.')

      const cliente = trabajo.clientes
      setTrabajoId(trabajo.id)
      setTipo(trabajo.tipo_documento === 'factura' ? 33 : 39)
      if (cliente) {
        setClienteId(cliente.id)
        setReceptor({
          ...RECEPTOR_VACIO,
          rut: cliente.rut || '',
          razon_social: nombreReceptorDeCliente(cliente),
          direccion: cliente.direccion || '',
          correo: cliente.email || '',
        })
      }

      const cobrables = (items || []).filter((i) => !i.provisto_por_cliente)
      const sinPrecio = cobrables.filter((i) => i.precio_unitario == null).length
      // El descuento de mano de obra de la OT se reparte en las líneas de mano de obra
      // (el documento no admite líneas negativas): el total queda igual al de la orden de egreso.
      const lineasOt = cobrables.map((i) => ({
        area: i.area,
        nombre: i.detalle,
        cantidad: Number(i.cantidad),
        precio_unitario: i.precio_unitario ?? 0,
        exento: false,
      }))
      const conDescuento = aplicarDescuentoALineas(lineasOt, trabajo.descuento_mano_obra_pct)
      setLineas(
        cobrables.length > 0
          ? conDescuento.map((linea) => ({ nombre: linea.nombre, cantidad: linea.cantidad, precio_unitario: linea.precio_unitario, exento: linea.exento }))
          : [lineaVacia()]
      )

      const nuevosAvisos = [`Líneas tomadas de los ítems aceptados de la OT ${trabajo.numero_ot} (${formatearPatente(trabajo.vehiculos?.patente) || 'sin patente'}); los precios ya incluyen IVA.`]
      if (Number(trabajo.descuento_mano_obra_pct) > 0) {
        nuevosAvisos.push(`Se aplicó el descuento de ${textoPorcentaje(trabajo.descuento_mano_obra_pct)}% de la OT sobre la mano de obra (precios ya rebajados).`)
      }
      if (sinPrecio > 0) nuevosAvisos.push(`${sinPrecio} ítem(s) no traen precio (tu rol no ve montos, o siguen sin valorizar): quedaron en $0, revísalos.`)
      if ((previos || []).length > 0) {
        nuevosAvisos.push('Esta OT ya tiene un documento tributario en curso o emitido. Revisa la lista antes de emitir otro para no facturar dos veces.')
      }
      setAvisos(nuevosAvisos)
    }
  }, [parametros])

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError(null)
      setMensaje(null)
      try {
        const { data: configuracion } = await supabase.from('facturacion_config').select('proveedor, ambiente, activo').maybeSingle()
        setConfig(configuracion)

        if (esNuevo) {
          setDocumento(null)
          setDocumentoId(null)
          await prepararNuevo()
        } else {
          setDocumentoId(id)
          await cargarDocumento(id)
        }
      } catch (excepcion) {
        setError(excepcion.message || 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [id, esNuevo, cargarDocumento, prepararNuevo])

  // Documentos que una NC/ND puede referenciar: solo aceptados con folio.
  useEffect(() => {
    if (!TIPOS_QUE_REFERENCIAN.includes(tipo)) return
    async function cargarReferenciables() {
      try {
        const { data } = await supabase
          .from('documentos_tributarios')
          .select('id, tipo_dte, folio, fecha_emision, receptor_razon_social, monto_total, simulado')
          .eq('estado', 'aceptado')
          .in('tipo_dte', TIPOS_REFERENCIABLES)
          .order('creado_en', { ascending: false })
          .limit(100)
        setReferenciables(data || [])
      } catch {
        // Sin la lista no se puede elegir referencia; el guardado lo avisa igual.
      }
    }
    cargarReferenciables()
  }, [tipo])

  async function buscarCliente(evento) {
    evento.preventDefault()
    const termino = terminoCliente.trim()
    if (!termino) return
    setBuscandoCliente(true)
    try {
      const soloDigitos = termino.replace(/\D/g, '')
      let consulta = supabase
        .from('clientes')
        .select('id, tipo, nombre, apellido, razon_social, rut, email, direccion')
        .is('eliminado_en', null)
        .limit(8)
      const condiciones = [`nombre.ilike.%${termino}%`, `apellido.ilike.%${termino}%`, `razon_social.ilike.%${termino}%`]
      if (soloDigitos) condiciones.push(`rut_norm.ilike.%${soloDigitos}%`)
      const { data, error: errorBusqueda } = await consulta.or(condiciones.join(','))
      if (errorBusqueda) throw errorBusqueda
      setResultadosCliente(data || [])
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo buscar el cliente.')
    } finally {
      setBuscandoCliente(false)
    }
  }

  function elegirCliente(cliente) {
    setClienteId(cliente.id)
    setReceptor((anterior) => ({
      ...anterior,
      rut: cliente.rut || '',
      razon_social: nombreReceptorDeCliente(cliente),
      direccion: cliente.direccion || anterior.direccion,
      correo: cliente.email || anterior.correo,
    }))
    setResultadosCliente([])
    setTerminoCliente('')
  }

  function cambiarLinea(indice, campo, valor) {
    setLineas((anterior) => anterior.map((l, i) => (i === indice ? { ...l, [campo]: valor } : l)))
  }

  async function copiarLineasDeReferencia() {
    if (!referenciaId) return
    try {
      const { data, error: errorLineas } = await supabase
        .from('documento_tributario_lineas')
        .select('nombre, cantidad, precio_unitario, exento')
        .eq('documento_id', referenciaId)
        .order('numero_linea')
      if (errorLineas) throw errorLineas
      setLineas((data || []).map((l) => ({ ...l, cantidad: Number(l.cantidad) })))
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudieron copiar las líneas.')
    }
  }

  // Guarda el borrador y devuelve su id. Reemplaza las líneas completas:
  // no es transaccional entre cabecera y líneas, por eso el estado de la
  // pantalla no se toca hasta que todo guardó -si falla a la mitad, los datos
  // siguen en pantalla y se puede reintentar-.
  async function guardarBorrador() {
    const lineasValidas = lineas.filter((l) => l.nombre.trim() !== '')
    if (lineasValidas.length === 0) throw new Error('Agrega al menos una línea con nombre.')
    if (TIPOS_QUE_REFERENCIAN.includes(tipo) && !referenciaId) throw new Error('Elige el documento que esta nota corrige.')

    const valor = (texto) => (texto && texto.trim() !== '' ? texto.trim() : null)
    const cabecera = {
      tipo_dte: tipo,
      fecha_emision: fecha,
      receptor_rut: valor(receptor.rut),
      receptor_razon_social: valor(receptor.razon_social),
      receptor_giro: valor(receptor.giro),
      receptor_direccion: valor(receptor.direccion),
      receptor_comuna: valor(receptor.comuna),
      receptor_ciudad: valor(receptor.ciudad),
      receptor_correo: valor(receptor.correo),
      cliente_id: clienteId,
      trabajo_id: trabajoId,
      referencia_documento_id: TIPOS_QUE_REFERENCIAN.includes(tipo) ? referenciaId : null,
      referencia_codigo: TIPOS_QUE_REFERENCIAN.includes(tipo) ? Number(referenciaCodigo) : null,
      referencia_razon: TIPOS_QUE_REFERENCIAN.includes(tipo) ? valor(referenciaRazon) : null,
      guia_indicador_traslado: tipo === 52 ? Number(guiaTraslado) : null,
    }

    let docId = documentoId
    if (!docId) {
      const { data, error: errorInsercion } = await supabase
        .from('documentos_tributarios')
        .insert({ empresa_id: usuario.empresa_id, creado_por: usuario.id, ...cabecera })
        .select('id')
        .single()
      if (errorInsercion) throw errorInsercion
      docId = data.id
      setDocumentoId(docId)
    } else {
      const { error: errorActualizar } = await supabase.from('documentos_tributarios').update(cabecera).eq('id', docId)
      if (errorActualizar) throw errorActualizar
    }

    const { error: errorBorrar } = await supabase.from('documento_tributario_lineas').delete().eq('documento_id', docId)
    if (errorBorrar) throw errorBorrar
    const { error: errorLineas } = await supabase.from('documento_tributario_lineas').insert(
      lineasValidas.map((l, indice) => ({
        documento_id: docId,
        numero_linea: indice + 1,
        nombre: l.nombre.trim(),
        cantidad: Number(l.cantidad) || 1,
        precio_unitario: Math.round(Number(l.precio_unitario) || 0),
        exento: !!l.exento,
      }))
    )
    if (errorLineas) throw errorLineas

    return docId
  }

  async function manejarGuardar() {
    setGuardando(true)
    setError(null)
    setMensaje(null)
    try {
      const docId = await guardarBorrador()
      await cargarDocumento(docId)
      setMensaje('Borrador guardado.')
      if (esNuevo) navigate(`/facturacion/${docId}`, { replace: true })
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo guardar el borrador.')
    } finally {
      setGuardando(false)
    }
  }

  async function manejarEmitir() {
    const montos = calcularMontos(tipo, lineas.filter((l) => l.nombre.trim() !== ''))
    const simulado = config?.proveedor === 'sandbox'
    const confirmado = window.confirm(
      `${simulado ? '[SIMULACIÓN, sin validez tributaria]\n' : ''}Vas a emitir: ${TIPOS_DTE[tipo]} por $${formatoNumero(montos.total)}.\n\n` +
        'Un documento emitido no se puede editar ni borrar: si hay un error se corrige con una nota de crédito. ¿Continuar?'
    )
    if (!confirmado) return

    setGuardando(true)
    setError(null)
    setMensaje(null)
    try {
      // Un documento en estado "error" ya no es editable: se reintenta tal cual.
      const docId = estado === 'borrador' ? await guardarBorrador() : documentoId
      const resultado = await invocarFuncion('facturacion-emitir', { body: { documento_id: docId } })
      if (resultado.advertencias?.length > 0) setMensaje(resultado.advertencias.join(' '))
      await cargarDocumento(docId)
      if (esNuevo) navigate(`/facturacion/${docId}`, { replace: true })
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo emitir el documento.')
      // El borrador puede haberse guardado igual: se refleja el estado real.
      if (documentoId) {
        try {
          await cargarDocumento(documentoId)
        } catch {
          // Se mantiene el error original.
        }
      }
    } finally {
      setGuardando(false)
    }
  }

  async function eliminarBorrador() {
    if (!documentoId || !window.confirm('¿Eliminar este borrador?')) return
    setGuardando(true)
    setError(null)
    try {
      const { error: errorBorrado } = await supabase.from('documentos_tributarios').delete().eq('id', documentoId)
      if (errorBorrado) throw errorBorrado
      navigate('/facturacion', { replace: true })
    } catch (excepcion) {
      setError(excepcion.message || 'No se pudo eliminar el borrador.')
      setGuardando(false)
    }
  }

  if (cargando) return <div className="p-6 text-slate-400">Cargando…</div>

  const montosBd = documento && !editable
  const montos = montosBd
    ? { neto: documento.monto_neto, iva: documento.monto_iva, exento: documento.monto_exento, total: documento.monto_total }
    : calcularMontos(tipo, lineas.filter((l) => l.nombre.trim() !== ''))
  const filasTotales = [
    ...(montos.exento > 0 ? [{ etiqueta: 'EXENTO', valor: formatoNumero(montos.exento) }] : []),
    ...(montos.neto > 0 || montos.iva > 0 ? [{ etiqueta: 'NETO', valor: formatoNumero(montos.neto) }, { etiqueta: 'I.V.A. 19%', valor: formatoNumero(montos.iva) }] : []),
    { etiqueta: 'TOTAL', valor: formatoNumero(montos.total), destacado: true },
  ]

  const entrada = 'w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500'

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {esNuevo && !documentoId ? 'Nuevo documento tributario' : TIPOS_DTE[tipo]}
            {documento?.folio != null && <span className="text-slate-500"> N° {documento.folio}</span>}
          </h1>
          <p className="mt-1 text-sm">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO_DTE[estado] || ''}`}>{ETIQUETA_ESTADO_DTE[estado] || estado}</span>
            {documento?.simulado && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">SIMULADO</span>}
          </p>
        </div>
        <Link to="/facturacion" className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
          Volver a la lista
        </Link>
      </div>

      {(documento?.simulado || (editable && config?.proveedor === 'sandbox')) && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {documento?.simulado ? 'Documento SIMULADO: no tiene validez tributaria y no fue enviado al SII.' : 'Modo de simulación: al emitir se genera un documento sin validez tributaria.'}
        </p>
      )}
      {avisos.map((aviso) => (
        <p key={aviso} className="mb-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {aviso}
        </p>
      ))}
      {documento?.error_detalle && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{documento.error_detalle}</p>
      )}
      {error && <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {mensaje && <p className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{mensaje}</p>}

      <fieldset disabled={!editable || guardando} className="max-w-4xl space-y-6">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Documento</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Tipo</label>
              <select value={tipo} onChange={(e) => setTipo(Number(e.target.value))} className={entrada}>
                {Object.entries(TIPOS_DTE).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta} ({valor})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Fecha de emisión</label>
              <input type="date" value={fecha} max={hoyChile()} onChange={(e) => setFecha(e.target.value)} className={entrada} />
            </div>
            {tipo === 52 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Tipo de traslado</label>
                <select value={guiaTraslado} onChange={(e) => setGuiaTraslado(Number(e.target.value))} className={entrada}>
                  {Object.entries(INDICADORES_TRASLADO).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        {TIPOS_QUE_REFERENCIAN.includes(tipo) && (
          <section className="rounded border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Documento que corrige</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <select value={referenciaId} onChange={(e) => setReferenciaId(e.target.value)} className={entrada}>
                  <option value="">Elige un documento aceptado…</option>
                  {referenciables.map((r) => (
                    <option key={r.id} value={r.id}>
                      {TIPOS_DTE[r.tipo_dte]} N° {r.folio} — {r.receptor_razon_social || 'sin receptor'} — ${formatoNumero(r.monto_total)}
                      {r.simulado ? ' (simulado)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <select value={referenciaCodigo} onChange={(e) => setReferenciaCodigo(Number(e.target.value))} className={entrada}>
                {Object.entries(CODIGOS_REFERENCIA).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              <input value={referenciaRazon} onChange={(e) => setReferenciaRazon(e.target.value)} placeholder="Razón (ej. Anula factura por error de monto)" className={entrada} />
            </div>
            {referenciaId && (
              <button type="button" onClick={copiarLineasDeReferencia} className="mt-2 text-xs text-slate-500 underline hover:text-slate-700">
                Copiar las líneas del documento referenciado
              </button>
            )}
          </section>
        )}

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Receptor</h2>
          {editable && (
            <form onSubmit={buscarCliente} className="mb-3 flex gap-2">
              <input
                value={terminoCliente}
                onChange={(e) => setTerminoCliente(e.target.value)}
                placeholder="Buscar cliente por nombre o RUT para completar los datos"
                className={entrada}
              />
              <button type="submit" disabled={buscandoCliente} className="shrink-0 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                Buscar
              </button>
            </form>
          )}
          {resultadosCliente.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {resultadosCliente.map((cliente) => (
                <li key={cliente.id}>
                  <button type="button" onClick={() => elegirCliente(cliente)} className="text-slate-700 underline hover:text-slate-900">
                    {nombreReceptorDeCliente(cliente)} {cliente.rut ? `· ${cliente.rut}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              ['rut', 'RUT', '12.345.678-5'],
              ['razon_social', 'Razón social / Nombre', ''],
              ['giro', 'Giro', ''],
              ['direccion', 'Dirección', ''],
              ['comuna', 'Comuna', ''],
              ['ciudad', 'Ciudad', ''],
              ['correo', 'Correo (envío del documento)', ''],
            ].map(([campo, etiqueta, ejemplo]) => (
              <div key={campo}>
                <label className="mb-1 block text-xs font-medium text-slate-500">{etiqueta}</label>
                <input value={receptor[campo]} onChange={(e) => setReceptor((anterior) => ({ ...anterior, [campo]: e.target.value }))} placeholder={ejemplo} className={entrada} />
              </div>
            ))}
          </div>
          {(tipo === 39 || tipo === 41) && <p className="mt-2 text-xs text-slate-400">En una boleta el receptor es opcional.</p>}
        </section>

        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Detalle (precios con IVA incluido)</h2>
          <div className="space-y-2">
            {lineas.map((linea, indice) => (
              <div key={indice} className="grid grid-cols-12 items-center gap-2">
                <input value={linea.nombre} onChange={(e) => cambiarLinea(indice, 'nombre', e.target.value)} placeholder="Descripción" className={`${entrada} col-span-12 sm:col-span-5`} />
                <input type="number" min="0.01" step="0.01" value={linea.cantidad} onChange={(e) => cambiarLinea(indice, 'cantidad', e.target.value)} className={`${entrada} col-span-3 sm:col-span-2`} />
                <input type="number" min="0" step="1" value={linea.precio_unitario} onChange={(e) => cambiarLinea(indice, 'precio_unitario', e.target.value)} className={`${entrada} col-span-4 sm:col-span-2`} />
                <label className="col-span-3 flex items-center gap-1 text-xs text-slate-500 sm:col-span-2">
                  <input type="checkbox" checked={linea.exento} onChange={(e) => cambiarLinea(indice, 'exento', e.target.checked)} />
                  Exento
                </label>
                <button
                  type="button"
                  onClick={() => setLineas((anterior) => (anterior.length > 1 ? anterior.filter((_, i) => i !== indice) : anterior))}
                  className="col-span-2 text-xs text-slate-400 hover:text-red-600 sm:col-span-1"
                  aria-label="Quitar línea"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-12 gap-2 text-[11px] text-slate-400">
            <span className="col-span-5">Descripción</span>
            <span className="col-span-2">Cantidad</span>
            <span className="col-span-2">Precio c/IVA</span>
          </div>
          {editable && (
            <button type="button" onClick={() => setLineas((anterior) => [...anterior, lineaVacia()])} className="mt-3 text-sm text-slate-600 underline hover:text-slate-800">
              + Agregar línea
            </button>
          )}
        </section>
      </fieldset>

      <div className="mt-4 max-w-4xl">
        <BloqueTotales filas={filasTotales} />
      </div>

      <div className="mt-6 flex max-w-4xl flex-wrap items-center gap-2">
        {editable && (
          <>
            <button type="button" onClick={manejarGuardar} disabled={guardando} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar borrador'}
            </button>
            <button type="button" onClick={manejarEmitir} disabled={guardando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              Emitir documento
            </button>
            {documentoId && (
              <button type="button" onClick={eliminarBorrador} disabled={guardando} className="rounded px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                Eliminar borrador
              </button>
            )}
          </>
        )}
        {puedeEmitir && estado === 'error' && (
          <button type="button" onClick={manejarEmitir} disabled={guardando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {guardando ? 'Reintentando…' : 'Reintentar emisión'}
          </button>
        )}
        {puedeEmitir && estado === 'aceptado' && [33, 34, 39, 41, 56].includes(tipo) && (
          <Link to={`/facturacion/nuevo?ref=${documento.id}&tipo=61&codigo=1`} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
            Anular con nota de crédito
          </Link>
        )}
        {puedeEmitir && estado === 'aceptado' && [33, 34].includes(tipo) && (
          <Link to={`/facturacion/nuevo?ref=${documento.id}&tipo=56&codigo=3`} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
            Emitir nota de débito
          </Link>
        )}
        {documento?.url_pdf && (
          <a href={documento.url_pdf} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
            Ver PDF
          </a>
        )}
        {documento?.emitido_en && <span className="text-xs text-slate-400">Emitido el {formatoFechaIso(documento.emitido_en)}</span>}
      </div>
    </div>
  )
}

export default FacturacionDetalle
