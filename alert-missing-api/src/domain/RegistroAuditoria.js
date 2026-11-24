import { ValidationError } from '../shared/errors.js';

export const ACCIONES_AUDITORIA = Object.freeze({
  REGISTRO_USUARIO: 'REGISTRO_USUARIO',
  ACEPTACION_HABEAS_DATA: 'ACEPTACION_HABEAS_DATA',
  LOGIN_EXITOSO: 'LOGIN_EXITOSO',
  LOGIN_FALLIDO: 'LOGIN_FALLIDO',
  LOGIN_BLOQUEADO: 'LOGIN_BLOQUEADO',
  LOGIN_GOOGLE: 'LOGIN_GOOGLE',
  LOGOUT: 'LOGOUT',
  RENOVACION_TOKEN: 'RENOVACION_TOKEN',
  ACTUALIZACION_PERFIL: 'ACTUALIZACION_PERFIL',
  TOKEN_INVALIDO: 'TOKEN_INVALIDO',
  USUARIO_BLOQUEADO_ACCESO: 'USUARIO_BLOQUEADO_ACCESO',
  ACCESO_NO_AUTORIZADO_ROL: 'ACCESO_NO_AUTORIZADO_ROL',
  ACCESO_NO_AUTORIZADO_PROPIETARIO: 'ACCESO_NO_AUTORIZADO_PROPIETARIO',
  CREACION_FICHA_BUSQUEDA: 'CREACION_FICHA_BUSQUEDA',
  ACTUALIZACION_ALERTA_ROSA: 'ACTUALIZACION_ALERTA_ROSA',
  REPORTE_AVISTAMIENTO: 'REPORTE_AVISTAMIENTO',
  APROBACION_AVISTAMIENTO: 'APROBACION_AVISTAMIENTO',
  DESCARTE_AVISTAMIENTO: 'DESCARTE_AVISTAMIENTO',
  BLOQUEO_USUARIO_ABUSO: 'BLOQUEO_USUARIO_ABUSO',
  BLOQUEO_IP_SPAM: 'BLOQUEO_IP_SPAM',
  CIERRE_ALERTA_LOCALIZADA: 'CIERRE_ALERTA_LOCALIZADA',
  CANCELACION_ALERTA: 'CANCELACION_ALERTA',
  EXPORTACION_SIRDEC: 'EXPORTACION_SIRDEC',
  SUSCRIPCION_DISPOSITIVO: 'SUSCRIPCION_DISPOSITIVO',
  SIRDEC_COMPLETADO: 'SIRDEC_COMPLETADO',
  SUSPENSION_AUTOMATICA_SIRDEC: 'SUSPENSION_AUTOMATICA_SIRDEC',
  REACTIVACION_TRAS_SIRDEC: 'REACTIVACION_TRAS_SIRDEC',
});

const REGEX_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validarUuidOpcional(valor, nombreCampo) {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }
  if (typeof valor !== 'string' || !REGEX_UUID.test(valor.trim())) {
    throw new ValidationError(`El campo ${nombreCampo} debe ser un UUID válido.`);
  }
  return valor.trim();
}

function validarTextoRequerido(valor, nombreCampo, maxLen = 100) {
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new ValidationError(`El campo ${nombreCampo} es obligatorio para el registro de auditoría.`);
  }
  const limpio = valor.trim();
  if (limpio.length > maxLen) {
    throw new ValidationError(`El campo ${nombreCampo} supera la longitud máxima de ${maxLen} caracteres.`);
  }
  return limpio;
}

export class RegistroAuditoria {
  constructor({
    id = null,
    usuarioId = null,
    accion,
    entidad,
    entidadId = null,
    ip = '0.0.0.0',
    fecha = null,
  }) {
    this.id = validarUuidOpcional(id, 'id');
    this.usuarioId = validarUuidOpcional(usuarioId, 'usuarioId');
    this.accion = validarTextoRequerido(accion, 'accion', 80).toUpperCase();
    this.entidad = validarTextoRequerido(entidad, 'entidad', 80).toUpperCase();
    this.entidadId = entidadId !== null && entidadId !== undefined ? String(entidadId).trim() : null;
    this.ip = typeof ip === 'string' && ip.trim().length > 0 ? ip.trim().slice(0, 64) : '0.0.0.0';
    this.fecha = fecha || new Date().toISOString();
  }

  static fromPersistence(row) {
    if (!row) return null;
    return new RegistroAuditoria({
      id: row.id,
      usuarioId: row.usuario_id,
      accion: row.accion,
      entidad: row.entidad,
      entidadId: row.entidad_id,
      ip: row.ip,
      fecha: row.fecha,
    });
  }

  toPersistence() {
    const payload = {
      usuario_id: this.usuarioId,
      accion: this.accion,
      entidad: this.entidad,
      entidad_id: this.entidadId,
      ip: this.ip,
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
      usuarioId: this.usuarioId,
      accion: this.accion,
      entidad: this.entidad,
      entidadId: this.entidadId,
      ip: this.ip,
      fecha: this.fecha,
    };
  }
}
