import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import MainLayout from './components/layout/MainLayout'

// IMPORTAR TUS COMPONENTES DESDE LA CARPETA pages
import Dashboard from './pages/Dashboard'
import ClientesLista from './pages/ClientesLista'
import ClienteForm from './pages/ClienteForm'
import ClientePerfil from './pages/ClientePerfil'
import PrestamosLista from './pages/PrestamosLista'
import PrestamoForm from './pages/PrestamoForm'
import MetodosPago from './pages/MetodosPago'
import HistorialActividad from './pages/HistorialActividad'

function App() {
  return (
    <>
      {/* Si NO está logueado, muestra el Login de Clerk */}
      <SignedOut>
        <div className="flex justify-center items-center min-h-screen bg-slate-100">
          <SignIn routing="hash" />
        </div>
      </SignedOut>

      {/* Si SÍ está logueado, muestra tu App con tu Layout original */}
      <SignedIn>
        <Router>
          <Routes>
            {/* MainLayout actúa como contenedor padre usando <Outlet /> */}
            <Route element={<MainLayout />}>
              {/* Las páginas hijas se renderizarán dentro de MainLayout */}
              <Route path="/" element={<Dashboard />} />
              
              {/* Rutas de Clientes */}
              <Route path="/clientes" element={<ClientesLista />} />
              <Route path="/clientes/crear" element={<ClienteForm />} />
              <Route path="/clientes/:id" element={<ClientePerfil />} />
              
              {/* Rutas de Préstamos */}
              <Route path="/prestamos" element={<PrestamosLista />} />
              <Route path="/prestamos/crear" element={<PrestamoForm />} />
              
              {/* Rutas de Métodos e Historial */}
              <Route path="/metodos-pago" element={<MetodosPago />} />
              <Route path="/historial" element={<HistorialActividad />} />
            </Route>
          </Routes>
        </Router>
      </SignedIn>
    </>
  )
}

export default App