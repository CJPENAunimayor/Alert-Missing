import { AppError } from '../shared/errors.js';

const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const TIMEOUT_MS = 12000;

/**
 * Construye una consulta Overpass QL para puntos de apoyo (estaciones/CAI de policía y hospitales/clínicas).
 */
function construirConsultaOverpass({ lat, lng, radioMetros, amenities }) {
  const filtroAmenity =
    amenities.length === 1
      ? `["amenity"="${amenities[0]}"]`
      : `["amenity"~"^(${amenities.join('|')})$"]`;

  return `[out:json][timeout:10];
(
  node${filtroAmenity}(around:${Math.round(radioMetros)},${lat},${lng});
  way${filtroAmenity}(around:${Math.round(radioMetros)},${lat},${lng});
  relation${filtroAmenity}(around:${Math.round(radioMetros)},${lat},${lng});
);
out center tags;`;
}

export class OverpassClient {
  constructor({ endpoints = DEFAULT_OVERPASS_ENDPOINTS, timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
    this.endpoints = endpoints;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Consulta en tiempo real a la Overpass API de OpenStreetMap con respaldo entre mirrors.
   */
  async consultarPuntosApoyo({ lat, lng, radioMetros, amenities = ['police', 'hospital', 'clinic'] }) {
    const query = construirConsultaOverpass({ lat, lng, radioMetros, amenities });
    let ultimoError = null;

    for (const endpoint of this.endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
            'User-Agent': 'AlertMissingColombia/1.0 (+https://alertmissing.co)',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          ultimoError = new Error(`Overpass respondió HTTP ${response.status} en ${endpoint}`);
          continue;
        }

        const data = await response.json();
        return Array.isArray(data?.elements) ? data.elements : [];
      } catch (error) {
        clearTimeout(timer);
        ultimoError = error;
      }
    }

    throw new AppError(
      `No fue posible consultar puntos de apoyo en OpenStreetMap (Overpass API): ${ultimoError?.message || 'tiempo de espera agotado'}`,
      { statusCode: 502, code: 'OVERPASS_UNAVAILABLE' }
    );
  }
}
