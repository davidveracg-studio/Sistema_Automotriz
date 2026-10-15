import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { GRUPOS, itemsVisibles } from '../lib/navegacion'
import { useNoLeidas } from '../lib/useNoLeidas'
import Icono from './Icono'

const CLAVE_CONTRAIDO = 'menuContraido'
const MOSTRAR_SUBAREAS_MS = 0
const OCULTAR_SUBAREAS_MS = 160

// El menú arranca contraído en pantallas angostas y expandido en las anchas,
// salvo que la persona ya haya elegido (se recuerda en este navegador).
function preferenciaInicial() {
  try {
    const guardado = localStorage.getItem(CLAVE_CONTRAIDO)
    if (guardado === '1') return true
    if (guardado === '0') return false
  } catch {
    // Sin localStorage se usa el ancho de la pantalla.
  }
  return window.innerWidth < 1024
}

function estaActivo(pathname, to) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function Insignia({ cantidad, className = '' }) {
  if (!cantidad) return null
  return (
    <span
      className={`inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold text-white ${className}`}
    >
      {cantidad > 99 ? '99+' : cantidad}
    </span>
  )
}

// Enlace del menú expandido.
function EnlaceExpandido({ to, label, icono, badge, noLeidas }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl py-2 pl-2.5 pr-3 text-sm font-medium transition-all ${
          isActive ? 'bg-gradient-to-r from-white/12 to-white/[0.02] text-white ring-1 ring-white/10' : 'text-sky/70 hover:bg-white/[0.06] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-brand-accent" />}
          <span
            className={`grid h-7 w-7 place-items-center rounded-lg transition-colors ${
              isActive ? 'bg-brand-accent text-white' : 'bg-white/5 text-sky/70 group-hover:text-white'
            }`}
          >
            <Icono nombre={icono} />
          </span>
          <span>{label}</span>
          {badge && <Insignia cantidad={noLeidas} className="ml-auto" />}
        </>
      )}
    </NavLink>
  )
}

// Un grupo en el menú contraído: un solo ícono; al pasar el cursor (o enfocarlo
// con el teclado) se despliegan sus subáreas en un panel flotante. El panel es
// `fixed` para no quedar recortado por el scroll interno del menú.
function GrupoContraido({ grupo, items, noLeidas }) {
  const { pathname } = useLocation()
  const [abierto, setAbierto] = useState(false)
  const [posicion, setPosicion] = useState({ top: 0, left: 0 })
  const contenedor = useRef(null)
  const temporizador = useRef(null)

  const activo = items.some((item) => estaActivo(pathname, item.to))

  useEffect(() => {
    setAbierto(false)
  }, [pathname])

  useEffect(() => () => clearTimeout(temporizador.current), [])

  function abrir() {
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => {
      const caja = contenedor.current?.getBoundingClientRect()
      if (caja) setPosicion({ top: caja.top, left: caja.right })
      setAbierto(true)
    }, MOSTRAR_SUBAREAS_MS)
  }

  function cerrarConRetraso() {
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => setAbierto(false), OCULTAR_SUBAREAS_MS)
  }

  const alturaEstimada = 48 + items.length * 40
  const arriba = Math.max(8, Math.min(posicion.top, window.innerHeight - alturaEstimada - 8))

  const aspecto = activo
    ? 'bg-gradient-to-b from-white/12 to-white/[0.02] text-white ring-1 ring-white/10'
    : 'text-sky/70 hover:bg-white/[0.06] hover:text-white'

  return (
    <div
      ref={contenedor}
      onMouseEnter={abrir}
      onMouseLeave={cerrarConRetraso}
      onFocus={abrir}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget)) cerrarConRetraso()
      }}
      onKeyDown={(evento) => {
        if (evento.key === 'Escape') setAbierto(false)
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={abierto}
        aria-label={grupo.titulo || grupo.etiquetaCorta}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        className={`relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium leading-none transition-colors ${aspecto}`}
      >
        {activo && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-brand-accent" />}
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${activo ? 'bg-brand-accent text-white' : 'bg-white/5'}`}>
          <Icono nombre={grupo.icono} className="h-5 w-5" />
        </span>
        <span>{grupo.etiquetaCorta}</span>
      </button>

      {abierto && (
        <div
          className="carbon-sidebar fixed z-50 w-56 rounded-r-xl rounded-bl-xl border border-white/10 p-2 shadow-2xl"
          style={{ top: arriba, left: posicion.left }}
          role="group"
          aria-label={grupo.titulo || grupo.etiquetaCorta}
        >
          {grupo.titulo && (
            <div className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky/45">{grupo.titulo}</div>
          )}
          <div className="space-y-0.5">
            {items.map((item) => (
              <EnlaceExpandido key={item.to} {...item} noLeidas={noLeidas} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Un grupo de un solo ítem (Inicio) no necesita panel: es un enlace directo.
function EnlaceContraido({ grupo, item, noLeidas }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      aria-label={item.label}
      className={({ isActive }) =>
        `relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-medium leading-none transition-colors ${
          isActive ? 'bg-gradient-to-b from-white/12 to-white/[0.02] text-white ring-1 ring-white/10' : 'text-sky/70 hover:bg-white/[0.06] hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-brand-accent" />}
          <span className={`relative grid h-8 w-8 place-items-center rounded-lg ${isActive ? 'bg-brand-accent text-white' : 'bg-white/5'}`}>
            <Icono nombre={item.icono} className="h-5 w-5" />
            {item.badge && <Insignia cantidad={noLeidas} className="absolute -right-2 -top-1.5 !h-4 !min-w-[16px] !text-[9px]" />}
          </span>
          <span>{grupo.etiquetaCorta}</span>
        </>
      )}
    </NavLink>
  )
}

