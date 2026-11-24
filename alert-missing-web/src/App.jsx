import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './state/AuthContext.jsx';
import { Navbar } from './components/Navbar.jsx';
import { ModuloEmergencia } from './components/ModuloEmergencia.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { AlertasPage } from './pages/AlertasPage.jsx';
import { CrearAlertaPage } from './pages/CrearAlertaPage.jsx';
import { DetalleAlertaPage } from './pages/DetalleAlertaPage.jsx';
import { MisReportesPage } from './pages/MisReportesPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import {
  listarAvistamientosOffline,
  sincronizarAvistamientosOffline,
  suscribirSincronizacionAutomatica,
} from './offline/offlineDb.js';

function BarraConectividadOffline() {
  const [enLinea, setEnLinea] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendientes, setPendientes] = useState(0);
  const [mensajeSync, setMensajeSync] = useState('');
  const [sincronizando, setSincronizando] = useState(false);

  const actualizarConteo = async () => {
    try {
      const lista = await listarAvistamientosOffline();
      setPendientes(lista.length);
    } catch {
      setPendientes(0);
    }
  };

  useEffect(() => {
    actualizarConteo();

    const onOnline = () => setEnLinea(true);
    const onOffline = () => setEnLinea(false);
    const onColaActualizada = () => actualizarConteo();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('alert-missing:cola-actualizada', onColaActualizada);

    const desuscribirSync = suscribirSincronizacionAutomatica((resultado) => {
      setPendientes(resultado.pendientes);
      if (resultado.sincronizados > 0) {
        setMensajeSync(
          `Conexión recuperada: se enviaron automáticamente ${resultado.sincronizados} reporte(s) guardados sin conexión.`
        );
        window.dispatchEvent(
          new CustomEvent('alert-missing:sync-completada', { detail: resultado })
        );
      }
    });

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('alert-missing:cola-actualizada', onColaActualizada);
      desuscribirSync();
    };
  }, []);

  const sincronizarManual = async () => {
    setSincronizando(true);
    try {
      const resultado = await sincronizarAvistamientosOffline();
      setPendientes(resultado.pendientes);
      if (resultado.sincronizados > 0) {
        setMensajeSync(`Se sincronizaron ${resultado.sincronizados} reporte(s).`);
        window.dispatchEvent(
          new CustomEvent('alert-missing:sync-completada', { detail: resultado })
        );
      }
    } finally {
      setSincronizando(false);
    }
  };

  if (enLinea && pendientes === 0 && !mensajeSync) {
    return null;
  }

  return (
    <div
      className={`barra-offline ${
        enLinea && mensajeSync && pendientes === 0 ? 'barra-offline--sync' : ''
      }`}
      role="status"
    >
      <div className="barra-offline__inner">
        <span>
          {!enLinea
            ? `Sin conexión a internet. Los reportes se guardarán localmente${
                pendientes > 0 ? ` (${pendientes} pendiente(s))` : ''
              } y se enviarán al reconectar.`
            : pendientes > 0
              ? `Hay ${pendientes} reporte(s) de avistamiento pendientes por enviar.`
              : mensajeSync}
        </span>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {enLinea && pendientes > 0 && (
            <button
              type="button"
              className="btn btn--secundario btn--pequeno"
              disabled={sincronizando}
              onClick={sincronizarManual}
            >
              {sincronizando ? 'Sincronizando...' : 'Sincronizar ahora'}
            </button>
          )}
          {mensajeSync && pendientes === 0 && (
            <button
              type="button"
              className="btn btn--secundario btn--pequeno"
              onClick={() => setMensajeSync('')}
            >
              Ocultar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Navbar />
          <ModuloEmergencia />
          <BarraConectividadOffline />
          <main className="contenido-principal">
            <Routes>
              <Route path="/" element={<AlertasPage />} />
              <Route path="/alertas" element={<AlertasPage />} />
              <Route path="/alertas/:id" element={<DetalleAlertaPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route
                path="/mis-reportes"
                element={
                  <ProtectedRoute>
                    <MisReportesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <ProfilePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/alertas/nueva"
                element={
                  <ProtectedRoute>
                    <CrearAlertaPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <footer className="footer">
            Alert Missing Colombia · Ley 2326 (Alerta Rosa) · Ley 1581 (Hábeas Data)
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
