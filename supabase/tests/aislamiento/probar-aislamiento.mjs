// =============================================================================
// probar-aislamiento.mjs — WP0.2 de FASE0.md
//
// Comprueba que un usuario de una empresa NO puede leer, cambiar, borrar ni
// crear datos de otra empresa, probando las políticas RLS y los privilegios
// REALES de la base (aplicando todas las migraciones sobre un Postgres de
// pruebas). Falla (código de salida 1) ante cualquier fuga.
//
// Qué prueba:
//   1. Por cada tabla de public y por cada rol (8 roles de la empresa A + anon):
//      SELECT / UPDATE / DELETE sobre filas AJENAS (de la empresa B y de la
//      empresa demo) deben afectar 0 filas o fallar; INSERT de una fila ajena
//      debe ser rechazado por RLS.
//   2. Escalada de privilegios en `usuarios` y `empresas`.
//   3. Storage: objetos de otra empresa en cada bucket.
//   4. Funciones SECURITY DEFINER: sin search_path fijo, ejecutables por anon,
//      o con parámetros de empresa. Estas son "higiene" y se comparan con una
//      línea base (solo fallan los hallazgos NUEVOS).
//   5. Columnas con privilegios revocados (costos/precios): un técnico no las lee.
//
// Qué NO prueba (límites): la capa HTTP de PostgREST/Storage, GoTrue ni las Edge
// Functions; solo la base. Las Edge Functions con service role se prueban aparte.
//
// Uso:
//   PRUEBAS_DB_URL=postgresql://... node probar-aislamiento.mjs [--detalle] [--tabla=x] [--actualizar-linea-base]
// La base debe haberse construido antes con construir-base.sh.
// =============================================================================
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const URL_BD = process.env.PRUEBAS_DB_URL
const DETALLE = process.argv.includes('--detalle')
const SOLO = (process.argv.find((a) => a.startsWith('--tabla=')) || '').split('=')[1]
const ACTUALIZAR_BASE = process.argv.includes('--actualizar-linea-base')
const ARCHIVO_BASE = path.join(AQUI, 'linea-base-higiene.json')
const SALIDA = path.join(AQUI, 'salida')

if (!URL_BD) {
  console.error('Falta PRUEBAS_DB_URL (base de PRUEBAS, nunca producción).')
  process.exit(2)
}
if (/supabase\.(co|com)|pooler/i.test(URL_BD)) {
  console.error('PRUEBAS_DB_URL parece una base de Supabase. Esta prueba solo corre sobre una base local o desechable.')
  process.exit(2)
}

const ROLES = ['admin', 'socia', 'asesor', 'jefe_taller', 'encargado_presupuestos', 'tecnico', 'detailer', 'recepcionista']
const EMP_A = 'c1000000-0000-4000-8000-00000000000a'
const EMP_B = 'c2000000-0000-4000-8000-00000000000b'
const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"'
const uidRol = (emp, rol) => {
  const n = String(ROLES.indexOf(rol) + 1).padStart(2, '0')
  return (emp === EMP_A ? 'a1' : 'b2') + `000000-0000-4000-8000-0000000000${n}`
}

const admin = new pg.Client({ connectionString: URL_BD })
const prueba = new pg.Client({ connectionString: URL_BD })
await admin.connect()
await prueba.connect()
const q = (sql, params) => admin.query(sql, params)

// ---------------------------------------------------------------------------
// 1. Introspección del esquema
// ---------------------------------------------------------------------------
const tablas = (await q(`select c.relname t from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' order by 1`)).rows.map((r) => r.t)
const cols = {}
for (const r of (await q(`select table_name t, column_name c, data_type dt, udt_name u, is_nullable nn, column_default d,
    is_generated g, is_identity i from information_schema.columns where table_schema='public' order by table_name, ordinal_position`)).rows) {
  ;(cols[r.t] ||= []).push({ nombre: r.c, tipo: r.dt, udt: r.u, nulo: r.nn === 'YES', def: r.d, gen: r.g === 'ALWAYS', ident: r.i === 'YES' })
}
const fks = {}
for (const r of (await q(`select c.conrelid::regclass::text t, a.attname col, c.confrelid::regclass::text rt, af.attname rcol
  from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  join pg_attribute af on af.attrelid=c.confrelid and af.attnum=c.confkey[1]
  where c.contype='f' and array_length(c.conkey,1)=1 and c.connamespace='public'::regnamespace`)).rows) {
  ;(fks[r.t.replace(/^public\./, '')] ||= []).push({ col: r.col, rt: r.rt.replace(/^public\./, ''), rcol: r.rcol })
}
const checks = {}
for (const r of (await q(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where contype='c' and connamespace='public'::regnamespace`)).rows) {
  ;(checks[r.t.replace(/^public\./, '')] ||= []).push(r.d)
}
const pks = {}
for (const r of (await q(`select c.conrelid::regclass::text t, a.attname col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum = any(c.conkey) where c.contype='p' and c.connamespace='public'::regnamespace`)).rows) {
  ;(pks[r.t.replace(/^public\./, '')] ||= []).push(r.col)
}
const tieneEmpresa = (t) => (cols[t] || []).some((c) => c.nombre === 'empresa_id')

// Expresión SQL (alias t) con el ARREGLO de empresas dueñas de una fila, sin nulos.
//  - tabla con empresa_id o `empresas`: un solo valor.
//  - tabla hija: una ruta por cada clave foránea que lleve a una tabla con empresa
//    (una fila puede tener varios padres; se consideran todos, no solo el primero).
//  - null = tabla global (sin ninguna ruta a una empresa).
// Una fila con arreglo vacío tiene dueño indeterminado y NO se usa en las pruebas.
function exprDueno(t) {
  if (tieneEmpresa(t)) return 'array[t.empresa_id]'
  if (t === 'empresas') return 'array[t.id]'
  const rutas = []
  for (const primera of fks[t] || []) {
    // Búsqueda en anchura desde cada clave foránea hasta una tabla con empresa_id (o empresas).
    const cola = [{ tabla: primera.rt, camino: [{ desde: t, col: primera.col, hacia: primera.rt, rcol: primera.rcol }] }]
    const visto = new Set([t, primera.rt])
    let hallada = null
    while (cola.length && !hallada) {
      const { tabla, camino } = cola.shift()
      if (tieneEmpresa(tabla) || tabla === 'empresas') { hallada = construirCamino(camino, tabla === 'empresas' ? 'id' : 'empresa_id'); break }
      if (camino.length >= 5) continue
      for (const f of fks[tabla] || []) {
        if (visto.has(f.rt)) continue
        visto.add(f.rt)
        cola.push({ tabla: f.rt, camino: [...camino, { desde: tabla, col: f.col, hacia: f.rt, rcol: f.rcol }] })
      }
    }
    if (hallada) rutas.push(hallada)
  }
  return rutas.length ? `array_remove(array[${rutas.join(', ')}], null)` : null
}
function construirCamino(camino, colFinal) {
  let from = ''
  camino.forEach((p, i) => {
    from += i === 0 ? `public.${qi(p.hacia)} r1` : ` join public.${qi(p.hacia)} r${i + 1} on r${i + 1}.${qi(p.rcol)} = r${i}.${qi(camino[i].col)}`
  })
  const k = camino.length
  return `(select r${k}.${qi(colFinal)} from ${from} where r1.${qi(camino[0].rcol)} = t.${qi(camino[0].col)} limit 1)`
}

// ---------------------------------------------------------------------------
// 2. Siembra: dos empresas con un usuario por rol, y filas en cada tabla
// ---------------------------------------------------------------------------
async function sembrarEmpresasYUsuarios() {
  if ((await q(`select 1 from public.empresas where id = $1`, [EMP_A])).rowCount) {
    console.error('Esta base ya fue usada por una corrida anterior. Reconstruirla con construir-base.sh antes de probar de nuevo.')
    process.exit(2)
  }
  for (const [emp, nombre] of [[EMP_A, 'Empresa A (prueba)'], [EMP_B, 'Empresa B (prueba)']]) {
    await q(`insert into public.empresas (id, nombre) values ($1, $2) on conflict (id) do nothing`, [emp, nombre])
    for (const rol of ROLES) {
      const uid = uidRol(emp, rol)
      await q(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
               values ($1, $2, now(), jsonb_build_object('empresa_id', $3::text)) on conflict (id) do nothing`,
        [uid, `${rol}.${emp === EMP_A ? 'a' : 'b'}@prueba.local`, emp])
      await q(`insert into public.usuarios (id, empresa_id, correo, nombre_completo, rol, activo)
               values ($1, $2, $3, $4, $5, true)
               on conflict (id) do update set empresa_id = excluded.empresa_id, rol = excluded.rol, activo = true`,
        [uid, emp, `${rol}.${emp === EMP_A ? 'a' : 'b'}@prueba.local`, `${rol} ${emp === EMP_A ? 'A' : 'B'}`, rol])
    }
  }
}

