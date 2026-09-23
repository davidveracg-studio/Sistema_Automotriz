import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Menu from './components/Menu'
import RutaProtegida from './components/RutaProtegida'
import Login from './pages/Login'
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
import TallerIslas from './pages/TallerIslas'
import Presupuestos from './pages/Presupuestos'
import PresupuestoDetalle from './pages/PresupuestoDetalle'
import OrdenEgreso from './pages/OrdenEgreso'
import CuentasPorCobrar from './pages/CuentasPorCobrar'
import PuntoVenta from './pages/PuntoVenta'
import Mensajes from './pages/Mensajes'

function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Menu />
      <main className="flex-1">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
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
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/encuesta/:token" element={<EncuestaPublica />} />
          <Route path="/cambiar-clave" element={paginaProtegida(<CambiarClave />)} />
          <Route path="/" element={paginaProtegida(<Inicio />)} />
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
            element={paginaProtegida(<TallerIslas />, ['admin', 'socia', 'jefe_taller'])}
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
            path="/trabajos/:id/egreso"
            element={paginaProtegida(<OrdenEgreso />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route
            path="/cuentas-por-cobrar"
            element={paginaProtegida(<CuentasPorCobrar />, ['admin', 'socia', 'encargado_presupuestos', 'jefe_taller', 'asesor'])}
          />
          <Route path="/informes" element={paginaProtegida(<Informes />, ['admin', 'socia'])} />
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
    </AuthProvider>
  )
}

export default App
