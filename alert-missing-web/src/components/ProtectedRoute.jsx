import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.jsx';

export function ProtectedRoute({ children, requiredRole = null }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-spinner-wrap" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p style={{ margin: 0, color: 'var(--color-texto-secundario)' }}>
              Verificando tu sesión de acceso...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user?.rol !== requiredRole) {
    return (
      <div className="contenedor">
        <div className="aviso aviso--error" role="alert">
          No tienes los permisos necesarios ({requiredRole}) para acceder a esta sección.
        </div>
      </div>
    );
  }

  return children;
}
