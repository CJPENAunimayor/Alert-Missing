import { ValidationError } from '../shared/errors.js';

export const ROLES_USUARIO = Object.freeze({
  USUARIO: 'USUARIO',
  ADMINISTRADOR: 'ADMINISTRADOR',
});

export const PROVEEDORES_AUTH = Object.freeze({
  LOCAL: 'LOCAL',
  GOOGLE: 'GOOGLE',
});

const REGEX_CORREO = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
const REGEX_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]{3,120}$/;
// Documento colombiano (CC, TI, CE, PA, PPT) o identificador alfanumérico entre 5 y 15 caracteres
const REGEX_DOCUMENTO = /^(?:(?:CC|TI|CE|PA|PPT)[\s-]?)?[A-Za-z0-9]{5,15}$/i;
// Teléfono móvil colombiano (3XXXXXXXXX), fijo (60[1-8]XXXXXXX) con o sin +57, o E.164 internacional
const REGEX_TELEFONO_CO = /^(?:\+?57)?(?:3\d{9}|60[1-8]\d{7})$/;
const REGEX_TELEFONO_E164 = /^\+[1-9]\d{7,14}$/;
// Contraseña segura: mínimo 8 caracteres, al menos una mayúscula, una minúscula y un dígito
const REGEX_PASSWORD_SEGURA = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

export function normalizarCorreo(correo) {
  if (typeof correo !== 'string') {
    throw new ValidationError('El correo electrónico es obligatorio y debe ser una cadena de texto.');
  }
  const limpio = correo.trim().toLowerCase();
  if (limpio.length === 0 || limpio.length > 254 || !REGEX_CORREO.test(limpio)) {
    throw new ValidationError('El formato del correo electrónico no es válido.');
  }
  return limpio;
}

export function validarNombreCompleto(nombreCompleto) {
  if (typeof nombreCompleto !== 'string') {
    throw new ValidationError('El nombre completo es obligatorio.');
  }
  const limpio = nombreCompleto.trim().replace(/\s+/g, ' ');
  if (!REGEX_NOMBRE.test(limpio)) {
    throw new ValidationError(
      'El nombre completo debe tener entre 3 y 120 caracteres y contener solo letras y espacios.'
    );
  }
  return limpio;
}

export function validarDocumento(documento, { obligatorio = false } = {}) {
  if (documento === null || documento === undefined || String(documento).trim() === '') {
    if (obligatorio) {
      throw new ValidationError('El número de documento de identidad es obligatorio.');
    }
    return null;
  }
  if (typeof documento !== 'string' && typeof documento !== 'number') {
    throw new ValidationError('El formato del documento de identidad no es válido.');
  }
  const limpio = String(documento).trim().toUpperCase().replace(/\s+/g, '');
  if (!REGEX_DOCUMENTO.test(limpio)) {
    throw new ValidationError(
      'El documento de identidad debe tener entre 5 y 15 caracteres alfanuméricos válidos (ej. 1020304050 o CC-1020304050).'
    );
  }
  return limpio;
}

export function validarTelefono(telefono, { obligatorio = false } = {}) {
  if (telefono === null || telefono === undefined || String(telefono).trim() === '') {
    if (obligatorio) {
      throw new ValidationError('El número de teléfono es obligatorio.');
    }
    return null;
  }
  if (typeof telefono !== 'string' && typeof telefono !== 'number') {
    throw new ValidationError('El formato del teléfono no es válido.');
  }
  const limpio = String(telefono).trim().replace(/[\s\-()]/g, '');
  if (!REGEX_TELEFONO_CO.test(limpio) && !REGEX_TELEFONO_E164.test(limpio)) {
    throw new ValidationError(
      'El teléfono debe ser un número colombiano válido (ej. 3001234567, +573001234567, 6012345678) o formato internacional E.164.'
    );
  }
  return limpio;
}

export function validarPasswordPlana(password) {
  if (typeof password !== 'string' || !REGEX_PASSWORD_SEGURA.test(password)) {
    throw new ValidationError(
      'La contraseña debe tener al menos 8 caracteres, incluir una letra mayúscula, una minúscula y un número.'
    );
  }
  return password;
}

