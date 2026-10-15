// Registro de uso del CRM para el Monitor de plataforma (0056): logins, vistas
// de pantalla y errores del navegador. Nunca debe afectar a la app: todo falla
// en silencio y las escrituras van en lotes, sin bloquear ninguna pantalla.
// Empresa, usuario y rol los pone la base desde la sesión (registrar_eventos_uso);
// acá solo se manda qué pasó y dónde.
import { supabase } from '../supabaseClient'

const INTERVALO_ENVIO_MS = 10000
const MAX_EN_COLA = 40
const MAX_ERRORES_POR_MINUTO = 5

let cola = []
let temporizador = null
let erroresRecientes = []
let ultimaVista = { ruta: null, en: 0 }

// Reemplaza ids (uuid o números largos) por :id, para que /trabajos/<uuid>
// cuente como una sola pantalla y no se filtre ningún identificador.
export function normalizarRuta(ruta) {
  return (ruta || '/')
    .split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:id')
    .replace(/\/encuesta\/[^/]+/, '/encuesta/:token')
}

// "Chrome · Windows · escritorio", sin guardar el user-agent completo.
export function describirDispositivo() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent || ''
  const navegador = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Otro'
  const sistema = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro'
  const tipo = /Mobi|Android|iPhone|iPad/.test(ua) ? 'móvil' : 'escritorio'
  return `${navegador} · ${sistema} · ${tipo}`
}

export async function enviarEventosPendientes() {
  if (temporizador) {
    clearTimeout(temporizador)
    temporizador = null
  }
  if (cola.length === 0) return
  const lote = cola
  cola = []
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    await supabase.rpc('registrar_eventos_uso', { p_eventos: lote })
  } catch {
    // El monitor es secundario: si no se pudo registrar, se pierde el lote y ya.
  }
}

function encolar(evento) {
  cola.push({ ...evento, dispositivo: describirDispositivo() })
  if (cola.length >= MAX_EN_COLA) {
    enviarEventosPendientes()
  } else if (!temporizador) {
    temporizador = setTimeout(enviarEventosPendientes, INTERVALO_ENVIO_MS)
  }
}

export function registrarVista(ruta) {
  const normalizada = normalizarRuta(ruta)
  // Evita contar dos veces la misma pantalla (recargas de estado, React StrictMode).
  const ahora = Date.now()
  if (ultimaVista.ruta === normalizada && ahora - ultimaVista.en < 2000) return
  ultimaVista = { ruta: normalizada, en: ahora }
  encolar({ tipo: 'vista', ruta: normalizada })
}

export function registrarLogin() {
  encolar({ tipo: 'login', ruta: '/login' })
  enviarEventosPendientes()
}

export function registrarError(mensaje, ruta) {
  const ahora = Date.now()
  erroresRecientes = erroresRecientes.filter((t) => ahora - t < 60000)
  if (erroresRecientes.length >= MAX_ERRORES_POR_MINUTO) return
  erroresRecientes.push(ahora)
  encolar({ tipo: 'error', ruta: normalizarRuta(ruta || window.location.pathname), detalle: String(mensaje || '').slice(0, 500) })
}

// Ingresos rechazados: no hay sesión, por eso va por una función que acepta
// llamadas anónimas (con tope por hora en la base). Nunca se manda la clave.
export async function registrarAccesoFallido(correo) {
  try {
    await supabase.rpc('registrar_acceso_fallido', { p_correo: correo || '', p_dispositivo: describirDispositivo() })
  } catch {
    // Igual que el resto: el monitor no puede afectar el login.
  }
}

// Errores no atrapados del navegador y envío al ocultar/cerrar la pestaña.
export function iniciarCapturaDeErrores() {
  window.addEventListener('error', (evento) => registrarError(evento.message))
  window.addEventListener('unhandledrejection', (evento) => registrarError(evento.reason?.message || evento.reason))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') enviarEventosPendientes()
  })
}
