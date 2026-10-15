import { useEffect } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { registrarVista } from './lib/uso'
import { TemaProvider, useTema } from './lib/tema'
import ErrorBoundary from './components/ErrorBoundary'
import Menu from './components/Menu'
import BarraSuperior from './components/BarraSuperior'
import ModalCorreosDemo from './components/ModalCorreosDemo'
import RutaProtegida from './components/RutaProtegida'
import LoginDemo from './pages/LoginDemo'
import CambiarClave from './pages/CambiarClave'
import Inicio from './pages/Inicio'
import Clientes from './pages/Clientes'
import ClienteDetalle from './pages/ClienteDetalle'
import NuevoIngreso from './pages/NuevoIngreso'
import Trabajos from './pages/Trabajos'
import TrabajoDetalle from './pages/TrabajoDetalle'
import RadarSesion from './pages/RadarSesion'
import Oportunidades from './pages/Oportunidades'
import Encuestas from './pages/Encuestas'
import EncuestaPublica from './pages/EncuestaPublica'
import Agenda from './pages/Agenda'
import Informes from './pages/Informes'
import Bodega from './pages/Bodega'
import Turnos from './pages/Turnos'
import Taller from './pages/Taller'
import Presupuestos from './pages/Presupuestos'
import PresupuestoDetalle from './pages/PresupuestoDetalle'
import OrdenEgreso from './pages/OrdenEgreso'
import OrdenIngreso from './pages/OrdenIngreso'
import CuentasPorCobrar from './pages/CuentasPorCobrar'
import PuntoVenta from './pages/PuntoVenta'
import Mensajes from './pages/Mensajes'
import Perfil from './pages/Perfil'
import Facturacion from './pages/Facturacion'
import FacturacionDetalle from './pages/FacturacionDetalle'

function Layout({ children }) {
  const { tema } = useTema()
  const oscuro = tema === 'oscuro'
  const { usuario } = useAuth()
  const { pathname } = useLocation()

  // Monitor de plataforma: una vista por pantalla visitada (solo con cuenta activa).
  useEffect(() => {
    if (usuario?.activo) registrarVista(pathname)
  }, [usuario?.activo, pathname])

  // La clase "dark" vive solo en esta envoltura: el login y la encuesta pública
  // quedan siempre con su aspecto de siempre.
  return (
    <div className={oscuro ? 'dark' : ''} style={{ colorScheme: oscuro ? 'dark' : 'light' }}>
      <div className="flex min-h-screen bg-slate-50">
        <Menu />
        <div className="flex min-w-0 flex-1 flex-col">
          <BarraSuperior />
          <main className="min-w-0 flex-1">
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
        <ModalCorreosDemo />
      </div>
    </div>
  )
}

function paginaProtegida(elemento, rolesPermitidos) {
  return (
    <Layout>
      <RutaProtegida rolesPermitidos={rolesPermitidos}>{elemento}</RutaProtegida>
    </Layout>
  )
}

function App() {
  return (
    <AuthProvider>
      <TemaProvider>
      <BrowserRouter>
        <Routes>
          {/* Esta versión es solo demo: el único login es el selector de rol. */}
          <Route path="/login" element={<LoginDemo />} />
          <Route path="/demo" element={<Navigate to="/login" replace />} />
          <Route path="/encuesta/:token" element={<EncuestaPublica />} />
          <Route path="/cambiar-clave" element={paginaProtegida(<CambiarClave />)} />
          <Route path="/" element={paginaProtegida(<Inicio />)} />
          <Route path="/perfil" element={paginaProtegida(<Perfil />)} />
          <Route path="/clientes" element={paginaProtegida(<Clientes />)} />
          <Route path="/clientes/:id" element={paginaProtegida(<ClienteDetalle />)} />
          <Route path="/ingresos/nuevo" element={paginaProtegida(<NuevoIngreso />)} />
          <Route path="/trabajos" element={paginaProtegida(<Trabajos />)} />
          <Route path="/trabajos/:id" element={paginaProtegida(<TrabajoDetalle />)} />
          <Route path="/trabajos/:id/radar" element={paginaProtegida(<RadarSesion />)} />
          <Route path="/oportunidades" element={paginaProtegida(<Oportunidades />)} />
          <Route path="/encuestas" element={paginaProtegida(<Encuestas />)} />
          <Route path="/agenda" element={paginaProtegida(<Agenda />)} />
          <Route
            path="/mensajes"
            element={paginaProtegida(<Mensajes />, ['admin', 'socia', 'asesor', 'recepcionista', 'jefe_taller'])}
          />
          <Route
            path="/taller"
            element={paginaProtegida(<Taller />, ['admin', 'socia', 'jefe_taller'])}
          />
          <Route
            path="/presupuestos"
            element={paginaProtegida(<Presupuestos />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route
            path="/presupuestos/:id"
            element={paginaProtegida(<PresupuestoDetalle />, [
              'admin',
              'socia',
              'encargado_presupuestos',
              'jefe_taller',
              'asesor',
            ])}
          />
          <Route
            path="/trabajos/:id/ingreso"
            element={paginaProtegida(<OrdenIngreso />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor', 'recepcionista'])}
          />
          <Route
            path="/trabajos/:id/egreso"
            element={paginaProtegida(<OrdenEgreso />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route
            path="/cuentas-por-cobrar"
            element={paginaProtegida(<CuentasPorCobrar />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route
            path="/facturacion"
            element={paginaProtegida(<Facturacion />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route
            path="/facturacion/:id"
            element={paginaProtegida(<FacturacionDetalle />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route path="/informes" element={paginaProtegida(<Informes />, ['admin', 'socia'])} />
          <Route path="/turnos" element={paginaProtegida(<Turnos />, ['admin', 'socia', 'jefe_taller'])} />
          <Route
            path="/bodega"
            element={paginaProtegida(<Bodega />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller'])}
          />
          <Route
            path="/punto-de-venta"
            element={paginaProtegida(<PuntoVenta />, ['admin', 'socia', 'asesor', 'recepcionista'])}
          />
        </Routes>
      </BrowserRouter>
      </TemaProvider>
    </AuthProvider>
  )
}

export default App