export class Usuario {
  constructor({
    id = null,
    nombreCompleto,
    documento = null,
    correo,
    telefono = null,
    passwordHash = null,
    proveedorAuth = PROVEEDORES_AUTH.LOCAL,
    rol = ROLES_USUARIO.USUARIO,
    bloqueado = false,
    aceptoHabeasData = false,
    fechaAceptacionHabeasData = null,
    createdAt = null,
  }) {
    if (!Object.values(PROVEEDORES_AUTH).includes(proveedorAuth)) {
      throw new ValidationError(`Proveedor de autenticación no soportado: ${proveedorAuth}`);
    }
    if (!Object.values(ROLES_USUARIO).includes(rol)) {
      throw new ValidationError(`Rol de usuario no válido: ${rol}`);
    }

    const esLocal = proveedorAuth === PROVEEDORES_AUTH.LOCAL;

    this.id = id;
    this.nombreCompleto = validarNombreCompleto(nombreCompleto);
    this.correo = normalizarCorreo(correo);
    this.documento = validarDocumento(documento, { obligatorio: esLocal });
    this.telefono = validarTelefono(telefono, { obligatorio: esLocal });
    this.passwordHash = passwordHash;
    this.proveedorAuth = proveedorAuth;
    this.rol = rol;
    this.bloqueado = Boolean(bloqueado);
    this.aceptoHabeasData = Boolean(aceptoHabeasData);
    this.fechaAceptacionHabeasData = fechaAceptacionHabeasData;
    this.createdAt = createdAt;

    if (esLocal && !this.passwordHash) {
      throw new ValidationError('Los usuarios con proveedor LOCAL requieren una contraseña cifrada.');
    }
  }

  estaBloqueado() {
    return this.bloqueado === true;
  }

  esAdministrador() {
    return this.rol === ROLES_USUARIO.ADMINISTRADOR;
  }

  /**
   * Indica si el denunciante completó sus datos obligatorios (RF-01) y aceptó Hábeas Data (Ley 1581).
   */
  perfilDenuncianteCompleto() {
    return Boolean(
      this.nombreCompleto &&
        this.documento &&
        this.telefono &&
        this.aceptoHabeasData === true
    );
  }

  static fromPersistence(row) {
    if (!row) return null;
    return new Usuario({
      id: row.id,
      nombreCompleto: row.nombre_completo,
      documento: row.documento,
      correo: row.correo,
      telefono: row.telefono,
      passwordHash: row.password_hash,
      proveedorAuth: row.proveedor_auth,
      rol: row.rol,
      bloqueado: row.bloqueado,
      aceptoHabeasData: row.acepto_habeas_data,
      fechaAceptacionHabeasData: row.fecha_aceptacion_habeas_data,
      createdAt: row.created_at,
    });
  }

  toPersistence() {
    const payload = {
      nombre_completo: this.nombreCompleto,
      documento: this.documento,
      correo: this.correo,
      telefono: this.telefono,
      password_hash: this.passwordHash,
      proveedor_auth: this.proveedorAuth,
      rol: this.rol,
      bloqueado: this.bloqueado,
      acepto_habeas_data: this.aceptoHabeasData,
      fecha_aceptacion_habeas_data: this.fechaAceptacionHabeasData,
    };
    if (this.id) {
      payload.id = this.id;
    }
    return payload;
  }

  toPublicJSON() {
    return {
      id: this.id,
      nombreCompleto: this.nombreCompleto,
      documento: this.documento,
      correo: this.correo,
      telefono: this.telefono,
      proveedorAuth: this.proveedorAuth,
      rol: this.rol,
      bloqueado: this.bloqueado,
      aceptoHabeasData: this.aceptoHabeasData,
      fechaAceptacionHabeasData: this.fechaAceptacionHabeasData,
      perfilCompleto: this.perfilDenuncianteCompleto(),
      createdAt: this.createdAt,
    };
  }
}
