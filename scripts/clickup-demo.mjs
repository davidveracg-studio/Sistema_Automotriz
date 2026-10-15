// Herramienta de un solo uso para conectar la LISTA DE LA DEMO con ClickUp,
// separada de cualquier lista real de un taller cliente.
//
//   verificar : compara los estados (columnas) de la lista real y la de la demo,
//               y muestra los webhooks que ya existen en el espacio de trabajo.
//   webhook   : crea el webhook de la lista demo (ClickUp -> CRM) y guarda su
//               secreto directamente en los secretos de Supabase
//               (CLICKUP_WEBHOOK_SECRET_DEMO), sin mostrarlo en pantalla.
//
// Requiere CLICKUP_API_TOKEN en el entorno: un secreto real que nunca se guarda
// en este repo ni se imprime.
//
// Uso (CMD):
//   set CLICKUP_API_TOKEN=pk_...
//   set CLICKUP_TEAM_ID=...
//   set CLICKUP_LISTA_DEMO_ID=...
//   set CLICKUP_LISTA_REFERENCIA_ID=...   (solo para "verificar")
//   node scripts/clickup-demo.mjs verificar
//   node scripts/clickup-demo.mjs webhook
//
// "webhook" además usa el CLI de Supabase ya autenticado en esta máquina.

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// IDs del workspace y las listas: se pasan por entorno (no van en este repo
// público). LISTA_REFERENCIA es opcional: otra lista con la que comparar los
// estados (columnas) de la de la demo.
const EQUIPO = process.env.CLICKUP_TEAM_ID
const LISTA_REAL = process.env.CLICKUP_LISTA_REFERENCIA_ID
const LISTA_DEMO = process.env.CLICKUP_LISTA_DEMO_ID
const PROYECTO_SUPABASE = 'bshgazaczzfcdfuguvsh'
const ENDPOINT = `https://${PROYECTO_SUPABASE}.supabase.co/functions/v1/clickup-webhook`
const EVENTOS_POR_DEFECTO = ['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskAssigneeUpdated']

const token = process.env.CLICKUP_API_TOKEN
const modo = process.argv[2]

if (!token) {
  console.error('Falta CLICKUP_API_TOKEN en el entorno.')
  process.exit(1)
}
if (!EQUIPO || !LISTA_DEMO || (modo === 'verificar' && !LISTA_REAL)) {
  console.error('Faltan CLICKUP_TEAM_ID, CLICKUP_LISTA_DEMO_ID (y CLICKUP_LISTA_REFERENCIA_ID para "verificar") en el entorno.')
  process.exit(1)
}
if (!['verificar', 'webhook'].includes(modo)) {
  console.error('Uso: node scripts/clickup-demo.mjs verificar | webhook')
  process.exit(1)
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`https://api.clickup.com/api/v2${ruta}`, {
    ...opciones,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  })
  const texto = await respuesta.text()
  const cuerpo = texto ? JSON.parse(texto) : null
  if (!respuesta.ok) {
    throw new Error(`ClickUp respondió ${respuesta.status} en ${ruta}: ${cuerpo?.err || texto}`)
  }
  return cuerpo
}

async function leerLista(id) {
  const lista = await api(`/list/${id}`)
  return { id, nombre: lista.name, estados: (lista.statuses || []).map((estado) => estado.status) }
}

async function listarWebhooks() {
  const { webhooks } = await api(`/team/${EQUIPO}/webhook`)
  return webhooks || []
}

// IDs de los campos personalizados de la lista de referencia: los mismos que
// hay fijos en supabase/functions/_shared/clickup.ts (en este repo público son
// placeholders; reemplázalos ahí y acá por los de tu lista si vas a comparar).
const EMPRESA_DEMO = 'b0000000-0000-4000-8000-000000000001'
const CAMPOS_REAL = {
  datosCliente: 'demo-campo-datos-cliente',
  kilometraje: 'demo-campo-kilometraje',
  numeroOt: 'demo-campo-numero-ot',
  observaciones: 'demo-campo-observaciones',
  patente: 'demo-campo-patente',
  tipoServicio: 'demo-campo-tipo-servicio',
}
const OPCIONES_REAL = {
  taller_mecanico: 'demo-opcion-mecanica',
  servicio_rapido: 'demo-opcion-servicio-rapido',
  dyp: 'demo-opcion-dyp',
}

