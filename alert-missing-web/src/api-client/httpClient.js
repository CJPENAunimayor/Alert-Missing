const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(
  /\/$/,
  ''
);

const STORAGE_TOKEN_KEY = 'alert_missing_token';
const STORAGE_RETURN_TO_KEY = 'alert_missing_return_to';

export function obtenerTokenGuardado() {
  try {
    return localStorage.getItem(STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function guardarToken(token) {
  try {
    if (token) {
      localStorage.setItem(STORAGE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
    }
  } catch {
    // Modo privado o almacenamiento no disponible
  }
}

export function guardarRutaRetorno(ruta) {
  try {
    if (ruta && ruta !== '/login' && ruta !== '/auth/callback') {
      sessionStorage.setItem(STORAGE_RETURN_TO_KEY, ruta);
    }
  } catch {
    // Ignorar
  }
}

export function consumirRutaRetorno(porDefecto = '/') {
  try {
    const ruta = sessionStorage.getItem(STORAGE_RETURN_TO_KEY);
    sessionStorage.removeItem(STORAGE_RETURN_TO_KEY);
    return ruta || porDefecto;
  } catch {
    return porDefecto;
  }
}

export async function apiRequest(ruta, { method = 'GET', body = null, token = null, signal } = {}) {
  const headers = {
    Accept: 'application/json',
  };

  const authToken = token || obtenerTokenGuardado();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const opciones = {
    method,
    headers,
    signal,
  };

  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${ruta}`, opciones);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error('No se pudo conectar con el servidor de Alert Missing. Verifica tu conexión.');
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detalle =
      Array.isArray(data.detalles) && data.detalles.length > 0
        ? data.detalles.map((d) => d.mensaje).join(' ')
        : null;

    const mensaje = detalle || data.mensaje || `Error HTTP ${response.status}`;
    const err = new Error(mensaje);
    err.status = response.status;
    err.code = data.error;
    err.detalles = data.detalles || null;
    throw err;
  }

  return data;
}
