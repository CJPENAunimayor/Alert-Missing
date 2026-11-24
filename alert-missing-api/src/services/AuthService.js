import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  PROVEEDORES_AUTH,
  ROLES_USUARIO,
  Usuario,
  normalizarCorreo,
  validarDocumento,
  validarNombreCompleto,
  validarPasswordPlana,
  validarTelefono,
} from '../domain/Usuario.js';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { getSupabaseAuthClient } from '../integrations/supabaseClient.js';
import { UsuarioRepo } from '../repositories/UsuarioRepo.js';
import { AuditoriaService } from './AuditoriaService.js';
import { env } from '../shared/env.js';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../shared/errors.js';

function extraerNombreSeguro(googleUser, supabaseUser, correo) {
  const candidato =
    googleUser?.user_metadata?.full_name ||
    googleUser?.user_metadata?.name ||
    supabaseUser?.user_metadata?.full_name ||
    supabaseUser?.user_metadata?.name ||
    correo.split('@')[0];

  const limpio = String(candidato || '')
    .replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return limpio.length >= 3 ? limpio.slice(0, 120) : 'Usuario Alert Missing';
}

export class AuthService {
  constructor({
    usuarioRepo = new UsuarioRepo(),
    auditoriaService = new AuditoriaService(),
    supabaseAuthClient = null,
  } = {}) {
    this.usuarioRepo = usuarioRepo;
    this.auditoriaService = auditoriaService;
    this._supabaseAuthClient = supabaseAuthClient;
  }

  get supabaseAuthClient() {
    return this._supabaseAuthClient || getSupabaseAuthClient();
  }