const normalizar = (texto) =>
  String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

const etiquetaOpcion = (opcion) => opcion.name ?? opcion.label ?? ''

// Compara los campos personalizados de las dos listas POR NOMBRE. Si los IDs
// de la lista demo son otros, imprime el SQL que los guarda en clickup_config.
async function verificarCampos() {
  const [{ fields: camposReal }, { fields: camposDemo }] = await Promise.all([
    api(`/list/${LISTA_REAL}/field`),
    api(`/list/${LISTA_DEMO}/field`),
  ])

  console.log('')
  console.log(`Campos personalizados: real ${camposReal.length}, demo ${camposDemo.length}`)
  console.log(`  demo: ${camposDemo.map((c) => `${c.name} (${c.type})`).join(' | ')}`)

  const propios = {}
  const problemas = []
  for (const [clave, idReal] of Object.entries(CAMPOS_REAL)) {
    const enReal = camposReal.find((c) => c.id === idReal)
    if (!enReal) {
      problemas.push(`El campo "${clave}" (${idReal}) ya no existe en la lista real: revisa supabase/functions/_shared/clickup.ts.`)
      continue
    }
    const enDemo = camposDemo.find((c) => normalizar(c.name) === normalizar(enReal.name))
    if (!enDemo) {
      problemas.push(`Falta en la lista demo el campo "${enReal.name}" (tipo ${enReal.type}). Créalo con el mismo nombre y tipo.`)
      continue
    }
    if (enDemo.type !== enReal.type) {
      problemas.push(`El campo "${enReal.name}" es de tipo ${enDemo.type} en la demo y ${enReal.type} en la real.`)
    }
    propios[clave] = enDemo.id
    console.log(`  ${clave}: "${enReal.name}" -> ${enDemo.id === idReal ? 'mismo ID que la real' : `ID propio ${enDemo.id}`}`)

    if (clave === 'tipoServicio') {
      const opcionesReal = enReal.type_config?.options || []
      const opcionesDemo = enDemo.type_config?.options || []
      const opciones = {}
      for (const [categoria, idOpcionReal] of Object.entries(OPCIONES_REAL)) {
        const etiqueta = etiquetaOpcion(opcionesReal.find((o) => o.id === idOpcionReal) || {})
        const equivalente = opcionesDemo.find((o) => normalizar(etiquetaOpcion(o)) === normalizar(etiqueta))
        if (!equivalente) problemas.push(`Falta en "Tipo de servicio" de la demo la opción "${etiqueta}".`)
        else opciones[categoria] = equivalente.id
      }
      propios.opcionesTipoServicio = opciones
    }
  }

  if (problemas.length > 0) {
    console.log('')
    console.log('PROBLEMAS con los campos personalizados de la lista demo:')
    for (const problema of problemas) console.log(`  - ${problema}`)
    return
  }

  const iguales =
    Object.entries(CAMPOS_REAL).every(([clave, id]) => propios[clave] === id) &&
    Object.entries(OPCIONES_REAL).every(([categoria, id]) => propios.opcionesTipoServicio?.[categoria] === id)
  console.log('')
  if (iguales) {
    console.log('OK: los campos de la lista demo tienen los mismos IDs que los de la real; no hace falta configurar nada.')
  } else {
    console.log('Los IDs de la lista demo son distintos. Ejecuta este SQL en el editor de Supabase:')
    console.log('')
    console.log(`update public.clickup_config set campos = '${JSON.stringify(propios)}'::jsonb where empresa_id = '${EMPRESA_DEMO}';`)
  }
}

