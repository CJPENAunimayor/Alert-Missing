import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.jsx';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const manejarSalir = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="navbar__marca">
          <span className="navbar__icono" aria-hidden="true">
            AM
          </span>
          <span>Alert Missing</span>
          <span className="navbar__etiqueta">CO</span>
        </Link>

        <nav className="navbar__enlaces" aria-label="Navegación principal">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `navbar__link ${isActive ? 'navbar__link--activo' : ''}`
            }
          >
            Alertas
          </NavLink>

          {isAuthenticated && (
            <NavLink
              to="/mis-reportes"
              className={({ isActive }) =>
                `navbar__link ${isActive ? 'navbar__link--activo' : ''}`
              }
            >
              Mis Reportes
            </NavLink>
          )}

          <NavLink
            to="/alertas/nueva"
            className={({ isActive }) =>
              `navbar__link navbar__link--cta ${isActive ? 'navbar__link--activo' : ''}`
            }
          >
            + Reportar
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  `navbar__link ${isActive ? 'navbar__link--activo' : ''}`
                }
                title={user?.correo || ''}
              >
                {user?.nombreCompleto?.split(' ')[0] || 'Mi Perfil'}
              </NavLink>
              <button type="button" className="navbar__salir" onClick={manejarSalir}>
                Salir
              </button>
            </>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `navbar__link ${isActive ? 'navbar__link--activo' : ''}`
              }
            >
              Iniciar sesión
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