const memo = new Map() // `${tabla}|${emp}` -> fila
const fallosSiembra = {}
function valorPara(t, c) {
  const defs = checks[t] || []
  // 1) listas cerradas en CHECK:  col = ANY (ARRAY['a'::text, 'b'::text])
  for (const d of defs) {
    const m = d.match(new RegExp(`\\b${c.nombre}\\b[^=]*=\\s*ANY\\s*\\(\\s*\\(?ARRAY\\[([^\\]]+)\\]`))
    if (m) {
      const lit = m[1].match(/'([^']*)'/)
      if (lit) return lit[1]
    }
  }
  if (c.tipo === 'USER-DEFINED') return { enumDe: c.udt }
  const rnd = Math.random().toString(36).slice(2, 10)
  switch (c.udt) {
    case 'uuid': return crypto.randomUUID()
    case 'text': case 'varchar': case 'bpchar': case 'citext': return `prueba-${rnd}`
    case 'int2': case 'int4': case 'int8': return 1
    case 'numeric': case 'float4': case 'float8': return 1
    case 'bool': return false
    case 'date': return new Date().toISOString().slice(0, 10)
    case 'timestamptz': case 'timestamp': return new Date().toISOString()
    case 'time': case 'timetz': return '10:00:00'
    case 'jsonb': case 'json': return '{}'
    case 'inet': return '127.0.0.1'
    case 'bytea': return '\\x00'
    default:
      if (c.tipo === 'ARRAY') return '{}'
      return `prueba-${rnd}`
  }
}
async function sembrarFila(t, emp, profundidad = 0) {
  const clave = `${t}|${emp}`
  if (memo.has(clave)) return memo.get(clave)
  if (profundidad > 6) throw new Error('cadena de dependencias demasiado profunda')
  if (t === 'empresas') return { id: emp }
  const valores = {}
  const fk = Object.fromEntries((fks[t] || []).map((f) => [f.col, f]))
  for (const c of cols[t] || []) {
    if (c.gen || c.ident) continue
    if (c.nombre === 'empresa_id') { valores[c.nombre] = emp; continue }
    const f = fk[c.nombre]
    if (f) {
      if (c.nulo) continue
      if (f.rt === 'empresas') valores[c.nombre] = emp
      else if (f.rt === 'usuarios') valores[c.nombre] = uidRol(emp, 'admin')
      else if (f.rt === 'auth.users') valores[c.nombre] = uidRol(emp, 'admin')
      else valores[c.nombre] = (await sembrarFila(f.rt, emp, profundidad + 1))[f.rcol]
      continue
    }
    if (c.nulo || c.def != null) continue
    let v = valorPara(t, c)
    if (v && v.enumDe) {
      v = (await q(`select enumlabel from pg_enum e join pg_type ty on ty.oid=e.enumtypid where ty.typname=$1 order by enumsortorder limit 1`, [v.enumDe])).rows[0]?.enumlabel
    }
    valores[c.nombre] = v
  }
  const nombres = Object.keys(valores)
  const sql = nombres.length
    ? `insert into public.${qi(t)} (${nombres.map(qi).join(',')}) values (${nombres.map((_, i) => '$' + (i + 1)).join(',')}) returning *`
    : `insert into public.${qi(t)} default values returning *`
  await q('savepoint s')
  try {
    const fila = (await q(sql, nombres.map((n) => valores[n]))).rows[0]
    await q('release savepoint s')
    memo.set(clave, fila)
    return fila
  } catch (e) {
    await q('rollback to savepoint s')
    throw e
  }
}
async function sembrarTodo() {
  await q(`set session_replication_role = replica`) // sin disparadores ni FK: solo se siembran datos
  for (const emp of [EMP_A, EMP_B]) {
    for (const t of tablas) {
      // `plataforma_admins` es la tabla de privilegios de la plataforma: NUNCA se siembra
      // (hacerlo convertiría a los usuarios de prueba en administradores de plataforma).
      if (['usuarios', 'empresas', 'plataforma_admins'].includes(t)) continue
      await q('begin')
      try { await sembrarFila(t, emp); await q('commit') }
      catch (e) { await q('rollback'); fallosSiembra[`${t}|${emp === EMP_A ? 'A' : 'B'}`] = e.message.split('\n')[0] }
    }
  }
  await q(`set session_replication_role = origin`)
}

