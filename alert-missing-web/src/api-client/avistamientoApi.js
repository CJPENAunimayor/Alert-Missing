import { apiRequest, obtenerTokenGuardado } from './httpClient.js';
import { guardarAvistamientoOffline } from '../offline/offlineDb.js';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(
  /\/$/,
  ''
);

export async function listarAvistamientosPorFicha(fichaId, { estado } = {}, signal) {
  const qs = estado ? `?estado=${encodeURIComponent(estado)}` : '';
  return apiRequest(`/avistamientos/ficha/${encodeURIComponent(fichaId)}${qs}`, {
    method: 'GET',
    signal,
  });
}

export async function listarMisAvistamientos(signal) {
  return apiRequest('/avistamientos/mios', {
    method: 'GET',
    signal,
  });
}

/**
 * Envía un reporte de avistamiento al backend (requiere sesión autenticada).
 * Si el navegador está sin conexión (navigator.onLine === false) o falla la red,
 * almacena el reporte autenticado en IndexedDB para envío automático al reconectar.
 */
export async function reportarAvistamiento(fichaId, payload) {
  const token = obtenerTokenGuardado();
  if (!token) {
    const err = new Error('Debe iniciar sesión con una cuenta activa para reportar un avistamiento.');
    err.status = 401;
    err.code = 'AUTHENTICATION_ERROR';
    throw err;
  }

  const guardarLocal = async () => {
    const registroLocal = await guardarAvistamientoOffline({
      fichaId,
      payload,
      apiBaseUrl: API_BASE_URL,
      authToken: token,
    });

    return {
      offline: true,
      registroLocal,
      mensaje:
        'Sin conexión a internet: tu reporte de avistamiento fue guardado localmente en este dispositivo y se enviará automáticamente al recuperar conectividad.',
    };
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return guardarLocal();
  }

  try {
    const data = await apiRequest(`/avistamientos/ficha/${encodeURIComponent(fichaId)}`, {
      method: 'POST',
      body: payload,
    });
    return {
      offline: false,
      ...data,
    };
  } catch (error) {
    // Si no tiene status HTTP, se trata de un fallo de conectividad/red -> guardar offline en IndexedDB
    if (!error.status && error.name !== 'AbortError') {
      return guardarLocal();
    }
    throw error;
  }
}

export async function aprobarAvistamiento(id) {
  return apiRequest(`/avistamientos/${encodeURIComponent(id)}/aprobar`, {
    method: 'PATCH',
  });
}

export async function descartarAvistamiento(id, { motivo = '', bloquearOrigen = false } = {}) {
  const motivoFinal =
    motivo && motivo.trim().length >= 3
      ? motivo.trim()
      : bloquearOrigen
        ? 'Reporte descartado por abuso o spam.'
        : 'Reporte descartado por el moderador.';

  return apiRequest(`/avistamientos/${encodeURIComponent(id)}/descartar`, {
    method: 'PATCH',
    body: {
      motivo: motivoFinal,
      bloquearOrigen: Boolean(bloquearOrigen),
    },
  });
}