  _emitirJwt(usuario) {
    if (!env.JWT_SECRET) {
      throw new AppError('JWT_SECRET no está configurado en el servidor.', { statusCode: 500 });
    }

    const payload = {
      sub: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      proveedorAuth: usuario.proveedorAuth,
      jti: crypto.randomUUID(),
    };

    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: 'alert-missing-api',
    });

    return {
      token,
      expiresIn: env.JWT_EXPIRES_IN,
    };
  }

  /**
   * Registro de usuario local con cifrado bcrypt y cumplimiento de Ley 1581 de 2012 (Hábeas Data).
   */
  async registrar(datos, ip = '0.0.0.0') {
    if (datos.aceptoHabeasData !== true) {
      throw new ValidationError(
        'Debe aceptar explícitamente la Política de Tratamiento de Datos Personales (Ley 1581 de 2012 - Hábeas Data) para registrarse.'
      );
    }

    const nombreCompleto = validarNombreCompleto(datos.nombreCompleto);
    const correo = normalizarCorreo(datos.correo);
    const documento = validarDocumento(datos.documento, { obligatorio: true });
    const telefono = validarTelefono(datos.telefono, { obligatorio: true });
    validarPasswordPlana(datos.password);

    const [existenteCorreo, existenteDocumento] = await Promise.all([
      this.usuarioRepo.buscarPorCorreo(correo),
      this.usuarioRepo.buscarPorDocumento(documento),
    ]);

    if (existenteCorreo) {
      throw new ConflictError('El correo electrónico ya se encuentra registrado.');
    }
    if (existenteDocumento) {
      throw new ConflictError('El número de documento ya se encuentra registrado.');
    }

    const passwordHash = await bcrypt.hash(datos.password, env.BCRYPT_SALT_ROUNDS);
    const fechaAceptacion = new Date().toISOString();

    const nuevoUsuario = new Usuario({
      nombreCompleto,
      documento,
      correo,
      telefono,
      passwordHash,
      proveedorAuth: PROVEEDORES_AUTH.LOCAL,
      rol: ROLES_USUARIO.USUARIO,
      bloqueado: false,
      aceptoHabeasData: true,
      fechaAceptacionHabeasData: fechaAceptacion,
    });

    const usuarioCreado = await this.usuarioRepo.crear(nuevoUsuario);

    await Promise.all([
      this.auditoriaService.registrar(
        {
          usuarioId: usuarioCreado.id,
          accion: ACCIONES_AUDITORIA.ACEPTACION_HABEAS_DATA,
          entidad: 'USUARIOS',
          entidadId: usuarioCreado.id,
          ip,
        },
        { silencioso: true }
      ),
      this.auditoriaService.registrar(
        {
          usuarioId: usuarioCreado.id,
          accion: ACCIONES_AUDITORIA.REGISTRO_USUARIO,
          entidad: 'USUARIOS',
          entidadId: usuarioCreado.id,
          ip,
        },
        { silencioso: true }
      ),
    ]);

    const { token, expiresIn } = this._emitirJwt(usuarioCreado);

    return {
      usuario: usuarioCreado.toPublicJSON(),
      token,
      expiresIn,
    };
  }

  /**
   * Autenticación local con verificación bcrypt y emisión de JWT con expiración.
   */
  async autenticar({ correo, password }, ip = '0.0.0.0') {
    const correoNormalizado = normalizarCorreo(correo);
    if (typeof password !== 'string' || password.length === 0) {
      throw new ValidationError('La contraseña es obligatoria.');
    }

    const usuario = await this.usuarioRepo.buscarPorCorreo(correoNormalizado);

    if (!usuario || usuario.proveedorAuth !== PROVEEDORES_AUTH.LOCAL || !usuario.passwordHash) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuario?.id ?? null,
          accion: ACCIONES_AUDITORIA.LOGIN_FALLIDO,
          entidad: 'AUTH',
          entidadId: correoNormalizado,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthenticationError('Correo o contraseña inválidos.');
    }

    if (usuario.estaBloqueado()) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCIONES_AUDITORIA.LOGIN_BLOQUEADO,
          entidad: 'AUTH',
          entidadId: usuario.id,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthorizationError('Tu cuenta se encuentra bloqueada. Contacta al administrador.');
    }

    const passwordValida = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValida) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCIONES_AUDITORIA.LOGIN_FALLIDO,
          entidad: 'AUTH',
          entidadId: usuario.id,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthenticationError('Correo o contraseña inválidos.');
    }

    const { token, expiresIn } = this._emitirJwt(usuario);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuario.id,
        accion: ACCIONES_AUDITORIA.LOGIN_EXITOSO,
        entidad: 'AUTH',
        entidadId: usuario.id,
        ip,
      },
      { silencioso: true }
    );

    return {
      usuario: usuario.toPublicJSON(),
      token,
      expiresIn,
    };
  }

  /**
   * Autenticación con Google OAuth vía Supabase Auth:
   * - Verifica criptográficamente el accessToken de sesión contra Supabase Auth.
   * - Crea el usuario en PostgreSQL (`proveedor_auth = 'GOOGLE'`) si es su primer ingreso.
   * - Verifica que `bloqueado` no sea `true` (HTTP 403 si está bloqueado).
   * - Emite JWT de Alert Missing API y devuelve el perfil sincronizado.
   */
  async loginConGoogle({ accessToken, supabaseUser = null, aceptoHabeasData = false }, ip = '0.0.0.0') {
    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      throw new ValidationError('El token de sesión de Google (Supabase Auth) es obligatorio.');
    }

    const { data, error } = await this.supabaseAuthClient.auth.getUser(accessToken.trim());
    if (error || !data?.user?.email) {
      await this.auditoriaService.registrar(
        {
          usuarioId: null,
          accion: ACCIONES_AUDITORIA.LOGIN_FALLIDO,
          entidad: 'AUTH_GOOGLE',
          entidadId: supabaseUser?.email || null,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthenticationError(
        'No se pudo validar tu sesión con Google en Supabase. Intenta iniciar sesión nuevamente.'
      );
    }

    const googleUser = data.user;
    const correo = normalizarCorreo(googleUser.email);
    let usuario = await this.usuarioRepo.buscarPorCorreo(correo);
    let esNuevoUsuario = false;

    if (!usuario) {
      const nombreSeguro = extraerNombreSeguro(googleUser, supabaseUser, correo);
      const habeasAceptado = aceptoHabeasData === true;

      const nuevoUsuario = new Usuario({
        nombreCompleto: nombreSeguro,
        documento: null,
        correo,
        telefono: null,
        passwordHash: null,
        proveedorAuth: PROVEEDORES_AUTH.GOOGLE,
        rol: ROLES_USUARIO.USUARIO,
        bloqueado: false,
        aceptoHabeasData: habeasAceptado,
        fechaAceptacionHabeasData: habeasAceptado ? new Date().toISOString() : null,
      });

      usuario = await this.usuarioRepo.crear(nuevoUsuario);
      esNuevoUsuario = true;

      await this.auditoriaService.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCIONES_AUDITORIA.REGISTRO_USUARIO,
          entidad: 'USUARIOS',
          entidadId: usuario.id,
          ip,
        },
        { silencioso: true }
      );

      if (habeasAceptado) {
        await this.auditoriaService.registrar(
          {
            usuarioId: usuario.id,
            accion: ACCIONES_AUDITORIA.ACEPTACION_HABEAS_DATA,
            entidad: 'USUARIOS',
            entidadId: usuario.id,
            ip,
          },
          { silencioso: true }
        );
      }
    }

    if (usuario.estaBloqueado()) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCIONES_AUDITORIA.LOGIN_BLOQUEADO,
          entidad: 'AUTH_GOOGLE',
          entidadId: usuario.id,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthorizationError('Tu cuenta se encuentra bloqueada. Contacta al administrador.');
    }

    const { token, expiresIn } = this._emitirJwt(usuario);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuario.id,
        accion: ACCIONES_AUDITORIA.LOGIN_GOOGLE,
        entidad: 'AUTH',
        entidadId: usuario.id,
        ip,
      },
      { silencioso: true }
    );

    return {
      usuario: usuario.toPublicJSON(),
      token,
      expiresIn,
      esNuevoUsuario,
    };
  }

  /**
   * Alias retrocompatible con Fase 1.
   */
  async autenticarConGoogle(datos, ip = '0.0.0.0') {
    return this.loginConGoogle(datos, ip);
  }

  /**
   * Renueva el JWT verificando que la cuenta siga vigente y no haya sido bloqueada.
   */
  async renovarToken(usuarioId, ip = '0.0.0.0') {
    const usuario = await this.usuarioRepo.buscarPorId(usuarioId);
    if (!usuario) {
      throw new AuthenticationError('La cuenta asociada al token ya no existe.');
    }

    if (usuario.estaBloqueado()) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCIONES_AUDITORIA.LOGIN_BLOQUEADO,
          entidad: 'AUTH',
          entidadId: usuario.id,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthorizationError('Tu cuenta se encuentra bloqueada.');
    }

    const { token, expiresIn } = this._emitirJwt(usuario);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuario.id,
        accion: ACCIONES_AUDITORIA.RENOVACION_TOKEN,
        entidad: 'AUTH',
        entidadId: usuario.id,
        ip,
      },
      { silencioso: true }
    );

    return {
      usuario: usuario.toPublicJSON(),
      token,
      expiresIn,
    };
  }

  /**
   * Obtiene el perfil público del usuario autenticado.
   */
  async obtenerPerfil(usuarioId) {
    const usuario = await this.usuarioRepo.buscarPorId(usuarioId);
    if (!usuario) {
      throw new NotFoundError('Usuario no encontrado.');
    }
    return usuario.toPublicJSON();
  }

  /**
   * RF-01: Completa o actualiza los datos personales del denunciante tras ingresar con Google o cuenta local,
   * validando formatos (nombre, documento, teléfono) y aceptación de Ley 1581 de 2012 (Hábeas Data).
   */
  async completarPerfilDenunciante(usuarioId, datos, ip = '0.0.0.0') {
    const usuarioActual = await this.usuarioRepo.buscarPorId(usuarioId);
    if (!usuarioActual) {
      throw new NotFoundError('Usuario no encontrado.');
    }
    if (usuarioActual.estaBloqueado()) {
      throw new AuthorizationError('Tu cuenta se encuentra bloqueada.');
    }

    // Cumplimiento Ley 1581 de 2012 (Hábeas Data): obligatorio si aún no la había aceptado
    const aceptacionReciente = datos.aceptoHabeasData === true;
    if (!usuarioActual.aceptoHabeasData && !aceptacionReciente) {
      throw new ValidationError(
        'Debe aceptar explícitamente el tratamiento de datos personales (Ley 1581 de 2012 - Hábeas Data) para completar su perfil.'
      );
    }

    const cambios = {};

    if (datos.nombreCompleto !== undefined) {
      cambios.nombreCompleto = validarNombreCompleto(datos.nombreCompleto);
    }

    if (datos.telefono !== undefined) {
      cambios.telefono = validarTelefono(datos.telefono, { obligatorio: true });
    }

    if (datos.documento !== undefined) {
      const nuevoDoc = validarDocumento(datos.documento, { obligatorio: true });
      if (nuevoDoc && nuevoDoc !== usuarioActual.documento) {
        const propietarioDoc = await this.usuarioRepo.buscarPorDocumento(nuevoDoc);
        if (propietarioDoc && propietarioDoc.id !== usuarioActual.id) {
          throw new ConflictError('El número de documento ya está asociado a otro usuario.');
        }
      }
      cambios.documento = nuevoDoc;
    }

    if (aceptacionReciente && !usuarioActual.aceptoHabeasData) {
      cambios.aceptoHabeasData = true;
      cambios.fechaAceptacionHabeasData = new Date().toISOString();
    }

    if (datos.passwordNueva !== undefined) {
      if (usuarioActual.proveedorAuth !== PROVEEDORES_AUTH.LOCAL) {
        throw new ValidationError(
          'Las cuentas vinculadas con Google no requieren contraseña local.'
        );
      }
      if (!datos.passwordActual) {
        throw new ValidationError('Debe ingresar su contraseña actual para cambiarla.');
      }
      const coincide = await bcrypt.compare(datos.passwordActual, usuarioActual.passwordHash);
      if (!coincide) {
        throw new AuthenticationError('La contraseña actual es incorrecta.');
      }
      validarPasswordPlana(datos.passwordNueva);
      cambios.passwordHash = await bcrypt.hash(datos.passwordNueva, env.BCRYPT_SALT_ROUNDS);
    }

    if (Object.keys(cambios).length === 0) {
      throw new ValidationError('Debe proporcionar al menos un campo válido para actualizar.');
    }

    const usuarioActualizado = await this.usuarioRepo.actualizar(usuarioId, cambios);

    if (cambios.aceptoHabeasData === true) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuarioActualizado.id,
          accion: ACCIONES_AUDITORIA.ACEPTACION_HABEAS_DATA,
          entidad: 'USUARIOS',
          entidadId: usuarioActualizado.id,
          ip,
        },
        { silencioso: true }
      );
    }

    await this.auditoriaService.registrar(
      {
        usuarioId: usuarioActualizado.id,
        accion: ACCIONES_AUDITORIA.ACTUALIZACION_PERFIL,
        entidad: 'USUARIOS',
        entidadId: usuarioActualizado.id,
        ip,
      },
      { silencioso: true }
    );

    return usuarioActualizado.toPublicJSON();
  }

  /**
   * Alias retrocompatible con Fase 1.
   */
  async actualizarPerfil(usuarioId, datos, ip = '0.0.0.0') {
    return this.completarPerfilDenunciante(usuarioId, datos, ip);
  }

  /**
   * Registra cierre de sesión en la bitácora inmutable de auditoría.
   */
  async cerrarSesion(usuarioId, ip = '0.0.0.0') {
    if (usuarioId) {
      await this.auditoriaService.registrar(
        {
          usuarioId,
          accion: ACCIONES_AUDITORIA.LOGOUT,
          entidad: 'AUTH',
          entidadId: usuarioId,
          ip,
        },
        { silencioso: true }
      );
    }
    return { cerrado: true };
  }
}
