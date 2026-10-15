// Credenciales de la demo (tenant VPAI): usadas por LoginDemo.jsx para entrar
// eligiendo un rol, y por el selector "Cambiar de rol" de BarraSuperior.jsx
// para cambiar de cuenta sin pasar por /login.
//
// IMPORTANTE: deben mantenerse sincronizadas a mano con
// scripts/crear-demo-vpai.mjs, que es el dueño real de estas cuentas en
// Supabase Auth (CONTRASENA_DEMO ahí es la misma constante). No son
// credenciales secretas: la demo es pública y compartida por quien quiera
// probarla.
//
// 'socia' no tiene correo acá a propósito: esa cuenta (demo-socia@vpai.dev)
// se fusionó con 'admin' en la demo (migración 0065) y ya no se ofrece como
// rol para entrar. 'detailer' tampoco se ofrece (selector simplificado), pero
// la cuenta sigue existiendo.
export const CONTRASENA_DEMO = 'VpaiDemo2026!'

export const CORREO_DEMO_POR_ROL = {
  admin: 'demo-admin@vpai.dev',
  asesor: 'demo-asesor@vpai.dev',
  jefe_taller: 'demo-jefe-taller@vpai.dev',
  encargado_presupuestos: 'demo-presupuestos@vpai.dev',
  tecnico: 'demo-tecnico@vpai.dev',
  recepcionista: 'demo-recepcionista@vpai.dev',
}

// Etiquetas que muestran los selectores de rol de la demo. Misma cuenta y
// permisos que el rol del sistema, solo cambia el nombre visible.
export const ETIQUETAS_ROL_DEMO = {
  encargado_presupuestos: 'Encargado de bodega',
}

export async function cambiarRolDemo(supabase, rol) {
  await supabase.auth.signOut()
  const { error } = await supabase.auth.signInWithPassword({
    email: CORREO_DEMO_POR_ROL[rol],
    password: CONTRASENA_DEMO,
  })
  if (error) throw error
}