// ---------------------------------------------------------------------------
// 3. Ejecución de pruebas como un rol dado (cada prueba en su transacción y se revierte)
// ---------------------------------------------------------------------------
async function como(rol, uid, fn) {
  await prueba.query('begin')
  try {
    const rolBd = rol === 'anon' ? 'anon' : rol === 'service_role' ? 'service_role' : 'authenticated'
    await prueba.query(`set local role ${rolBd}`)
    // service_role = las Edge Functions con la clave de servicio (p. ej. el bot de WhatsApp).
    const claims = rol === 'service_role' ? { role: 'service_role' } : uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }
    await prueba.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    return await fn(prueba)
  } finally {
    await prueba.query('rollback')
  }
}
async function intentar(rol, uid, sql, params) {
  try {
    const r = await como(rol, uid, (c) => c.query(sql, params))
    return { ok: true, filas: r.rowCount ?? r.rows.length, rows: r.rows }
  } catch (e) {
    return { ok: false, codigo: e.code, msg: e.message }
  }
}

const resultados = [] // {tabla, rol, op, estado, detalle}
const reg = (tabla, rol, op, estado, detalle = '') => resultados.push({ tabla, rol, op, estado, detalle })
const cobertura = {}

async function probarTabla(t) {
  const dueno = exprDueno(t)
  // Ajena: tiene dueño identificable y NINGUNO es A. Propia: todos sus dueños son A.
  const ajenas = (await q(
    dueno
      ? `select t.ctid::text c from public.${qi(t)} t where cardinality(${dueno}) > 0 and not ($1::uuid = any(${dueno})) limit 25`
      : `select t.ctid::text c from public.${qi(t)} t limit 25`, dueno ? [EMP_A] : [])).rows.map((r) => r.c)
  const propias = dueno
    ? (await q(`select t.ctid::text c from public.${qi(t)} t where cardinality(${dueno}) > 0 and not exists (select 1 from unnest(${dueno}) x where x is distinct from $1::uuid) limit 25`, [EMP_A])).rows.map((r) => r.c)
    : []
  cobertura[t] = { ajenas: ajenas.length, propias: propias.length, empresa: dueno ? (tieneEmpresa(t) ? 'empresa_id' : t === 'empresas' ? 'id' : 'vía FK') : 'global' }
  if (!ajenas.length) return

  // Fila ajena como JSON para la prueba de INSERT.
  const filaAjena = (await q(`select to_jsonb(t) j from public.${qi(t)} t where t.ctid = $1::tid`, [ajenas[0]])).rows[0].j
  const pk = pks[t] || []
  const insertable = { ...filaAjena }
  for (const c of cols[t]) if (c.gen || c.ident) delete insertable[c.nombre] // columnas calculadas: no se pueden insertar
  for (const col of pk) {
    const info = cols[t].find((c) => c.nombre === col)
    if (info.udt === 'uuid') insertable[col] = crypto.randomUUID()
    else if (info.ident || (info.def || '').includes('nextval')) delete insertable[col]
    else if (typeof insertable[col] === 'string') insertable[col] = insertable[col] + '-x' + Math.random().toString(36).slice(2, 6)
  }
  const colEditable = cols[t].find((c) => !c.gen && !c.ident)?.nombre

  const actores = ROLES.map((r) => ({ rol: r, uid: uidRol(EMP_A, r), etiqueta: r })).concat([{ rol: 'anon', uid: null, etiqueta: 'anon' }])
  for (const a of actores) {
    // SELECT
    let r = await intentar(a.rol, a.uid, `select count(*)::int n from public.${qi(t)} where ctid = any($1::tid[])`, [ajenas])
    if (!r.ok) reg(t, a.etiqueta, 'SELECT', 'ok', `denegado (${r.codigo})`)
    else if (r.rows[0].n === 0) reg(t, a.etiqueta, 'SELECT', 'ok')
    else reg(t, a.etiqueta, 'SELECT', 'FUGA', `lee ${r.rows[0].n} filas ajenas`)
    // UPDATE
    if (colEditable) {
      r = await intentar(a.rol, a.uid, `update public.${qi(t)} set ${qi(colEditable)} = ${qi(colEditable)} where ctid = any($1::tid[])`, [ajenas])
      if (!r.ok) reg(t, a.etiqueta, 'UPDATE', 'ok', `denegado (${r.codigo})`)
      else if (r.filas === 0) reg(t, a.etiqueta, 'UPDATE', 'ok')
      else reg(t, a.etiqueta, 'UPDATE', 'FUGA', `modifica ${r.filas} filas ajenas`)
    }
    // DELETE
    r = await intentar(a.rol, a.uid, `delete from public.${qi(t)} where ctid = any($1::tid[])`, [ajenas])
    if (!r.ok) reg(t, a.etiqueta, 'DELETE', 'ok', `denegado (${r.codigo})`)
    else if (r.filas === 0) reg(t, a.etiqueta, 'DELETE', 'ok')
    else reg(t, a.etiqueta, 'DELETE', 'FUGA', `borra ${r.filas} filas ajenas`)
    // INSERT de una fila ajena
    const listaCols = cols[t].filter((c) => !c.gen && !c.ident).map((c) => qi(c.nombre)).join(',')
    r = await intentar(a.rol, a.uid, `insert into public.${qi(t)} (${listaCols}) select ${listaCols} from jsonb_populate_record(null::public.${qi(t)}, $1::jsonb)`, [JSON.stringify(insertable)])
    if (!r.ok && r.codigo === '42501') reg(t, a.etiqueta, 'INSERT', 'ok', 'rechazado por RLS o permisos')
    else if (r.ok) reg(t, a.etiqueta, 'INSERT', 'FUGA', 'creó una fila a nombre de otra empresa')
    else if (['23505', '23503', '23502', '23514'].includes(r.codigo)) {
      // Pasó RLS y falló recién en una restricción de datos: la política NO lo impidió.
      reg(t, a.etiqueta, 'INSERT', 'FUGA', `pasó RLS (falló después por ${r.codigo}: ${r.msg.slice(0, 80)})`)
    } else reg(t, a.etiqueta, 'INSERT', 'inconcluso', `${r.codigo}: ${r.msg.slice(0, 100)}`)
  }
  // Control positivo: el admin de A ve lo propio (informativo; algunas tablas son de uso restringido).
  if (propias.length) {
    const r = await intentar('admin', uidRol(EMP_A, 'admin'), `select count(*)::int n from public.${qi(t)} where ctid = any($1::tid[])`, [propias])
    cobertura[t].adminVeLoPropio = r.ok && r.rows[0].n > 0
  }
}

