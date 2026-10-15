// Navegación compartida por el menú lateral y el buscador global: una sola
// lista de secciones, con los mismos roles por ruta que App.jsx
// (rolesPermitidos de cada <Route>). null = abierto a cualquiera con sesión.
// Se duplica a propósito: esto solo decide qué accesos se muestran;
// RutaProtegida sigue siendo la única que de verdad bloquea la navegación.

export const ETIQUETAS_ROL = {
  socia: 'Socia',
  admin: 'Administrador',
  asesor: 'Asesor',
  jefe_taller: 'Jefe de taller',
  encargado_presupuestos: 'Encargado de presupuestos',
  tecnico: 'Técnico',
  detailer: 'Detailer',
  recepcionista: 'Recepcionista',
}

// Trazos de ícono (viewBox 24x24, estilo heroicons-outline) — sin librería externa.
export const ICONOS = {
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
  turnos: 'M12 8v4l2.5 2.5M12 3a9 9 0 100 18 9 9 0 000-18z',
  facturacion:
    'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  // Barra superior y controles.
  buscar: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
  campana:
    'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  luna: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
  sol: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
  flechaIzq: 'M15 19l-7-7 7-7',
  flechaDer: 'M9 5l7 7-7 7',
  flechaAbajo: 'M19 9l-7 7-7-7',
  salir: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  persona: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  correo: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  mas: 'M12 4v16m8-8H4',
}

// Secciones del menú. Cada grupo tiene, además del título, el ícono y la
// etiqueta corta que se usan cuando el menú está contraído a solo íconos.
export const GRUPOS = [
  {
    clave: 'principal',
    titulo: null,
    icono: 'inicio',
    etiquetaCorta: 'Inicio',
    items: [{ to: '/', label: 'Inicio', icono: 'inicio', roles: null, badge: true }],
  },
  {
    clave: 'recepcion',
    titulo: 'Recepción y taller',
    icono: 'taller',
    etiquetaCorta: 'Recepción',
    items: [
      { to: '/agenda', label: 'Agenda', icono: 'calendario', roles: null },
      { to: '/mensajes', label: 'Mensajes', icono: 'mensajes', roles: ['admin', 'socia', 'asesor', 'recepcionista', 'jefe_taller'] },
      { to: '/ingresos/nuevo', label: 'Nuevo ingreso', icono: 'nuevoIngreso', roles: null },
      { to: '/trabajos', label: 'Trabajos', icono: 'trabajos', roles: null },
      { to: '/taller', label: 'Taller', icono: 'taller', roles: ['admin', 'socia', 'jefe_taller'] },
    ],
  },
  {
    clave: 'comercial',
    titulo: 'Comercial',
    icono: 'clientes',
    etiquetaCorta: 'Comercial',
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
    clave: 'gestion',
    titulo: 'Gestión',
    icono: 'informes',
    etiquetaCorta: 'Gestión',
    items: [
      {
        to: '/facturacion',
        label: 'Facturación',
        icono: 'facturacion',
        roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'],
      },
      { to: '/bodega', label: 'Bodega', icono: 'bodega', roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller'] },
      { to: '/informes', label: 'Informes', icono: 'informes', roles: ['admin', 'socia'] },
      { to: '/turnos', label: 'Turnos y asistencia', icono: 'turnos', roles: ['admin', 'socia', 'jefe_taller'] },
    ],
  },
]

// Reportes y vistas puntuales que el buscador global ofrece además de las
// pantallas. Cada uno lleva a la pantalla donde vive; `palabras` son sinónimos
// para que "vencidas" encuentre "Cuentas por cobrar", etc.
export const REPORTES = [
  { label: 'Informe: clientes que vuelven', to: '/informes', icono: 'informes', roles: ['admin', 'socia'], palabras: 'retorno fidelidad recurrentes' },
  { label: 'Informe: captura de datos (RUT y kilometraje)', to: '/informes', icono: 'informes', roles: ['admin', 'socia'], palabras: 'rut kilometraje calidad' },
  { label: 'Informe: presupuestos por decisión', to: '/informes', icono: 'informes', roles: ['admin', 'socia'], palabras: 'aceptado rechazado postergado' },
  { label: 'Informe: retrabajos por técnico', to: '/informes', icono: 'informes', roles: ['admin', 'socia'], palabras: 'garantia reclamos repeticion' },
  {
    label: 'Facturas vencidas',
    to: '/cuentas-por-cobrar',
    icono: 'cuentasPorCobrar',
    roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'],
    palabras: 'deuda cobranza morosos pendientes de pago',
  },
  {
    label: 'Stock bajo el mínimo',
    to: '/bodega',
    icono: 'bodega',
    roles: ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller'],
    palabras: 'inventario repuestos reponer proveedores',
  },
  { label: 'Encuestas negativas por revisar', to: '/encuestas', icono: 'encuestas', roles: null, palabras: 'reclamos satisfaccion calificaciones' },
  { label: 'Citas del día', to: '/agenda', icono: 'calendario', roles: null, palabras: 'horas agendadas calendario hoy' },
  { label: 'Oportunidades postergadas', to: '/oportunidades', icono: 'oportunidades', roles: null, palabras: 'ventas pendientes recontactar' },
  {
    label: 'Plano del taller en vivo',
    to: '/taller',
    icono: 'taller',
    roles: ['admin', 'socia', 'jefe_taller'],
    palabras: 'puestos elevadores islas vehiculos ocupacion',
  },
  { label: 'Mi perfil', to: '/perfil', icono: 'persona', roles: null, palabras: 'cuenta contraseña nombre editar' },
  {
    label: 'Jornadas extraordinarias del mes',
    to: '/turnos',
    icono: 'turnos',
    roles: ['admin', 'socia', 'jefe_taller'],
    palabras: 'turnos asistencia reloj control horas extra rotacion',
  },
]

export function itemsVisibles(grupo, rol) {
  return grupo.items.filter((item) => !item.roles || item.roles.includes(rol))
}

// Minúsculas y sin tildes, para que "cotizacion" encuentre "Cotización".
export function normalizarTexto(valor) {
  return (valor || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}