async function verificar() {
  const [real, demo] = await Promise.all([leerLista(LISTA_REAL), leerLista(LISTA_DEMO)])

  console.log(`Lista real (${real.id}): "${real.nombre}" - ${real.estados.length} estados`)
  console.log(`  ${real.estados.join(' | ')}`)
  console.log(`Lista demo (${demo.id}): "${demo.nombre}" - ${demo.estados.length} estados`)
  console.log(`  ${demo.estados.join(' | ')}`)

  const enDemo = new Set(demo.estados.map((estado) => estado.toLowerCase()))
  const enReal = new Set(real.estados.map((estado) => estado.toLowerCase()))
  const faltan = real.estados.filter((estado) => !enDemo.has(estado.toLowerCase()))
  const sobran = demo.estados.filter((estado) => !enReal.has(estado.toLowerCase()))

  console.log('')
  if (faltan.length === 0) {
    console.log('OK: la lista demo tiene todos los estados de la lista real.')
  } else {
    console.log(`FALTAN en la lista demo (${faltan.length}): ${faltan.join(', ')}`)
    console.log('Créalos con el mismo nombre en ClickUp; el CRM crea tarjetas en "agenda" o "POR DESIGNAR" y reacciona a varios de los demás.')
  }
  if (sobran.length > 0) console.log(`Estados extra en la demo (no es un problema): ${sobran.join(', ')}`)

  await verificarCampos()

  console.log('')
  const webhooks = await listarWebhooks()
  console.log(`Webhooks del espacio de trabajo (${webhooks.length}):`)
  for (const w of webhooks) {
    const alcance = w.list_id ? `lista ${w.list_id}` : w.folder_id ? `carpeta ${w.folder_id}` : w.space_id ? `espacio ${w.space_id}` : 'todo el equipo'
    console.log(`  ${w.id} -> ${w.endpoint} | ${alcance} | eventos: ${(w.events || []).join(', ')} | estado: ${w.health?.status ?? '?'}`)
  }
  const propios = webhooks.filter((w) => w.endpoint === ENDPOINT)
  const tieneDemo = propios.some((w) => String(w.list_id) === LISTA_DEMO)
  console.log('')
  console.log(tieneDemo ? 'OK: ya hay un webhook para la lista demo.' : 'Falta el webhook de la lista demo: ejecuta "webhook".')
}

async function crearWebhook() {
  const existentes = await listarWebhooks()
  const propios = existentes.filter((w) => w.endpoint === ENDPOINT)
  if (propios.some((w) => String(w.list_id) === LISTA_DEMO)) {
    console.log('Ya existe un webhook para la lista demo; no se crea otro (su secreto no se puede volver a leer).')
    console.log('Si perdiste el secreto, borra ese webhook en ClickUp y vuelve a ejecutar este comando.')
    return
  }

  // Mismos eventos que el webhook real de esta función, si ya existe uno.
  const referencia = propios.find((w) => !w.list_id || String(w.list_id) === LISTA_REAL) || propios[0]
  const eventos = referencia?.events?.length ? referencia.events : EVENTOS_POR_DEFECTO

  const creado = await api(`/team/${EQUIPO}/webhook`, {
    method: 'POST',
    body: JSON.stringify({ endpoint: ENDPOINT, events: eventos, list_id: LISTA_DEMO }),
  })
  const secreto = creado?.webhook?.secret
  if (!secreto) throw new Error('ClickUp creó el webhook pero no devolvió el secreto.')
  console.log(`Webhook creado (${creado.id}) para la lista demo, eventos: ${eventos.join(', ')}`)

  // El secreto va directo a Supabase, por un archivo temporal que se borra al terminar.
  const carpeta = mkdtempSync(join(tmpdir(), 'clickup-'))
  const archivo = join(carpeta, 'secreto.env')
  try {
    writeFileSync(archivo, `CLICKUP_WEBHOOK_SECRET_DEMO=${secreto}\n`)
    // Un solo comando (sin argumentos sueltos con shell): la ruta es de un
    // archivo temporal propio y el ID de proyecto es una constante, sin datos externos.
    execSync(`npx supabase secrets set --env-file "${archivo}" --project-ref ${PROYECTO_SUPABASE}`, { stdio: 'inherit' })
    console.log('Secreto guardado en Supabase como CLICKUP_WEBHOOK_SECRET_DEMO.')
  } catch (error) {
    console.error('No se pudo guardar el secreto en Supabase:', error.message)
    console.error('El webhook ya existe en ClickUp: bórralo allá y vuelve a ejecutar "webhook" para intentarlo de nuevo.')
    process.exitCode = 1
  } finally {
    rmSync(carpeta, { recursive: true, force: true })
  }
}

try {
  if (modo === 'verificar') await verificar()
  else await crearWebhook()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
