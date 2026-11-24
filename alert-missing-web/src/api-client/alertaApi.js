import { apiRequest, obtenerTokenGuardado } from './httpClient.js';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api').replace(
  /\/$/,
  ''
);

function construirQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== null && valor !== '') {
      search.set(clave, String(valor));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function listarAlertasActivas(filtros = {}, signal) {
  const qs = construirQuery(filtros);
  return apiRequest(`/alertas${qs}`, { method: 'GET', signal });
}

export async function listarMisAlertas(signal) {
  return apiRequest('/alertas/mias', { method: 'GET', signal });
}

export async function obtenerAlertaPorId(id, signal) {
  return apiRequest(`/alertas/${encodeURIComponent(id)}`, { method: 'GET', signal });
}

export async function crearFichaBusqueda(payload) {
  return apiRequest('/alertas', { method: 'POST', body: payload });
}

export async function actualizarAlertaRosa(id, payload) {
  return apiRequest(`/alertas/${encodeURIComponent(id)}/alerta-rosa`, {
    method: 'PATCH',
    body: payload,
  });
}

export async function actualizarDatosSirdec(id, datosSirdec) {
  return apiRequest(`/alertas/${encodeURIComponent(id)}/sirdec`, {
    method: 'PATCH',
    body: { datosSirdec },
  });
}

export async function cerrarAlerta(id, { resumen }) {
  return apiRequest(`/alertas/${encodeURIComponent(id)}/cerrar`, {
    method: 'PATCH',
    body: { resumen },
  });
}

export async function cancelarAlerta(id, { motivo }) {
  return apiRequest(`/alertas/${encodeURIComponent(id)}/cancelar`, {
    method: 'PATCH',
    body: { motivo },
  });
}

/**
 * Descarga el reporte SIRDEC en PDF o JSON desde GET /api/alertas/:id/exportar-sirdec?formato=pdf|json.
 */
export async function descargarReporteSirdec(id, formato = 'pdf') {
  const formatoNorm = formato === 'json' ? 'json' : 'pdf';
  const headers = {};
  const token = obtenerTokenGuardado();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE_URL}/alertas/${encodeURIComponent(id)}/exportar-sirdec?formato=${formatoNorm}`,
    {
      method: 'GET',
      headers,
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.mensaje || `No se pudo generar el reporte SIRDEC (${response.status}).`);
  }

  if (formatoNorm === 'json') {
    const json = await response.json();
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    dispararDescargaBlob(blob, `ficha-sirdec-${id}.json`);
    return { formato: 'json', datos: json };
  }

  const blob = await response.blob();
  dispararDescargaBlob(blob, `ficha-sirdec-${id}.pdf`);
  return { formato: 'pdf', tamanoBytes: blob.size };
}

function dispararDescargaBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function obtenerPuntosApoyoCercanos({ lat, lng, radioKm = 5, tipo = 'TODOS' }, signal) {
  const qs = construirQuery({ lat, lng, radioKm, tipo });
  return apiRequest(`/mapa/puntos-apoyo${qs}`, { method: 'GET', signal });
}

export async function obtenerSaludServicio(signal) {
  const inicio = performance.now();
  const data = await apiRequest('/health', { method: 'GET', signal });
  const latenciaMs = Math.round(performance.now() - inicio);
  return { ...data, latenciaMs };
}

export async function obtenerAuditoriaFicha(fichaId, signal) {
  return apiRequest(`/auditoria/ficha/${encodeURIComponent(fichaId)}`, {
    method: 'GET',
    signal,
  });
}

export async function obtenerMiAuditoria(signal) {
  return apiRequest('/auditoria/mios', {
    method: 'GET',
    signal,
  });
}

/**
 * Geocodificación de direcciones en Colombia usando OpenStreetMap Nominatim.
 */
export async function buscarDireccionColombia(consulta, signal) {
  const termino = String(consulta || '').trim();
  if (termino.length < 3) {
    return [];
  }

  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=co&addressdetails=1&q=` +
    encodeURIComponent(termino);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'es-CO,es',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar el buscador de direcciones en este momento.');
  }

  const resultados = await response.json();
  return (Array.isArray(resultados) ? resultados : []).map((item) => ({
    id: String(item.place_id),
    nombre: item.display_name,
    lat: Number(item.lat),
    lng: Number(item.lon),
  }));
}

/**
 * Geocodificación inversa (lat, lng -> dirección legible en Colombia) usando Nominatim OSM.
 */
export async function obtenerDireccionPorCoordenadas(lat, lng, signal) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&lat=` +
    encodeURIComponent(lat) +
    `&lon=` +
    encodeURIComponent(lng);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'es-CO,es',
    },
    signal,
  });

  if (!response.ok) return null;
  const data = await response.json();
  return data?.display_name || null;
}