// Vive fuera del ErrorBoundary de cada página: si el contenido revienta,
// el menú debe seguir funcionando.
function Menu() {
  const { usuario } = useAuth()
  const noLeidas = useNoLeidas()
  const [contraido, setContraido] = useState(preferenciaInicial)

  function alternar() {
    const siguiente = !contraido
    setContraido(siguiente)
    try {
      localStorage.setItem(CLAVE_CONTRAIDO, siguiente ? '1' : '0')
    } catch {
      // Sin localStorage la elección dura solo esta visita.
    }
  }

  const gruposVisibles = GRUPOS.map((grupo) => ({ grupo, items: itemsVisibles(grupo, usuario?.rol) })).filter(({ items }) => items.length > 0)

  return (
    <nav
      aria-label="Menú principal"
      className={`carbon-sidebar sticky top-0 flex h-screen shrink-0 flex-col self-start text-white transition-[width] duration-200 print:hidden ${contraido ? 'w-[76px]' : 'w-64'}`}
    >
      <div className={`flex items-center border-b border-white/10 py-5 ${contraido ? 'justify-center px-2' : 'gap-3 px-5'}`}>
        {/* El logo del panel es SIEMPRE el mismo archivo del favicon (index.html),
            no empresas.logo_url: ese campo puede traer otro diseño (por ejemplo el
            logo con el nombre) y el panel debe mostrar el ícono de la marca VPAI.
            Gira 90° al contraer el menú (dextrogiro) y vuelve girando al revés
            (levogiro) al expandirlo: es la misma transición CSS interpolando el
            ángulo entre 0 y 90, solo cambia el sentido según hacia dónde va. */}
        <img
          src="/logo-vpai-icono.png"
          alt={usuario?.empresas?.nombre || 'VPAI'}
          className={`h-11 w-11 shrink-0 object-contain transition-transform duration-500 ease-in-out ${contraido ? 'rotate-90' : 'rotate-0'}`}
        />

        {!contraido && (
          <div className="min-w-0">
            <div className="truncate text-base font-bold leading-none tracking-tight">{usuario?.empresas?.nombre || 'CRM'}</div>
            <div className="mt-1 text-[11px] text-sky/60">Gestión del taller</div>
          </div>
        )}
      </div>

      {contraido ? (
        <div className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {gruposVisibles.map(({ grupo, items }) =>
            items.length === 1 ? (
              <EnlaceContraido key={grupo.clave} grupo={grupo} item={items[0]} noLeidas={noLeidas} />
            ) : (
              <GrupoContraido key={grupo.clave} grupo={grupo} items={items} noLeidas={noLeidas} />
            )
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {gruposVisibles.map(({ grupo, items }) => (
            <div key={grupo.clave} className="space-y-1">
              {grupo.titulo && (
                <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky/35">{grupo.titulo}</div>
              )}
              {items.map((item) => (
                <EnlaceExpandido key={item.to} {...item} noLeidas={noLeidas} />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={alternar}
          aria-label={contraido ? 'Expandir el menú' : 'Contraer el menú'}
          aria-expanded={!contraido}
          className={`flex w-full items-center rounded-lg py-2 text-sm text-sky/70 transition-colors hover:bg-white/5 hover:text-white ${
            contraido ? 'justify-center' : 'gap-3 px-3'
          }`}
        >
          <Icono nombre={contraido ? 'flechaDer' : 'flechaIzq'} />
          {!contraido && <span>Contraer menú</span>}
        </button>
      </div>
    </nav>
  )
}

export default Menu
