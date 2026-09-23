// Script de un solo uso: crea las 8 cuentas de autenticación del tenant
// "VPAI Demo" (una por rol, ver 0036_tenant_demo_vpai.sql) y sube el logo
// al bucket público logos-empresa, en la ruta que esa migración espera
// -determinística a propósito, para no tener que capturar la salida del
// script y pegarla de vuelta en el SQL-.
//
// Requiere SUPABASE_SERVICE_ROLE_KEY (Dashboard → Settings → API): un
// secreto real, nunca se guarda en este repo. Se lee de una variable de
// entorno pasada al momento de correr el script, no de un archivo.
//
// Uso: SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-demo-vpai.mjs

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

const SUPABASE_URL = 'https://ywdozovkhnnvlpckstsd.supabase.co'
const EMPRESA_ID = 'b0000000-0000-4000-8000-000000000001'
const CONTRASENA_DEMO = 'VpaiDemo2026!'

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceRoleKey) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const USUARIOS_DEMO = [
  { id: 'a0000000-0000-4000-8000-000000000001', correo: 'demo-admin@vpai.dev', rol: 'admin' },
  { id: 'a0000000-0000-4000-8000-000000000002', correo: 'demo-socia@vpai.dev', rol: 'socia' },
  { id: 'a0000000-0000-4000-8000-000000000003', correo: 'demo-asesor@vpai.dev', rol: 'asesor' },
  { id: 'a0000000-0000-4000-8000-000000000004', correo: 'demo-jefe-taller@vpai.dev', rol: 'jefe_taller' },
  { id: 'a0000000-0000-4000-8000-000000000005', correo: 'demo-presupuestos@vpai.dev', rol: 'encargado_presupuestos' },
  { id: 'a0000000-0000-4000-8000-000000000006', correo: 'demo-tecnico@vpai.dev', rol: 'tecnico' },
  { id: 'a0000000-0000-4000-8000-000000000007', correo: 'demo-detailer@vpai.dev', rol: 'detailer' },
  { id: 'a0000000-0000-4000-8000-000000000008', correo: 'demo-recepcionista@vpai.dev', rol: 'recepcionista' },
]

async function crearUsuarios() {
  for (const usuario of USUARIOS_DEMO) {
    const { data, error } = await supabase.auth.admin.createUser({
      id: usuario.id,
      email: usuario.correo,
      password: CONTRASENA_DEMO,
      email_confirm: true,
    })

    if (error) {
      if (error.message?.toLowerCase().includes('already been registered') || error.code === 'email_exists') {
        console.log(`Ya existía: ${usuario.correo}`)
        continue
      }
      console.error(`Error creando ${usuario.correo}:`, error.message)
      continue
    }
    console.log(`Creado: ${usuario.correo} (${data.user.id})`)
  }
}

async function subirLogo() {
  const archivo = await readFile(new URL('../public/logo-vpai.png', import.meta.url))
  const ruta = `${EMPRESA_ID}/logo-vpai.png`

  const { error } = await supabase.storage.from('logos-empresa').upload(ruta, archivo, {
    contentType: 'image/png',
    upsert: true,
  })

  if (error) {
    console.error('Error subiendo el logo:', error.message)
    return
  }
  console.log(`Logo subido: ${SUPABASE_URL}/storage/v1/object/public/logos-empresa/${ruta}`)
}

await crearUsuarios()
await subirLogo()
console.log('Listo. Ahora corre la migración 0036_tenant_demo_vpai.sql en el SQL Editor.')