// ---------------------------------------------------------------------------
// 4. Escalada de privilegios, storage, funciones, columnas protegidas
// ---------------------------------------------------------------------------
const escalada = []
async function probarEscalada() {
  const regE = (nombre, ok, detalle) => escalada.push({ nombre, estado: ok ? 'ok' : 'FUGA', detalle })
  const tecnicoA = uidRol(EMP_A, 'tecnico'), adminA = uidRol(EMP_A, 'admin'), asesorA = uidRol(EMP_A, 'asesor')
  const sinCambio = (r) => !r.ok || r.filas === 0
  let r = await intentar('tecnico', tecnicoA, `update public.usuarios set rol='admin' where id=$1`, [tecnicoA])
  regE('técnico no puede subirse a admin', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('tecnico', tecnicoA, `update public.usuarios set empresa_id=$2 where id=$1`, [tecnicoA, EMP_B])
  regE('técnico no puede cambiarse de empresa', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('asesor', asesorA, `update public.usuarios set rol='admin', activo=true where id=$1`, [asesorA])
  regE('asesor no puede subirse a admin', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('admin', adminA, `update public.usuarios set empresa_id=$2 where id=$1`, [uidRol(EMP_A, 'asesor'), EMP_B])
  regE('admin A no puede mover a un usuario de A hacia B', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('admin', adminA, `update public.usuarios set rol='tecnico' where id=$1`, [uidRol(EMP_B, 'admin')])
  regE('admin A no puede cambiar el rol de un usuario de B', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('admin', adminA, `update public.empresas set nombre='tomada' where id=$1`, [EMP_B])
  regE('admin A no puede renombrar la empresa B', sinCambio(r), r.ok ? `filas=${r.filas}` : r.codigo)
  r = await intentar('admin', adminA, `insert into public.empresas (id, nombre) values (gen_random_uuid(), 'creada por admin')`)
  regE('admin de una empresa no puede crear empresas', !r.ok, r.ok ? 'creó una empresa' : r.codigo)
  r = await intentar('admin', adminA, `insert into public.usuarios (id, empresa_id, correo, rol, activo) values (gen_random_uuid(), $1, 'x@x.cl', 'admin', true)`, [EMP_B])
  regE('admin A no puede crear usuarios en B', !r.ok, r.ok ? 'creó un usuario en B' : r.codigo)
  r = await intentar('anon', null, `select count(*)::int n from public.usuarios`)
  regE('anon no lee usuarios', !r.ok || r.rows[0].n === 0, r.ok ? `n=${r.rows[0].n}` : r.codigo)
}

const storageRes = []
async function probarStorage() {
  const buckets = (await q(`select id, public from storage.buckets order by 1`)).rows
  for (const { id: b, public: esPublico } of buckets) {
    const idObj = crypto.randomUUID()
    await q(`insert into storage.objects (id, bucket_id, name) values ($1, $2, $3)`, [idObj, b, `${EMP_B}/prueba/ajeno.jpg`])
    for (const a of [{ rol: 'admin', uid: uidRol(EMP_A, 'admin') }, { rol: 'tecnico', uid: uidRol(EMP_A, 'tecnico') }, { rol: 'anon', uid: null }]) {
      const sel = await intentar(a.rol, a.uid, `select count(*)::int n from storage.objects where id=$1`, [idObj])
      // Un bucket marcado público (p. ej. logos-empresa) se lee sin sesión por diseño.
      const lecturaOk = !sel.ok || sel.rows[0].n === 0
      storageRes.push({ bucket: b, rol: a.rol, op: 'SELECT', estado: lecturaOk ? 'ok' : esPublico ? 'público-por-diseño' : 'FUGA' })
      const upd = await intentar(a.rol, a.uid, `update storage.objects set name = name where id=$1`, [idObj])
      storageRes.push({ bucket: b, rol: a.rol, op: 'UPDATE', estado: !upd.ok || upd.filas === 0 ? 'ok' : 'FUGA' })
      const del = await intentar(a.rol, a.uid, `delete from storage.objects where id=$1`, [idObj])
      storageRes.push({ bucket: b, rol: a.rol, op: 'DELETE', estado: !del.ok || del.filas === 0 ? 'ok' : 'FUGA' })
      const ins = await intentar(a.rol, a.uid, `insert into storage.objects (bucket_id, name) values ($1, $2)`, [b, `${EMP_B}/prueba/intruso-${a.rol}.jpg`])
      storageRes.push({ bucket: b, rol: a.rol, op: 'INSERT', estado: !ins.ok ? 'ok' : 'FUGA' })
    }
    await q(`delete from storage.objects where bucket_id=$1 and name like $2`, [b, `${EMP_B}/%`])
  }
}

async function inventarioFunciones() {
  const fn = (await q(`select p.proname n, pg_get_function_identity_arguments(p.oid) a, p.prosecdef sd,
      coalesce(array_to_string(p.proconfig, ','), '') cfg,
      has_function_privilege('anon', p.oid, 'execute') anon_ejec,
      has_function_privilege('authenticated', p.oid, 'execute') auth_ejec,
      p.prorettype::regtype::text ret
    from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.prokind='f' and p.prorettype <> 'trigger'::regtype order by 1, 2`)).rows
  const sd = fn.filter((f) => f.sd)
  const hallazgos = {
    sin_search_path: sd.filter((f) => !/search_path=/.test(f.cfg)).map((f) => `${f.n}(${f.a})`),
    ejecutable_por_anon: sd.filter((f) => f.anon_ejec).map((f) => `${f.n}(${f.a})`),
    parametro_empresa: sd.filter((f) => f.auth_ejec && /empresa/i.test(f.a)).map((f) => `${f.n}(${f.a})`),
  }
  hallazgos.columnas_sin_proteccion = await columnasDeclaradasSinEfecto()
  return { total: fn.length, securityDefiner: sd.length, hallazgos }
}

// Protecciones de columna DECLARADAS en las migraciones (`revoke select (col) on tabla from rol`)
// que no tienen efecto: en Postgres, un REVOKE de columna no quita un SELECT concedido a nivel
// de tabla, y Supabase concede SELECT sobre las tablas de public por defecto. Se reporta cada
// columna que el rol nombrado todavía puede leer.
async function columnasDeclaradasSinEfecto() {
  const dir = path.join(AQUI, '..', '..', 'migrations')
  const hallados = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '')
    for (const m of sql.matchAll(/revoke\s+select\s*\(([^)]+)\)\s+on\s+(?:table\s+)?public\.(\w+)\s+from\s+([^;]+);/gi)) {
      const columnas = m[1].split(',').map((c) => c.trim())
      const roles = m[3].split(',').map((r) => r.trim().toLowerCase()).filter((r) => ['anon', 'authenticated'].includes(r))
      for (const rol of roles) for (const col of columnas) {
        const r = await q(`select has_column_privilege($1, $2, $3, 'select') as puede`, [rol, `public.${m[2]}`, col]).catch(() => null)
        if (r && r.rows[0].puede) hallados.push(`${m[2]}.${col}@${rol} (declarada en ${f})`)
      }
    }
  }
  return hallados
}

// Pruebas de EXPLOTACIÓN de funciones SECURITY DEFINER expuestas por RPC: se intenta usarlas
// contra datos de otra empresa, como visitante sin sesión (anon) y como administrador de A.
const funcionesRes = []
async function probarFuncionesExpuestas() {
  const reg = (nombre, estado, detalle = '') => funcionesRes.push({ nombre, estado, detalle })
  const actores = [{ rol: 'anon', uid: null, et: 'anon' }, { rol: 'admin', uid: uidRol(EMP_A, 'admin'), et: 'admin A' }]
  const uno = async (sql, p = []) => (await q(sql, p)).rows[0]
  const cli = await uno(`select id, empresa_id, telefono, rut from public.clientes where empresa_id <> $1 and telefono is not null limit 1`, [EMP_A])
  const trabajoAbierto = await uno(`select id from public.trabajos_taller where empresa_id <> $1 and bloqueada_en is null and estado = 'entregado' limit 1`, [EMP_A])
  const trabajoCerrado = await uno(`select id from public.trabajos_taller where empresa_id <> $1 and bloqueada_en is not null limit 1`, [EMP_A])
  const trabajoAjeno = await uno(`select id from public.trabajos_taller where empresa_id <> $1 limit 1`, [EMP_A])
  const servicioAjeno = await uno(`select id from public.catalogo_servicios where empresa_id <> $1 limit 1`, [EMP_A])
  const descuentoAjeno = await uno(`select id from public.descuentos_ot where empresa_id <> $1 limit 1`, [EMP_A])

  // Ejecuta la llamada y compara el estado de una fila antes y después (como superusuario).
  async function efecto(a, tabla, id, llamada, params) {
    return como(a.rol, a.uid, async (c) => {
      const foto = async () => { await c.query('reset role'); const r = (await c.query(`select to_jsonb(t)::text j from public.${qi(tabla)} t where id = $1`, [id])).rows[0]?.j; await c.query(`set local role ${a.rol === 'anon' ? 'anon' : 'authenticated'}`); return r }
      const antes = await foto()
      let error = null
      try { await c.query('savepoint x'); await c.query(llamada, params); await c.query('release savepoint x') } catch (e) { error = e.code; await c.query('rollback to savepoint x') }
      const despues = await foto()
      return { cambio: antes !== despues, error }
    })
  }

  // 1) Buscar un cliente de otra empresa por teléfono.
  if (cli) for (const a of actores) {
    const r = await intentar(a.rol, a.uid, `select public.whatsapp_buscar_cliente_por_telefono($1, $2) id`, [cli.telefono, cli.empresa_id])
    reg(`whatsapp_buscar_cliente_por_telefono: ${a.et} consulta clientes de otra empresa`, r.ok && r.rows[0].id ? 'FUGA' : 'ok', r.ok ? (r.rows[0].id ? 'devuelve el id de un cliente ajeno' : 'sin resultado') : r.codigo)
  }
  // 2) Escribir un contacto de WhatsApp en otra empresa.
  const cuentaAjena = await uno(`select empresa_id, phone_number_id from public.whatsapp_cuentas where empresa_id <> $1 limit 1`, [EMP_A])
  if (cuentaAjena) for (const a of actores) {
    const marca = 'intruso-' + Math.random().toString(36).slice(2, 8)
    const v = await como(a.rol, a.uid, async (c) => {
      try { await c.query('savepoint x'); await c.query(`select public.whatsapp_registrar_contacto($1,$2,$3,$4)`, [cuentaAjena.empresa_id, cuentaAjena.phone_number_id, marca, 'intruso']); await c.query('release savepoint x') } catch (e) { return { error: e.code } }
      await c.query('reset role')
      return { n: (await c.query(`select count(*)::int n from public.whatsapp_contactos where wa_id=$1 and empresa_id=$2`, [marca, cuentaAjena.empresa_id])).rows[0].n }
    })
    const estado = v.n > 0 ? 'FUGA' : v.error === '42501' ? 'ok' : v.error ? 'inconcluso' : 'ok'
    reg(`whatsapp_registrar_contacto: ${a.et} escribe contactos en otra empresa`, estado, v.n > 0 ? 'insertó un contacto en una empresa ajena' : v.error ? `error ${v.error}` : 'no insertó')
  }
  // 3) Reabrir / bloquear OT de otra empresa.
  for (const a of actores) {
    if (trabajoCerrado) { const e = await efecto(a, 'trabajos_taller', trabajoCerrado.id, `select public.trabajo_reabrir($1)`, [trabajoCerrado.id]); reg(`trabajo_reabrir: ${a.et} sobre OT ajena`, e.cambio ? 'FUGA' : 'ok', e.cambio ? 'cambió la OT ajena' : `sin efecto (${e.error ?? 'sin error'})`) }
    if (trabajoAbierto) { const e = await efecto(a, 'trabajos_taller', trabajoAbierto.id, `select public.trabajo_bloquear($1)`, [trabajoAbierto.id]); reg(`trabajo_bloquear: ${a.et} sobre OT ajena`, e.cambio ? 'FUGA' : 'ok', e.cambio ? 'cambió la OT ajena' : `sin efecto (${e.error ?? 'sin error'})`) }
    if (trabajoAjeno && servicioAjeno) { const e = await efecto(a, 'trabajos_taller', trabajoAjeno.id, `select public.agregar_servicio_catalogo($1,$2,null)`, [trabajoAjeno.id, servicioAjeno.id]); reg(`agregar_servicio_catalogo: ${a.et} sobre OT ajena`, e.cambio ? 'FUGA' : 'ok', e.error ?? 'sin efecto') }
    if (descuentoAjeno) { const e = await efecto(a, 'descuentos_ot', descuentoAjeno.id, `select public.ot_descuento_mano_obra_resolver($1, true, 'x')`, [descuentoAjeno.id]); reg(`ot_descuento_mano_obra_resolver: ${a.et} sobre descuento ajeno`, e.cambio ? 'FUGA' : 'ok', e.error ?? 'sin efecto') }
  }
  // 4) Buscar duplicados no debe mostrar clientes de otra empresa.
  if (cli) {
    const r = await intentar('admin', uidRol(EMP_A, 'admin'), `select * from public.clientes_buscar_posibles_duplicados($1,$2,$3)`, [cli.rut, cli.telefono, 'x'])
    const ve = r.ok && r.rows.some((f) => Object.values(f).includes(cli.id))
    reg('clientes_buscar_posibles_duplicados: admin A no ve clientes de otra empresa', ve ? 'FUGA' : 'ok', r.ok ? `${r.rows.length} filas` : r.codigo)
  }
  // 5) Todas las funciones plataforma_* deben rechazar a un administrador común.
  const fnPlat = (await q(`select p.proname n, (select coalesce(string_agg(format('null::%s', format_type(t, null)), ','), '') from unnest(p.proargtypes::oid[]) t) args
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'plataforma\\_%' and p.proname <> 'plataforma_exigir'
      and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).rows
  for (const f of fnPlat) {
    const r = await intentar('admin', uidRol(EMP_A, 'admin'), `select * from public.${qi(f.n)}(${f.args})`)
    const bloqueada = !r.ok && r.codigo === '42501'
    reg(`${f.n}: administrador común no entra al monitor de plataforma`, bloqueada ? 'ok' : r.ok ? 'FUGA' : 'inconcluso', bloqueada ? 'rechazado' : r.ok ? `devolvió ${r.filas} filas` : `${r.codigo}: ${r.msg.slice(0, 80)}`)
  }
  // 5b) Funciones que reciben una empresa por parámetro: un admin de A no puede pedir datos de otra.
  if (cli) {
    const r = await intentar('admin', uidRol(EMP_A, 'admin'), `select * from public.turnos_resumen_diario($1, current_date - 7, current_date)`, [cli.empresa_id])
    reg('turnos_resumen_diario: admin A no pide asistencia de otra empresa', r.ok && r.filas > 0 ? 'FUGA' : 'ok', r.ok ? `${r.filas} filas` : `rechazado (${r.codigo})`)
  }
  // 6) Encuesta pública por token: un token inventado no devuelve nada.
  const enc = await intentar('anon', null, `select * from public.encuesta_obtener_por_token($1)`, ['token-inexistente-' + Math.random()])
  reg('encuesta_obtener_por_token: token inventado no devuelve datos', enc.ok && enc.rows.length && Object.values(enc.rows[0]).some((v) => v != null) ? 'FUGA' : 'ok', enc.ok ? `${enc.rows.length} filas` : enc.codigo)
}

// H4 (0077): funciones de agenda y catálogo que reciben el id de una isla, servicio o persona.
// Con un id de OTRA empresa deben responder como con un id inexistente (null / false / sin filas), y sin
// sesión no deben ejecutarse. Los controles positivos comprueban que la ruta legítima sigue funcionando:
// un usuario de la propia empresa y service_role (el bot de WhatsApp) siguen obteniendo datos.
const agendaRes = []
async function probarFuncionesAgenda() {
  const reg = (nombre, estado, detalle = '') => agendaRes.push({ nombre, estado, detalle })
  const EMP_DEMO = 'b0000000-0000-4000-8000-000000000001'
  const adminDemo = { rol: 'admin', uid: 'a0000000-0000-4000-8000-000000000001' }
  const ids = async (sql) => (await q(sql, [EMP_DEMO])).rows.map((r) => r.id)
  const [isla] = await ids(`select id from public.tipos_isla where empresa_id = $1 order by id`)
  const [persona] = await ids(`select id from public.personal_taller where empresa_id = $1 and activo order by id`)
  const servicios = await ids(`select id from public.catalogo_servicios where empresa_id = $1 order by id`)
  if (!isla || !persona || !servicios.length) { reg('datos de agenda de la empresa demo', 'REGRESION', 'faltan islas, personal o servicios para probar'); return }
  const fecha = '2026-11-09' // lunes: fija, para que el resultado no dependa del día en que corra
  // Un servicio con isla y uno con horas, buscados como service_role (el bot).
  let servicioIsla = null
  let servicioHoras = null
  for (const s of servicios) {
    if (!servicioIsla) { const r = await intentar('service_role', null, `select public.catalogo_isla_para_servicio($1) v`, [s]); if (r.ok && r.rows[0].v) servicioIsla = s }
    if (!servicioHoras) { const r = await intentar('service_role', null, `select public.catalogo_horas_servicio($1, null, null) v`, [s]); if (r.ok && r.rows[0].v !== null) servicioHoras = s }
  }
  const llamadas = [
    { f: 'agenda_cupos_bloque', sql: `select public.agenda_cupos_bloque($1, $2, 600) v`, p: [isla, fecha], vale: (v) => v !== null },
    { f: 'citas_cupos_disponibles', sql: `select public.citas_cupos_disponibles($1, $2, '10:00', 60) v`, p: [isla, fecha], vale: (v) => v !== null },
    { f: 'citas_buscar_horarios', sql: `select count(*)::int v from public.citas_buscar_horarios($1, 60, $2, 14, 6)`, p: [isla, fecha], vale: (v) => v > 0 },
    { f: 'personal_disponible_en', sql: `select bool_or(public.personal_disponible_en($1, d::date, m)) v from generate_series($2::date, $2::date + 6, '1 day') d, (values (540), (600), (780)) x(m)`, p: [persona, fecha], vale: (v) => v === true },
  ]
  if (servicioIsla) llamadas.push({ f: 'catalogo_isla_para_servicio', sql: `select public.catalogo_isla_para_servicio($1) v`, p: [servicioIsla], vale: (v) => v !== null })
  if (servicioHoras) llamadas.push({ f: 'catalogo_horas_servicio', sql: `select public.catalogo_horas_servicio($1, null, null) v`, p: [servicioHoras], vale: (v) => v !== null })
  if (llamadas.length < 6) reg('cobertura de agenda', 'REGRESION', `solo ${llamadas.length} de 6 funciones tienen datos de prueba en la demo`)
  const vacio = (v) => v === null || v === false || v === 0

  for (const l of llamadas) {
    // Controles positivos: la ruta legítima sigue entregando datos.
    const propio = await intentar(adminDemo.rol, adminDemo.uid, l.sql, l.p)
    reg(`${l.f}: un usuario de la propia empresa obtiene datos`, propio.ok && l.vale(propio.rows[0].v) ? 'ok' : 'REGRESION', propio.ok ? `v=${propio.rows[0].v}` : propio.codigo)
    const bot = await intentar('service_role', null, l.sql, l.p)
    reg(`${l.f}: service_role (bot de WhatsApp) obtiene datos`, bot.ok && l.vale(bot.rows[0].v) ? 'ok' : 'REGRESION', bot.ok ? `v=${bot.rows[0].v}` : bot.codigo)
    // Ataques: un admin de otra empresa y un visitante sin sesión.
    const ajeno = await intentar('admin', uidRol(EMP_A, 'admin'), l.sql, l.p)
    reg(`${l.f}: un admin de otra empresa no obtiene datos`, ajeno.ok && !vacio(ajeno.rows[0].v) ? 'FUGA' : 'ok', ajeno.ok ? `v=${ajeno.rows[0].v}` : ajeno.codigo)
    const anon = await intentar('anon', null, l.sql, l.p)
    reg(`${l.f}: sin sesión no se puede ejecutar`, anon.ok ? 'FUGA' : 'ok', anon.ok ? `v=${anon.rows[0].v}` : anon.codigo)
  }
}

async function columnasProtegidas() {
  const filas = (await q(`select c.relname t, a.attname col
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'select')
      and not has_column_privilege('authenticated', c.oid, a.attnum, 'select')
    order by 1, 2`)).rows
  const res = []
  for (const f of filas) {
    const r = await intentar('tecnico', uidRol(EMP_A, 'tecnico'), `select ${qi(f.col)} from public.${qi(f.t)} limit 1`)
    res.push({ tabla: f.t, columna: f.col, estado: !r.ok ? 'ok' : 'FUGA', detalle: r.ok ? 'el técnico la lee' : r.codigo })
  }
  return res
}

// ---------------------------------------------------------------------------
// 5. Ejecución y reporte
// ---------------------------------------------------------------------------
console.log('Sembrando dos empresas de prueba con un usuario por rol…')
await sembrarEmpresasYUsuarios()
await sembrarTodo()
const sembradas = Object.keys(fallosSiembra).length
console.log(`Siembra lista. Tablas que el generador no pudo poblar: ${sembradas} (se prueban con las filas de la empresa demo si las hay).`)

const lista = SOLO ? tablas.filter((t) => t === SOLO) : tablas
for (const t of lista) await probarTabla(t)
await probarEscalada()
await probarStorage()
await probarFuncionesExpuestas()
await probarFuncionesAgenda()
const funciones = await inventarioFunciones()
const columnas = await columnasProtegidas()

await admin.end()
await prueba.end()

// --- resumen
const fugas = resultados.filter((r) => r.estado === 'FUGA')
const inconclusos = resultados.filter((r) => r.estado === 'inconcluso')
const tablasSinDatos = Object.entries(cobertura).filter(([, c]) => c.ajenas === 0).map(([t]) => t)
const tablasProbadas = Object.entries(cobertura).filter(([, c]) => c.ajenas > 0).map(([t]) => t)
const fugasStorage = storageRes.filter((r) => r.estado === 'FUGA')
const fugasEscalada = escalada.filter((r) => r.estado === 'FUGA')
const fugasColumnas = columnas.filter((c) => c.estado === 'FUGA')

// Higiene: comparación con la línea base (solo fallan hallazgos nuevos).
// La línea base es { categoría: { "función(args)": "motivo por el que se acepta" } }.
// Un hallazgo que no esté en la línea base hace fallar la prueba; para aceptarlo hay que
// revisarlo y escribir el motivo (no basta con regenerar el archivo).
let base = { sin_search_path: {}, ejecutable_por_anon: {}, parametro_empresa: {}, columnas_sin_proteccion: {} }
if (fs.existsSync(ARCHIVO_BASE)) base = JSON.parse(fs.readFileSync(ARCHIVO_BASE, 'utf8'))
const nuevosHigiene = {}
for (const k of Object.keys(funciones.hallazgos)) nuevosHigiene[k] = funciones.hallazgos[k].filter((x) => !(x in (base[k] || {})))
const hayNuevosHigiene = Object.values(nuevosHigiene).some((v) => v.length)
const sinRevisar = Object.values(base).flatMap((o) => Object.values(o)).filter((m) => /SIN REVISAR/i.test(m)).length
const conocidos = Object.entries(base).flatMap(([cat, o]) => Object.entries(o).filter(([, m]) => /HALLAZGO CONOCIDO/i.test(m)).map(([k, m]) => ({ cat, k, m })))
// Entradas de la línea base que ya no aparecen: el problema se corrigió y hay que quitarlas.
const obsoletas = Object.entries(base).flatMap(([cat, o]) => Object.keys(o).filter((k) => !(funciones.hallazgos[cat] || []).includes(k)).map((k) => `${cat}: ${k}`))
if (ACTUALIZAR_BASE) {
  const nueva = {}
  for (const k of Object.keys(funciones.hallazgos)) {
    nueva[k] = {}
    for (const x of funciones.hallazgos[k]) nueva[k][x] = (base[k] || {})[x] ?? 'SIN REVISAR'
  }
  fs.writeFileSync(ARCHIVO_BASE, JSON.stringify(nueva, null, 2) + '\n')
}
const fugasFunciones = funcionesRes.filter((f) => f.estado === 'FUGA')
const inconclusosFunciones = funcionesRes.filter((f) => f.estado === 'inconcluso')
const fallosAgenda = agendaRes.filter((f) => f.estado !== 'ok')

fs.mkdirSync(SALIDA, { recursive: true })
fs.writeFileSync(path.join(SALIDA, 'informe.json'), JSON.stringify({ cobertura, fugas, inconclusos, escalada, storage: storageRes, funcionesExpuestas: funcionesRes, funcionesAgenda: agendaRes, funciones, columnas, fallosSiembra }, null, 2))

const resumenFugas = {}
for (const f of fugas) (resumenFugas[f.tabla] ||= new Set()).add(`${f.op}[${f.rol}]`)
console.log('\n================ RESULTADO ================')
console.log(`Tablas en public .................. ${tablas.length}`)
console.log(`Tablas probadas con filas ajenas .. ${tablasProbadas.length}`)
console.log(`Tablas sin filas ajenas (sin cubrir) ${tablasSinDatos.length}: ${tablasSinDatos.join(', ') || '—'}`)
console.log(`Pruebas de tabla ejecutadas ....... ${resultados.length}  (FUGA: ${fugas.length}, inconclusas: ${inconclusos.length})`)
console.log(`Escalada de privilegios ........... ${escalada.length} pruebas, FUGA: ${fugasEscalada.length}`)
console.log(`Storage ........................... ${storageRes.length} pruebas, FUGA: ${fugasStorage.length}`)
console.log(`Columnas con privilegio revocado .. ${columnas.length}, FUGA: ${fugasColumnas.length}`)
console.log(`Explotación de funciones expuestas . ${funcionesRes.length} pruebas, FUGA: ${fugasFunciones.length}, inconclusas: ${inconclusosFunciones.length}`)
console.log(`Funciones de agenda (H4) ......... ${agendaRes.length} pruebas, fallos: ${fallosAgenda.length}`)
console.log(`Funciones SECURITY DEFINER (no disparadores) ${funciones.securityDefiner} de ${funciones.total}; línea base sin revisar: ${sinRevisar}`)
for (const [k, v] of Object.entries(funciones.hallazgos)) console.log(`  higiene · ${k}: ${v.length} (nuevos: ${nuevosHigiene[k].length})`)
if (fugas.length) {
  console.log('\n--- FUGAS en tablas ---')
  for (const [t, ops] of Object.entries(resumenFugas)) console.log(`  ${t}: ${[...ops].slice(0, 12).join(', ')}${ops.size > 12 ? ` … (+${ops.size - 12})` : ''}`)
  if (DETALLE) for (const f of fugas.slice(0, 60)) console.log(`   · ${f.tabla} ${f.op} [${f.rol}] ${f.detalle}`)
}
if (fugasEscalada.length) { console.log('\n--- FUGAS de escalada ---'); fugasEscalada.forEach((e) => console.log(`  ${e.nombre}: ${e.detalle}`)) }
if (fugasStorage.length) { console.log('\n--- FUGAS de storage ---'); fugasStorage.forEach((e) => console.log(`  ${e.bucket} ${e.op} [${e.rol}]`)) }
if (fallosAgenda.length) { console.log('\n--- FALLOS en las funciones de agenda (H4) ---'); fallosAgenda.forEach((e) => console.log(`  [${e.estado}] ${e.nombre}: ${e.detalle}`)) }
if (fugasFunciones.length) { console.log('\n--- FUGAS por funciones expuestas ---'); fugasFunciones.forEach((e) => console.log(`  ${e.nombre}: ${e.detalle}`)) }
if (DETALLE && inconclusosFunciones.length) { console.log('\n--- Funciones inconclusas ---'); inconclusosFunciones.forEach((e) => console.log(`  ${e.nombre}: ${e.detalle}`)) }
if (fugasColumnas.length) { console.log('\n--- FUGAS de columnas protegidas ---'); fugasColumnas.forEach((e) => console.log(`  ${e.tabla}.${e.columna}`)) }
if (conocidos.length) { console.log(`\n--- HALLAZGOS CONOCIDOS PENDIENTES (${conocidos.length}; no bloquean, pero están abiertos) ---`); conocidos.forEach((c) => console.log(`  [${c.cat}] ${c.k}`)) }
if (obsoletas.length) { console.log('\n--- Entradas OBSOLETAS en la línea base (ya no se detectan; bórralas de linea-base-higiene.json) ---'); obsoletas.forEach((o) => console.log(`  ${o}`)) }
if (hayNuevosHigiene) { console.log('\n--- Higiene: hallazgos NUEVOS respecto de la línea base ---'); for (const [k, v] of Object.entries(nuevosHigiene)) v.forEach((x) => console.log(`  ${k}: ${x}`)) }
if (DETALLE && inconclusos.length) { console.log('\n--- Inconclusos (revisar) ---'); inconclusos.slice(0, 40).forEach((f) => console.log(`   · ${f.tabla} ${f.op} [${f.rol}] ${f.detalle}`)) }
console.log(`\nInforme completo: ${path.join(SALIDA, 'informe.json')}`)

const hayFuga = fugas.length || fugasEscalada.length || fugasStorage.length || fugasColumnas.length || fugasFunciones.length || fallosAgenda.length
if (hayFuga || hayNuevosHigiene) { console.log('\nRESULTADO: FALLA'); process.exit(1) }
console.log('\nRESULTADO: OK — ningún acceso entre empresas detectado.')
