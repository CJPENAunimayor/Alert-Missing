import { ValidationError } from '../shared/errors.js';

const ESTADOS_VALIDOS = new Set(['ACTIVA', 'LOCALIZADA', 'CANCELADA', 'SUSPENDIDA_SIRDEC']);

export class HistorialEstado {
  constructor({ id = null, fichaId, estadoNuevo, resumenOMotivo, usuarioId, fecha = null }) {
    if (!fichaId || typeof fichaId !== 'string') {
      throw new ValidationError('El identificador de la ficha es obligatorio para el historial.');
    }

    const estadoNormalizado = String(estadoNuevo || '').trim().toUpperCase();
    if (!ESTADOS_VALIDOS.has(estadoNormalizado)) {
      throw new ValidationError(`Estado de ficha no válido para historial: ${estadoNuevo}`);
    }

    if (typeof resumenOMotivo !== 'string' || resumenOMotivo.trim().length < 3) {
      throw new ValidationError(
        'El resumen o motivo del cambio de estado es obligatorio (mínimo 3 caracteres).'
      );
    }

    if (!usuarioId || typeof usuarioId !== 'string') {
      throw new ValidationError('El identificador del usuario responsable es obligatorio.');
    }

    this.id = id;
    this.fichaId = fichaId;
    this.estadoNuevo = estadoNormalizado;
    this.resumenOMotivo = resumenOMotivo.trim();
    this.usuarioId = usuarioId;
    this.fecha = fecha || new Date().toISOString();
  }

  static fromPersistence(row) {
    if (!row) return null;
    return new HistorialEstado({
      id: row.id,
      fichaId: row.ficha_id,
      estadoNuevo: row.estado_nuevo,
      resumenOMotivo: row.resumen_o_motivo,
      usuarioId: row.usuario_id,
      fecha: row.fecha,
    });
  }

  toPersistence() {
    const payload = {
      ficha_id: this.fichaId,
      estado_nuevo: this.estadoNuevo,
      resumen_o_motivo: this.resumenOMotivo,
      usuario_id: this.usuarioId,
      fecha: this.fecha,
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
      estadoNuevo: this.estadoNuevo,
      resumenOMotivo: this.resumenOMotivo,
      usuarioId: this.usuarioId,
      fecha: this.fecha,
    };
  }
}
