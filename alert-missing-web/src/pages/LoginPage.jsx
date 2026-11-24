import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.jsx';

function GoogleIconSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { isAuthenticated, loading, user, authError, signInWithGoogle, clearAuthError } = useAuth();
  const location = useLocation();
  const [redirigiendo, setRedirigiendo] = useState(false);
  const [errorLocal, setErrorLocal] = useState('');

  const rutaOrigen = location.state?.from?.pathname || '/';
  const errorEstado = location.state?.error || '';

  // Redirección automática si ya existe sesión autenticada
  if (!loading && isAuthenticated) {
    const destino = user && !user.perfilCompleto ? '/profile' : rutaOrigen;
    return <Navigate to={destino} replace />;
  }

  const manejarGoogle = async () => {
    setErrorLocal('');
    clearAuthError();
    setRedirigiendo(true);
    try {
      await signInWithGoogle(rutaOrigen);
    } catch (err) {
      setErrorLocal(err.message || 'No se pudo conectar con Google. Intenta nuevamente.');
      setRedirigiendo(false);
    }
  };

  const mensajeError = errorLocal || authError || errorEstado;

  return (
    <div className="auth-page">
      <section className="auth-card" aria-labelledby="login-titulo">
        <div className="auth-card__cabecera">
          <span className="auth-card__insignia">Alert Missing Colombia</span>
          <h1 id="login-titulo" className="auth-card__titulo">
            Iniciar sesión
          </h1>
          <p className="auth-card__subtitulo">
            Accede con tu cuenta de Google para crear fichas de búsqueda, activar la Alerta Rosa
            (Ley 2326) y moderar avistamientos.
          </p>
        </div>

        {location.state?.from && (
          <div className="aviso aviso--info">
            Inicia sesión para continuar a <strong>{rutaOrigen}</strong>.
          </div>
        )}

        {mensajeError && (
          <div className="aviso aviso--error" role="alert">
            {mensajeError}
          </div>
        )}

        <button
          type="button"
          className="btn-google"
          onClick={manejarGoogle}
          disabled={loading || redirigiendo}
        >
          <GoogleIconSvg />
          <span>
            {redirigiendo
              ? 'Redirigiendo a Google...'
              : loading
                ? 'Verificando sesión...'
                : 'Continuar con Google'}
          </span>
        </button>

        <ul className="auth-beneficios">
          <li>
            <span className="auth-beneficios__punto" aria-hidden="true">
              ✓
            </span>
            <span>
              Autenticación segura vía Google OAuth y sincronización cifrada con Alert Missing API.
            </span>
          </li>
          <li>
            <span className="auth-beneficios__punto" aria-hidden="true">
              ✓
            </span>
            <span>
              Protección de datos personales conforme a la <strong>Ley 1581 de 2012 (Hábeas Data)</strong>.
            </span>
          </li>
          <li>
            <span className="auth-beneficios__punto" aria-hidden="true">
              ✓
            </span>
            <span>
              Puedes consultar alertas activas desde{' '}
              <Link to="/">el listado público</Link>; para crear fichas o reportar avistamientos es
              obligatorio iniciar sesión.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
