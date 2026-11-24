import { ValidationError } from './errors.js';

const RADIO_TIERRA_KM = 6371.0088;

/**
 * Valida y convierte latitud y longitud a números finitos dentro de WGS84.
 */
export function validarCoordenadas(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
    throw new ValidationError('La latitud debe ser un número válido entre -90 y 90.');
  }
  if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
    throw new ValidationError('La longitud debe ser un número válido entre -180 y 180.');
  }

  return { lat: latNum, lng: lngNum };
}

/**
 * Convierte lat, lng a formato EWKT SRID 4326 compatible con PostGIS GEOGRAPHY(Point, 4326).
 * En PostGIS el orden es siempre POINT(longitud latitud).
 */
export function toPostgisPoint(lat, lng) {
  const coords = validarCoordenadas(lat, lng);
  return `SRID=4326;POINT(${coords.lng} ${coords.lat})`;
}

/**
 * Parsea un punto retornado por PostGIS/Supabase en cualquiera de sus formatos:
 * - GeoJSON: { type: 'Point', coordinates: [lng, lat] }
 * - WKT/EWKT: 'POINT(lng lat)' o 'SRID=4326;POINT(lng lat)'
 * - EWKB hexadecimal (formato por defecto de PostgREST para GEOGRAPHY)
 * - Objeto simple { lat, lng }
 */
export function parsePostgisPoint(raw) {
  if (!raw) return null;

  if (typeof raw === 'object') {
    if (Array.isArray(raw.coordinates) && raw.coordinates.length >= 2) {
      return {
        lng: Number(raw.coordinates[0]),
        lat: Number(raw.coordinates[1]),
      };
    }
    if (raw.lat !== undefined && raw.lng !== undefined) {
      return {
        lat: Number(raw.lat),
        lng: Number(raw.lng),
      };
    }
    return null;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();

    // WKT / EWKT: SRID=4326;POINT(-74.0721 4.7110) o POINT(-74.0721 4.7110)
    const matchWkt = trimmed.match(/POINT\s*\(\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*\)/i);
    if (matchWkt) {
      return {
        lng: Number(matchWkt[1]),
        lat: Number(matchWkt[2]),
      };
    }

    // EWKB hexadecimal de PostGIS (ej. 0101000020E6100000...)
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 42) {
      try {
        const buf = Buffer.from(trimmed, 'hex');
        const littleEndian = buf.readUInt8(0) === 1;
        const type = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
        const hasSrid = (type & 0x20000000) !== 0;
        const offset = hasSrid ? 9 : 5;

        if (buf.length >= offset + 16) {
          const lng = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
          const lat = littleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
          }
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Calcula distancia geodésica en kilómetros entre dos coordenadas usando la fórmula de Haversine.
 */
export function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((RADIO_TIERRA_KM * c).toFixed(3));
}
