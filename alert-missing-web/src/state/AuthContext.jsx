import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  actualizarPerfilDenunciante,
  cerrarSesionApi,
  obtenerPerfilActual,
  sincronizarLoginGoogle,
} from '../api-client/authApi.js';
import {
  apiRequest,
  guardarRutaRetorno,
  guardarToken,
  obtenerTokenGuardado,
} from '../api-client/httpClient.js';
import { esSupabaseConfigurado, supabase } from '../api-client/supabaseClient.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => obtenerTokenGuardado());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const sincronizandoRef = useRef(false);

  /**
   * Intercambia una sesión válida de Supabase Google OAuth contra POST /api/auth/google
   * para sincronizar/crear el usuario en PostgreSQL y emitir el JWT del backend.
   */
  const syncGoogleSession = useCallback(async (sesionExplicita = null) => {
    if (!supabase) {
      const msg = 'Supabase no está configurado. Verifica VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.';
      setAuthError(msg);
      throw new Error(msg);
    }

    if (sincronizandoRef.current) {
      return null;
    }

    sincronizandoRef.current = true;
    setAuthError('');

    try {
      let sesion = sesionExplicita;
      if (!sesion) {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          throw new Error(error.message || 'No se pudo recuperar la sesión de Google.');
        }
        sesion = data?.session || null;
      }

      if (!sesion?.access_token) {
        throw new Error('No se encontró una sesión activa de Google para sincronizar.');
      }

      const respuesta = await sincronizarLoginGoogle({
        accessToken: sesion.access_token,
        supabaseUser: sesion.user,
      });

      guardarToken(respuesta.token);
      setToken(respuesta.token);
      setUser(respuesta.usuario);
      return respuesta;
    } catch (error) {
      const mensaje =
        error.status === 403
          ? error.message || 'Tu cuenta se encuentra bloqueada. Contacta al administrador.'
          : error.message || 'No fue posible sincronizar tu cuenta con el servidor.';

      setAuthError(mensaje);
      guardarToken(null);
      setToken(null);
      setUser(null);

      // Si el usuario está bloqueado o el backend rechazó la sesión, cerrar sesión también en Supabase
      if (error.status === 403 || error.status === 401) {
        await supabase.auth.signOut().catch(() => {});
      }

      throw error;
    } finally {
      sincronizandoRef.current = false;
    }
  }, []);

  // Recuperación inicial de sesión (JWT guardado o sesión activa de Supabase) + listener onAuthStateChange
  useEffect(() => {
    let montado = true;

    async function inicializarSesion() {
      setLoading(true);

      const tokenLocal = obtenerTokenGuardado();
      if (tokenLocal) {
        try {
          const data = await obtenerPerfilActual(tokenLocal);
          if (montado) {
            setToken(tokenLocal);
            setUser(data.usuario || null);
            setLoading(false);
            return;
          }
        } catch (err) {
          guardarToken(null);
          if (montado) {
            setToken(null);
            setUser(null);
            if (err.status === 403) {
              setAuthError(err.message || 'Tu cuenta se encuentra bloqueada.');
              await supabase?.auth.signOut().catch(() => {});
              setLoading(false);
              return;
            }
          }
        }
      }

      // Si no había JWT válido pero existe sesión activa de Supabase (y no estamos en /auth/callback)
      if (supabase && window.location.pathname !== '/auth/callback') {
        try {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.access_token && montado) {
            await syncGoogleSession(data.session);
          }
        } catch {
          // El error ya fue registrado en authError
        }
      }

      if (montado) {
        setLoading(false);
      }
    }

    inicializarSesion();

    let subscription = null;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!montado) return;

        if (event === 'SIGNED_OUT') {
          guardarToken(null);
          setToken(null);
          setUser(null);
          return;
        }

        if (
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
          session?.access_token &&
          window.location.pathname !== '/auth/callback'
        ) {
          // Sincronizar en segundo plano si aún no tenemos JWT o cambió el usuario
          if (!obtenerTokenGuardado()) {
            try {
              await syncGoogleSession(session);
            } catch {
              // Manejado en authError
            }
          }
        }
      });
      subscription = data?.subscription || null;
    }

    return () => {
      montado = false;
      subscription?.unsubscribe();
    };
  }, [syncGoogleSession]);

  /**
   * Inicia flujo OAuth de Google mediante Supabase Auth redirigiendo a /auth/callback.
   */
  const signInWithGoogle = useCallback(async (rutaRetorno = null) => {
    setAuthError('');

    if (!esSupabaseConfigurado() || !supabase) {
      const msg =
        'Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en alert-missing-web/.env.';
      setAuthError(msg);
      throw new Error(msg);
    }

    if (rutaRetorno) {
      guardarRutaRetorno(rutaRetorno);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      const msg = error.message || 'No se pudo iniciar la autenticación con Google.';
      setAuthError(msg);
      throw new Error(msg);
    }
  }, []);

  /**
   * Autenticación local (soporte retrocompatible).
   */
  const iniciarSesion = useCallback(async ({ correo, password }) => {
    setAuthError('');
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: { correo, password },
    });
    guardarToken(data.token);
    setToken(data.token);
    setUser(data.usuario);
    return data;
  }, []);

  /**
   * RF-01: Actualiza/completa perfil del denunciante contra PUT /api/auth/profile.
   */
  const updateProfile = useCallback(async (datosPerfil) => {
    const data = await actualizarPerfilDenunciante(datosPerfil);
    setUser(data.usuario);
    return data.usuario;
  }, []);

  /**
   * Cierra sesión en el backend (auditoría), en Supabase Auth y limpia estado local.
   */
  const logout = useCallback(async () => {
    try {
      if (obtenerTokenGuardado()) {
        await cerrarSesionApi();
      }
    } catch {
      // No bloquear el cierre local si el token ya expiró o no hay red
    }

    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }

    guardarToken(null);
    setToken(null);
    setUser(null);
    setAuthError('');
  }, []);

  const clearAuthError = useCallback(() => setAuthError(''), []);

  const isAuthenticated = Boolean(token && user);

  return (
    <AuthContext.Provider
      value={{
        // API en inglés (solicitada en módulo OAuth)
        user,
        token,
        loading,
        isAuthenticated,
        authError,
        signInWithGoogle,
        syncGoogleSession,
        updateProfile,
        logout,
        clearAuthError,
        // Alias en español (retrocompatibilidad con Fases 2 y 3)
        usuario: user,
        cargando: loading,
        estaAutenticado: isAuthenticated,
        iniciarSesion,
        cerrarSesion: logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }
  return ctx;
}
