// Correos de prueba de la demo (cliente y asesor). Viven SOLO en la pestaña del
// navegador (sessionStorage) y se piden de nuevo en cada inicio de sesión:
// nada se guarda en la base, así que no hay nada que limpiar entre pruebas.
//
// Cada inicio de sesión se reconoce por `sesion.user.last_sign_in_at`, que solo
// cambia al iniciar sesión (no al refrescar el token ni al recargar la página).
const CLAVE = 'correosDemo'

export const EVENTO_ABRIR_CORREOS_DEMO = 'abrir-correos-demo'

function identificarSesion(sesion) {
  return sesion?.user?.last_sign_in_at || sesion?.user?.id || null
}

function leer() {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE) || 'null')
  } catch {
    return null
  }
}

function escribir(valor) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(valor))
  } catch {
    // Sin sessionStorage (ventana privada): se volverán a pedir, sin romper nada.
  }
}

// 'pendiente' = hay que preguntar; 'omitido' = dijo "ahora no"; 'listo' = ya hay correos.
export function estadoCorreosDemo(sesion) {
  const guardado = leer()
  const id = identificarSesion(sesion)
  if (!id || !guardado || guardado.sesion !== id) return 'pendiente'
  return guardado.cliente && guardado.asesor ? 'listo' : 'omitido'
}

export function leerCorreosDemo(sesion) {
  return estadoCorreosDemo(sesion) === 'listo' ? { cliente: leer().cliente, asesor: leer().asesor } : null
}

export function guardarCorreosDemo(sesion, cliente, asesor) {
  escribir({ sesion: identificarSesion(sesion), cliente, asesor })
}

export function omitirCorreosDemo(sesion) {
  escribir({ sesion: identificarSesion(sesion), cliente: null, asesor: null })
}

export function pedirCorreosDemo() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_CORREOS_DEMO))
}
