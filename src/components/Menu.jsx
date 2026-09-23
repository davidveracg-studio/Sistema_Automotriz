import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../supabaseClient'

const ETIQUETAS_ROL = {
  socia: 'Socia',
  admin: 'Administrador',
  asesor: 'Asesor',
  jefe_taller: 'Jefe de taller',
  encargado_presupuestos: 'Encargado de presupuestos',
  tecnico: 'Técnico',
  detailer: 'Detailer',
  recepcionista: 'Recepcionista',
}

// Trazos de ícono (viewBox 24x24, estilo heroicons-outline) — sin librería
// externa, mismo criterio que el prototipo del que se tomó este panel.
const ICONOS = {
  inicio: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  calendario: 'M8 7V3m8 4V3M4 11h16M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  mensajes:
    'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  nuevoIngreso: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M12 11v6m-3-3h6',
  trabajos: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  taller: 'M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.4 2.4-2.3-2.3 2.7-2.1z',
  clientes: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1',
  oportunidades: 'M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v7h-4z',
  presupuestos: 'M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z',
  cuentasPorCobrar:
    'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  puntoVenta:
    'M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 1.994-4.706 2.622-7.201a.75.75 0 00-.736-.949H5.106M7.5 14.25L5.106 5.25M7.5 14.25L6.75 15M13.5 18.75a.75.75 0 100 1.5.75.75 0 000-1.5zm-6 0a.75.75 0 100 1.5.75.75 0 000-1.5z',
  encuestas:
    'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.98 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z',
  bodega:
    'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
  informes: 'M4 19V5m0 14h16M8 17V9m4 8V6m4 11v-5',
}

// Mismos roles por ruta que App.jsx (rolesPermitidos de cada <Route>) —
// null = abierto a cualquiera con sesión. Se duplica acá a propósito, igual
// que hacía el prototipo original: el menú es solo una lista de accesos,
// RutaProtegida sigue siendo la única que de verdad bloquea la navegación.
const GRUPOS = [
  {
    titulo: null,
    items: [{ to: '/', label: 'Inicio', icono: 'inicio', roles: null, badge: true }],
  },
  {
    titulo: 'Recepción y taller',
    items: [
      { to: '/agenda', label: 'Agenda', icono: 'calendario', roles: null },
      { to: '/mensajes', label: 'Mensajes', icono: 'mensajes', roles: ['admin', 'socia', 'asesor', 'recepcionista', 'jefe_taller'] },
      { to: '/ingresos/nuevo', label: 'Nuevo ingreso', icono: 'nuevoIngreso', roles: null },
      { to: '/trabajos', label: 'Trabajos', icono: 'trabajos', roles: null },
      { to: '/taller', label: 'Taller por islas', icono: 'taller', roles: ['admin', 'socia', 'jefe_taller'] },
    ],
  },
  {
    titulo: 'Comercial',
    items: [
      { to: '/clientes', label: 'Clientes', icono: 'clientes', roles: null },
      { to: '/oportunidades', label: 'Oportunidades', icono: 'oportunidades', roles: null },
      {
        to: '/presupuestos',
        label: 'Presupuestos',
        icono: 'presupuestos',
        roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'],
      },
      {
        to: '/cuentas-por-cobrar',
        label: 'Cuentas por cobrar',
        icono: 'cuentasPorCobrar',
        roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'],
      },
      { to: '/punto-de-venta', label: 'Punto de venta', icono: 'puntoVenta', roles: ['admin', 'socia', 'asesor', 'recepcionista'] },
      { to: '/encuestas', label: 'Encuestas', icono: 'encuestas', roles: null },
    ],
  },
  {
    titulo: 'Gestión',
    items: [
      { to: '/bodega', label: 'Bodega', icono: 'bodega', roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller'] },
      { to: '/informes', label: 'Informes', icono: 'informes', roles: ['admin', 'socia'] },
    ],
  },
]

function Icono({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      <path d={d} />
    </svg>
  )
}

// Vive fuera del ErrorBoundary de cada página: si el contenido revienta,
// el menú (y el botón de cerrar sesión) debe seguir funcionando.
function Menu() {
  const { usuario, cerrarSesion } = useAuth()
  const [noLeidas, setNoLeidas] = useState(0)

  useEffect(() => {
    if (!usuario) return undefined
    let activo = true
    async function cargarNoLeidas() {
      try {
        const [{ data: notifs }, { data: lecturas }] = await Promise.all([
          supabase.from('notificaciones').select('id'),
          supabase.from('notificaciones_lecturas').select('notificacion_id').eq('usuario_id', usuario.id),
        ])
        if (!activo) return
        const leidas = new Set((lecturas || []).map((l) => l.notificacion_id))
        setNoLeidas((notifs || []).filter((n) => !leidas.has(n.id)).length)
      } catch {
        // El contador de la campanita es una comodidad visual, no crítico:
        // si falla la consulta, se deja en 0 en vez de romper el menú.
      }
    }
    cargarNoLeidas()
    return () => {
      activo = false
    }
  }, [usuario])

  const item = ({ to, label, icono, badge }) => (
    <NavLink
      key={to}
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
            <Icono d={ICONOS[icono]} />
          </span>
          <span>{label}</span>
          {badge && noLeidas > 0 && (
            <span className="ml-auto inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-brand-accent px-1 text-[10px] font-bold text-white">
              {noLeidas}
            </span>
          )}
        </>
      )}
    </NavLink>
  )

  const grupo = (g) => {
    const items = g.items.filter((it) => !it.roles || it.roles.includes(usuario?.rol))
    if (!items.length) return null
    return (
      <div key={g.titulo || 'principal'} className="space-y-1">
        {g.titulo && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky/35">{g.titulo}</div>}
        {items.map(item)}
      </div>
    )
  }

  return (
    <nav className="carbon-sidebar flex w-64 shrink-0 flex-col text-white print:hidden">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        {usuario?.empresas?.logo_url ? (
          <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white">
            <img src={usuario.empresas.logo_url} alt={usuario.empresas.nombre} className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-accent font-bold text-white">
            {(usuario?.empresas?.nombre || 'D').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-base font-bold leading-none tracking-tight">{usuario?.empresas?.nombre || 'CRM'}</div>
          <div className="mt-1 text-[11px] text-sky/60">Gestión del taller</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">{GRUPOS.map(grupo)}</div>

      {usuario && (
        <div className="border-t border-white/10 px-3 py-3">
          <div className="mb-2 flex items-center gap-3 px-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm font-semibold">
              {(usuario.nombre_completo || usuario.correo || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{usuario.nombre_completo || usuario.correo}</p>
              <p className="text-xs text-sky/55">{ETIQUETAS_ROL[usuario.rol] ?? usuario.rol}</p>
            </div>
          </div>
          <button type="button" onClick={cerrarSesion} className="w-full rounded-lg px-3 py-2 text-left text-sm text-sky/75 transition-colors hover:bg-white/5 hover:text-white">
            Cerrar sesión
          </button>
        </div>
      )}
    </nav>
  )
}

export default Menu
