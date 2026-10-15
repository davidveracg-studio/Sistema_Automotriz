import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ETIQUETAS_ROL } from '../lib/navegacion'
import { pedirCorreosDemo } from '../lib/correosDemo'
import { useNoLeidas } from '../lib/useNoLeidas'
import { useTema } from '../lib/tema'
import { supabase } from '../supabaseClient'
import { CORREO_DEMO_POR_ROL, ETIQUETAS_ROL_DEMO, cambiarRolDemo } from '../lib/demo'
import BuscadorGlobal from './BuscadorGlobal'
import Icono from './Icono'

const ROLES_DEMO = Object.keys(CORREO_DEMO_POR_ROL)

const BOTON_ICONO =
  'relative grid h-9 w-9 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-deep'

// Menú "Mi cuenta": datos de quien inició sesión, editar perfil y cerrar sesión.
function MenuCuenta() {
  const { usuario, cerrarSesion } = useAuth()
  const [abierto, setAbierto] = useState(false)
  const [cambiandoRol, setCambiandoRol] = useState(false)
  const [errorRol, setErrorRol] = useState(null)
  const contenedor = useRef(null)

  async function manejarCambioRol(evento) {
    const nuevoRol = evento.target.value
    if (nuevoRol === usuario.rol) return
    setCambiandoRol(true)
    setErrorRol(null)
    try {
      await cambiarRolDemo(supabase, nuevoRol)
      // Éxito: el cambio de sesión hace que AuthContext recargue el usuario
      // y este menú se vuelva a montar con el rol nuevo.
    } catch {
      setCambiandoRol(false)
      setErrorRol('No se pudo cambiar de rol. Intenta de nuevo.')
    }
  }

  useEffect(() => {
    if (!abierto) return undefined
    function alPulsar(evento) {
      if (contenedor.current && !contenedor.current.contains(evento.target)) setAbierto(false)
    }
    function alTeclear(evento) {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alPulsar)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alPulsar)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  if (!usuario) return null

  const nombre = usuario.nombre_completo || usuario.correo
  const opcion =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100'

  return (
    <div ref={contenedor} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((valor) => !valor)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-deep"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-deep text-sm font-semibold text-white">
          {nombre.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium text-slate-800">{nombre}</span>
          <span className="block text-[11px] text-slate-500">{ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}</span>
        </span>
        <Icono nombre="flechaAbajo" className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>

      {abierto && (
        <div
          role="menu"
          aria-label="Mi cuenta"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
        >
          <div className="border-b border-slate-100 px-3 pb-3 pt-2">
            <p className="truncate text-sm font-semibold text-slate-900">{nombre}</p>
            <p className="truncate text-xs text-slate-500">{usuario.correo}</p>
            <p className="mt-1 text-xs text-slate-500">
              {ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}
              {usuario.empresas?.nombre ? ` · ${usuario.empresas.nombre}` : ''}
            </p>
          </div>
          <div className="pt-1.5">
            <Link to="/perfil" role="menuitem" onClick={() => setAbierto(false)} className={opcion}>
              <Icono nombre="persona" />
              Editar perfil
            </Link>
            {usuario.empresas?.es_demo && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAbierto(false)
                  pedirCorreosDemo()
                }}
                className={opcion}
              >
                <Icono nombre="correo" />
                Correos de prueba
              </button>
            )}
            {usuario.empresas?.es_demo && (
              <div className="px-3 py-2">
                <label className="label" htmlFor="cambiar-rol-demo">
                  Cambiar de rol
                </label>
                <select
                  id="cambiar-rol-demo"
                  className="input"
                  value={usuario.rol}
                  disabled={cambiandoRol}
                  onChange={manejarCambioRol}
                >
                  {!ROLES_DEMO.includes(usuario.rol) && (
                    <option value={usuario.rol}>{ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}</option>
                  )}
                  {ROLES_DEMO.map((r) => (
                    <option key={r} value={r}>
                      {ETIQUETAS_ROL_DEMO[r] ?? ETIQUETAS_ROL[r]}
                    </option>
                  ))}
                </select>
                {cambiandoRol && <p className="mt-1 text-xs text-slate-400">Cambiando de rol…</p>}
                {errorRol && <p className="mt-1 text-xs text-red-600">{errorRol}</p>}
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={cerrarSesion}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              <Icono nombre="salir" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Vive fuera del ErrorBoundary de cada página, igual que el menú lateral: si el
// contenido revienta, el buscador y "Cerrar sesión" siguen a mano.
function BarraSuperior() {
  const noLeidas = useNoLeidas()
  const { tema, alternar } = useTema()
  const oscuro = tema === 'oscuro'

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 print:hidden">
      <BuscadorGlobal />

      <div className="ml-auto flex items-center gap-1">
        <Link to="/ingresos/nuevo" className="btn-primary mr-2 hidden whitespace-nowrap lg:inline-flex">
          <Icono nombre="mas" className="h-4 w-4" />
          Nuevo ingreso
        </Link>

        <Link
          to="/"
          aria-label={noLeidas > 0 ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones'}
          title="Notificaciones"
          className={BOTON_ICONO}
        >
          <Icono nombre="campana" className="h-5 w-5" />
          {noLeidas > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold text-white">
              {noLeidas > 99 ? '99+' : noLeidas}
            </span>
          )}
        </Link>

        <button
          type="button"
          onClick={alternar}
          aria-pressed={oscuro}
          aria-label={oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno'}
          title={oscuro ? 'Modo claro' : 'Modo nocturno'}
          className={BOTON_ICONO}
        >
          <Icono nombre={oscuro ? 'sol' : 'luna'} className="h-5 w-5" />
        </button>

        <MenuCuenta />
      </div>
    </header>
  )
}

export default BarraSuperior
