import { ValidationError } from '../shared/errors.js';
import { parsePostgisPoint, toPostgisPoint, validarCoordenadas } from '../shared/geo.js';
import { validarUrlFotografia } from './Fotografia.js';

export const ESTADOS_AVISTAMIENTO = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  APROBADO: 'APROBADO',
  DESCARTADO: 'DESCARTADO',
});

export class Avistamiento {
  constructor({
    id = null,
    fichaId,
    testigoId = null,
    lat,
    lng,
    fechaHora,
    descripcion,
    urlEvidencia = null,
    estado = ESTADOS_AVISTAMIENTO.PENDIENTE,
    motivoRechazo = null,
    ipOrigen = '0.0.0.0',
    createdAt = null,
  }) {
    if (!fichaId || typeof fichaId !== 'string') {
      throw new ValidationError('El identificador de la ficha de búsqueda es obligatorio.');
    }

    const coords = validarCoordenadas(lat, lng);

    const fecha = new Date(fechaHora);
    if (!fechaHora || Number.isNaN(fecha.getTime())) {
      throw new ValidationError('La fecha y hora del avistamiento no es válida.');
    }

    if (typeof descripcion !== 'string' || descripcion.trim().length < 5) {
      throw new ValidationError(
        'La descripción del avistamiento es obligatoria y debe tener al menos 5 caracteres.'
      );
    }

    const estadoNorm = String(estado || ESTADOS_AVISTAMIENTO.PENDIENTE).trim().toUpperCase();
    if (!Object.values(ESTADOS_AVISTAMIENTO).includes(estadoNorm)) {
      throw new ValidationError(`Estado de avistamiento no válido: ${estado}`);
    }

    const evidenciaValidada = urlEvidencia ? validarUrlFotografia(urlEvidencia) : null;

    if (
      estadoNorm === ESTADOS_AVISTAMIENTO.DESCARTADO &&
      (!motivoRechazo || String(motivoRechazo).trim().length < 3)
    ) {
      throw new ValidationError(
        'Todo avistamiento descartado debe registrar un motivo de rechazo (mínimo 3 caracteres).'
      );
    }

    this.id = id;
    this.fichaId = fichaId;
    this.testigoId = testigoId || null;
    this.lat = coords.lat;
    this.lng = coords.lng;
    this.fechaHora = fecha.toISOString();
    this.descripcion = descripcion.trim();
    this.urlEvidencia = evidenciaValidada;
    this.estado = estadoNorm;
    this.motivoRechazo = motivoRechazo ? String(motivoRechazo).trim() : null;
    this.ipOrigen =
      typeof ipOrigen === 'string' && ipOrigen.trim().length > 0
        ? ipOrigen.trim().slice(0, 64)
        : '0.0.0.0';
    this.createdAt = createdAt;
  }

  /**
   * Aprueba un avistamiento pendiente para hacerlo visible en el mapa público.
   */
  aprobar() {
    if (this.estado === ESTADOS_AVISTAMIENTO.APROBADO) {
      throw new ValidationError('El avistamiento ya se encuentra aprobado.');
    }
    if (this.estado === ESTADOS_AVISTAMIENTO.DESCARTADO) {
      throw new ValidationError(
        'No es posible aprobar un avistamiento que ya fue descartado.'
      );
    }
    this.estado = ESTADOS_AVISTAMIENTO.APROBADO;
    this.motivoRechazo = null;
    return this;
  }

  /**
   * Descarta un avistamiento con motivo obligatorio y lo oculta del mapa público.
   */
  descartar(motivo) {
    if (typeof motivo !== 'string' || motivo.trim().length < 3) {
      throw new ValidationError(
        'Debe especificar un motivo de rechazo válido (mínimo 3 caracteres) para descartar el avistamiento.'
      );
    }
    if (this.estado === ESTADOS_AVISTAMIENTO.DESCARTADO) {
      throw new ValidationError('El avistamiento ya se encuentra descartado.');
    }
    this.estado = ESTADOS_AVISTAMIENTO.DESCARTADO;
    this.motivoRechazo = motivo.trim().slice(0, 500);
    return this;
  }

  esPublico() {
    return this.estado === ESTADOS_AVISTAMIENTO.APROBADO;
  }

  toPointWKT() {
    return toPostgisPoint(this.lat, this.lng);
  }

  static fromPersistence(row) {
    if (!row) return null;
    const punto = parsePostgisPoint(row.coordenadas);
    if (!punto) {
      throw new ValidationError(
        `No se pudieron interpretar las coordenadas del avistamiento ${row.id}.`
      );
    }

    return new Avistamiento({
      id: row.id,
      fichaId: row.ficha_id,
      testigoId: row.testigo_id,
      lat: punto.lat,
      lng: punto.lng,
      fechaHora: row.fecha_hora,
      descripcion: row.descripcion,
      urlEvidencia: row.url_evidencia,
      estado: row.estado,
      motivoRechazo: row.motivo_rechazo,
      ipOrigen: row.ip_origen,
      createdAt: row.created_at,
    });
  }

  toPersistence() {
    const payload = {
      ficha_id: this.fichaId,
      testigo_id: this.testigoId,
      coordenadas: this.toPointWKT(),
      fecha_hora: this.fechaHora,
      descripcion: this.descripcion,
      url_evidencia: this.urlEvidencia,
      estado: this.estado,
      motivo_rechazo: this.motivoRechazo,
      ip_origen: this.ipOrigen,
    };
    if (this.id) {
      payload.id = this.id;
    }
    return payload;
  }

  /**
   * Representación pública (omite ipOrigen y motivoRechazo por privacidad).
   */
  toPublicJSON() {
    return {
      id: this.id,
      fichaId: this.fichaId,
      coordenadas: {
        lat: this.lat,
        lng: this.lng,
      },
      fechaHora: this.fechaHora,
      descripcion: this.descripcion,
      urlEvidencia: this.urlEvidencia,
      estado: this.estado,
      createdAt: this.createdAt,
    };
  }

  /**
   * Representación completa para el creador de la ficha o administradores (moderación).
   */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      testigoId: this.testigoId,
      motivoRechazo: this.motivoRechazo,
      ipOrigen: this.ipOrigen,
    };
  }
}
