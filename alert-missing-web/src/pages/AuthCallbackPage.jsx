import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { consumirRutaRetorno } from '../api-client/httpClient.js';
import { supabase } from '../api-client/supabaseClient.js';
import { useAuth } from '../state/AuthContext.jsx';

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { syncGoogleSession } = useAuth();
  const [estado, setEstado] = useState('Procesando autenticación con Google...');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelado = false;

    async function procesarCallback() {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const oauthError =
        params.get('error_description') ||
        params.get('error') ||
        hashParams.get('error_description') ||
        hashParams.get('error');

      if (oauthError) {
        if (!cancelado) {
          setError(`Google canceló o rechazó el inicio de sesión: ${oauthError}`);
        }
        return;
      }

      if (!supabase) {
        if (!cancelado) {
          setError('Supabase no está configurado en el frontend (.env).');
        }
        return;
      }

      try {
        setEstado('Validando sesión con Supabase...');

        // Recuperar la sesión OAuth recién procesada desde la URL (PKCE o implicit hash)
        let { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw new Error(sessionError.message);
        }

        let sesion = data?.session || null;

        // Si el intercambio PKCE tarda unos milisegundos, esperar el evento SIGNED_IN
        if (!sesion) {
          sesion = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              subscription?.unsubscribe();
              reject(new Error('Tiempo de espera agotado al recibir la sesión de Google.'));
            }, 8000);

            const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
              if (
                (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
                newSession?.access_token
              ) {
                clearTimeout(timeout);
                listener.subscription.unsubscribe();
                resolve(newSession);
              }
            });
            const subscription = listener?.subscription;
          });
        }

        if (cancelado) return;

        setEstado('Sincronizando tu perfil con Alert Missing...');
        const resultado = await syncGoogleSession(sesion);

        if (cancelado || !resultado) return;

        const rutaRetorno = consumirRutaRetorno('/');
        if (!resultado.usuario?.perfilCompleto) {
          navigate('/profile', {
            replace: true,
            state: {
              recienRegistrado: true,
              siguienteRuta: rutaRetorno,
            },
          });
        } else {
          navigate(rutaRetorno, { replace: true });
        }
      } catch (err) {
        if (!cancelado) {
          setError(
            err.message ||
              'No fue posible completar el inicio de sesión con Google. Intenta de nuevo.'
          );
        }
      }
    }

    procesarCallback();
    return () => {
      cancelado = true;
    };
  }, [navigate, syncGoogleSession]);

  return (
    <div className="auth-page">
      <section className="auth-card" aria-live="polite">
        {error ? (
          <div>
            <h1 className="auth-card__titulo" style={{ fontSize: 'var(--tam-xl)', marginBottom: 'var(--esp-3)' }}>
              No se pudo iniciar sesión
            </h1>
            <div className="aviso aviso--error" role="alert">
              {error}
            </div>
            <div style={{ display: 'flex', gap: 'var(--esp-2)', justifyContent: 'flex-end' }}>
              <Link to="/" className="btn btn--secundario">
                Ir al inicio
              </Link>
              <Link to="/login" className="btn btn--primario">
                Volver a intentar
              </Link>
            </div>
          </div>
        ) : (
          <div className="auth-spinner-wrap">
            <div className="spinner" aria-hidden="true" />
            <h1 className="auth-card__titulo" style={{ fontSize: 'var(--tam-xl)' }}>
              Conectando tu cuenta
            </h1>
            <p className="auth-card__subtitulo" style={{ margin: 0 }}>
              {estado}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
