import { apiRequest } from '../api-client/httpClient.js';

const ONESIGNAL_APP_ID = import.meta.env.VITE_ONESIGNAL_APP_ID || '';
const ONESIGNAL_SDK_URL = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
const STORAGE_SIM_ID_KEY = 'alert_missing_sim_onesignal_id';
const STORAGE_SUB_STATE_KEY = 'alert_missing_suscripcion_zona';

let oneSignalInicializado = false;
let promesaCargaSdk = null;

export function esOneSignalConfigurado() {
  return Boolean(ONESIGNAL_APP_ID && !ONESIGNAL_APP_ID.startsWith('tu_'));
}

function obtenerOGenerarIdSimulado() {
  try {
    let existente = localStorage.getItem(STORAGE_SIM_ID_KEY);
    if (!existente) {
      const random =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      existente = `dev-onesignal-${random}`;
      localStorage.setItem(STORAGE_SIM_ID_KEY, existente);
    }
    return existente;
  } catch {
    return `dev-onesignal-${Date.now()}`;
  }
}

export function obtenerEstadoSuscripcionLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_SUB_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardarEstadoSuscripcionLocal(estado) {
  try {
    localStorage.setItem(STORAGE_SUB_STATE_KEY, JSON.stringify(estado));
  } catch {
    // Ignorar en modo privado restringido
  }
}

/**
 * Consulta los permisos actuales de notificaciones y geolocalización en el navegador.
 */
export async function obtenerEstadoPermisosNavegador() {
  let notificaciones = 'unsupported';
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const perm = Notification.permission;
    notificaciones = perm === 'default' ? 'prompt' : perm;
  }

  let ubicacion = 'prompt';
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    ubicacion = 'unsupported';
  } else if (navigator.permissions?.query) {
    try {
      const res = await navigator.permissions.query({ name: 'geolocation' });
      ubicacion = res.state; // 'granted' | 'denied' | 'prompt'
    } catch {
      ubicacion = 'prompt';
    }
  }

  return { notificaciones, ubicacion };
}

function cargarScriptOneSignal() {
  if (promesaCargaSdk) return promesaCargaSdk;

  promesaCargaSdk = new Promise((resolve, reject) => {
    if (window.OneSignal) {
      resolve(window.OneSignal);
      return;
    }

    const script = document.createElement('script');
    script.src = ONESIGNAL_SDK_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.OneSignal);
    script.onerror = () => reject(new Error('No se pudo cargar el SDK de OneSignal.'));
    document.head.appendChild(script);
  });

  return promesaCargaSdk;
}

/**
 * Inicializa OneSignal Web SDK v16 cuando hay credenciales reales configuradas.
 * En desarrollo sin credenciales usa modo simulado/fallback transparente.
 */
export async function inicializarOneSignal() {
  if (!esOneSignalConfigurado()) {
    return { modoSimulado: true, oneSignalId: obtenerOGenerarIdSimulado() };
  }

  try {
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    await cargarScriptOneSignal();

    const oneSignalId = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Tiempo de espera agotado al inicializar OneSignal.')),
        8000
      );

      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          if (!oneSignalInicializado) {
            await OneSignal.init({
              appId: ONESIGNAL_APP_ID,
              allowLocalhostAsSecureOrigin: true,
            });
            oneSignalInicializado = true;
          }

          await OneSignal.Notifications.requestPermission();
          const subId = OneSignal.User?.PushSubscription?.id || null;
          clearTimeout(timeout);
          resolve(subId);
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });

    if (oneSignalId) {
      return { modoSimulado: false, oneSignalId };
    }
  } catch (err) {
    console.warn('[OneSignal] Activando respaldo local:', err.message);
  }

  return { modoSimulado: true, oneSignalId: obtenerOGenerarIdSimulado() };
}

function obtenerCoordenadasActuales() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tu navegador no soporta geolocalización.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
      },
      (err) => {
        const codigo = err.code;
        if (codigo === 1) {
          const e = new Error('Permiso de ubicación bloqueado por el navegador.');
          e.permisoDenegado = true;
          reject(e);
          return;
        }
        reject(new Error('No fue posible determinar tu ubicación actual.'));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * Flujo completo de suscripción colaborativa:
 * 1. Solicita permiso de notificaciones (OneSignal real o modo simulado de desarrollo).
 * 2. Solicita ubicación actual (GPS).
 * 3. Registra `oneSignalId` y coordenadas en `POST /api/dispositivos/suscribir`.
 */
export async function activarSuscripcionColaborativa() {
  let permisoNotificaciones = false;
  let notificacionesBloqueadas = false;

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'denied') {
      notificacionesBloqueadas = true;
    } else if (Notification.permission === 'granted') {
      permisoNotificaciones = true;
    } else {
      const resultado = await Notification.requestPermission();
      permisoNotificaciones = resultado === 'granted';
      notificacionesBloqueadas = resultado === 'denied';
    }
  }

  const { modoSimulado, oneSignalId } = await inicializarOneSignal();

  // En modo simulado de desarrollo sin API Notification (ej. navegador sin soporte), permitir probar el flujo
  if (modoSimulado && typeof window !== 'undefined' && !('Notification' in window)) {
    permisoNotificaciones = true;
  }

  let coords = null;
  let permisoUbicacion = false;
  let ubicacionBloqueada = false;

  try {
    coords = await obtenerCoordenadasActuales();
    permisoUbicacion = true;
  } catch (err) {
    if (err.permisoDenegado) {
      ubicacionBloqueada = true;
    }
  }

  const respuesta = await apiRequest('/dispositivos/suscribir', {
    method: 'POST',
    body: {
      oneSignalId,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      permisoNotificaciones,
      permisoUbicacion,
    },
  });

  const resumen = {
    oneSignalId,
    modoSimulado,
    permisoNotificaciones,
    permisoUbicacion,
    notificacionesBloqueadas,
    ubicacionBloqueada,
    coordenadas: coords,
    actualizadoEn: new Date().toISOString(),
  };

  guardarEstadoSuscripcionLocal(resumen);

  return {
    ...resumen,
    dispositivo: respuesta.dispositivo,
  };
}
