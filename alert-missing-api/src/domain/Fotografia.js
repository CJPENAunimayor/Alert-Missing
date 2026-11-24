import { ValidationError } from '../shared/errors.js';

export const TIPOS_IMAGEN_PERMITIDOS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export const TAMANO_MAX_IMAGEN_BYTES = 5 * 1024 * 1024; // 5 MB

export function validarUrlFotografia(url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new ValidationError('La URL de la fotografía es obligatoria.');
  }
  const limpia = url.trim();
  let parsed;
  try {
    parsed = new URL(limpia);
  } catch {
    throw new ValidationError('La URL de la fotografía no tiene un formato válido.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('La URL de la fotografía debe utilizar protocolo HTTP o HTTPS.');
  }
  return limpia;
}

/**
 * Decodifica y valida una imagen recibida en formato Data URI o Base64 + contentType.
 */
export function parsearImagenBase64({ base64, contentType = null, nombreArchivo = 'foto' }) {
  if (typeof base64 !== 'string' || base64.trim().length === 0) {
    throw new ValidationError('El contenido de la imagen en base64 es obligatorio.');
  }

  let mime = contentType ? String(contentType).trim().toLowerCase() : null;
  let datosPuros = base64.trim();

  const matchDataUri = datosPuros.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (matchDataUri) {
    mime = matchDataUri[1].toLowerCase();
    datosPuros = matchDataUri[2];
  }

  if (!mime || !TIPOS_IMAGEN_PERMITIDOS[mime]) {
    throw new ValidationError(
      'Formato de imagen no soportado. Solo se permiten JPEG, PNG o WebP.'
    );
  }

  const buffer = Buffer.from(datosPuros, 'base64');
  if (buffer.length === 0) {
    throw new ValidationError('La imagen proporcionada está vacía o corrupta.');
  }
  if (buffer.length > TAMANO_MAX_IMAGEN_BYTES) {
    throw new ValidationError('La imagen excede el tamaño máximo permitido de 5 MB.');
  }

  return {
    buffer,
    contentType: mime === 'image/jpg' ? 'image/jpeg' : mime,
    extension: TIPOS_IMAGEN_PERMITIDOS[mime],
    nombreArchivo: String(nombreArchivo || 'foto').replace(/[^a-zA-Z0-9._-]/g, '_'),
  };
}

export class Fotografia {
  constructor({ id = null, fichaId = null, url, esPrincipal = false }) {
    this.id = id;
    this.fichaId = fichaId;
    this.url = validarUrlFotografia(url);
    this.esPrincipal = Boolean(esPrincipal);
  }

  static fromPersistence(row) {
    if (!row) return null;
    return new Fotografia({
      id: row.id,
      fichaId: row.ficha_id,
      url: row.url,
      esPrincipal: row.es_principal,
    });
  }

  toPersistence() {
    const payload = {
      ficha_id: this.fichaId,
      url: this.url,
      es_principal: this.esPrincipal,
    };
    if (this.id) {
      payload.id = this.id;
    }
    return payload;
  }

  toJSON() {
    return {
      id: this.id,
      fichaId: this.fichaId,
      url: this.url,
      esPrincipal: this.esPrincipal,
    };
  }
}
