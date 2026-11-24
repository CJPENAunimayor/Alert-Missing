import jwt from 'jsonwebtoken';
import { ROLES_USUARIO } from '../domain/Usuario.js';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { getSupabaseAuthClient } from '../integrations/supabaseClient.js';
import { UsuarioRepo } from '../repositories/UsuarioRepo.js';
import { AuditoriaService } from '../services/AuditoriaService.js';
import { env } from '../shared/env.js';
import { obtenerIpCliente } from '../shared/http.js';

export function createJwtAuthMiddleware({
  auditoriaService = new AuditoriaService(),
  usuarioRepo = new UsuarioRepo(),
  supabaseAuthClient = null,
} = {}) {
  const getAuthClient = () => supabaseAuthClient || getSupabaseAuthClient();

  /**
   * Verifica un Bearer token contra:
   * 1. JWT_SECRET del API (emisión propia tras /api/auth/google o /api/auth/login)
   * 2. SUPABASE_JWT_SECRET (si está configurado y el cliente envía un JWT de Supabase)
   * 3. Sesión activa en Supabase Auth (respaldo si el token es de Supabase con clave asimétrica)
   */
  async function resolverUsuarioDesdeToken(token) {
    // 1. Verificar JWT emitido por alert-missing-api
    if (env.JWT_SECRET) {
      try {
        const payload = jwt.verify(token, env.JWT_SECRET, {
          issuer: 'alert-missing-api',
        });
        const estado = await usuarioRepo.buscarEstadoAccesoPorId(payload.sub);
        if (!estado) {
          return { error: 'NOT_FOUND' };
        }
        return {
          usuario: {
            id: estado.id,
            correo: estado.correo,
            rol: estado.rol,
            bloqueado: Boolean(estado.bloqueado),
            proveedorAuth: estado.proveedor_auth,
          },
        };
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return { error: 'EXPIRED' };
        }
        // Intentar estrategias de Supabase si la firma no era del API
      }
    }

    // 2. Verificar JWT firmado por Supabase (SUPABASE_JWT_SECRET)
    if (env.SUPABASE_JWT_SECRET) {
      try {
        const payloadSupa = jwt.verify(token, env.SUPABASE_JWT_SECRET);
        if (payloadSupa?.email) {
          const usuario = await usuarioRepo.buscarPorCorreo(payloadSupa.email);
          if (!usuario) {
            return { error: 'NOT_FOUND' };
          }
          return {
            usuario: {
              id: usuario.id,
              correo: usuario.correo,
              rol: usuario.rol,
              bloqueado: usuario.estaBloqueado(),
              proveedorAuth: usuario.proveedorAuth,
            },
          };
        }
      } catch (err) {
        if (err.name === 'TokenExpiredError') {
          return { error: 'EXPIRED' };
        }
      }
    }

    // 3. Respaldo contra Supabase Auth getUser(token) si el cliente envía el access_token de Supabase
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        const { data, error } = await getAuthClient().auth.getUser(token);
        if (!error && data?.user?.email) {
          const usuario = await usuarioRepo.buscarPorCorreo(data.user.email);
          if (!usuario) {
            return { error: 'NOT_FOUND' };
          }
          return {
            usuario: {
              id: usuario.id,
              correo: usuario.correo,
              rol: usuario.rol,
              bloqueado: usuario.estaBloqueado(),
              proveedorAuth: usuario.proveedorAuth,
            },
          };
        }
      } catch {
        // Caer en token inválido
      }
    }

    return { error: 'INVALID' };
  }

  /**
   * Valida el JWT en Authorization: Bearer <token>.
   * - Rechaza tokens faltantes, inválidos o expirados con HTTP 401.
   * - Rechaza usuarios bloqueados con HTTP 403 (<200 ms, CAL-05).
   * - Registra intentos no autorizados en AuditoriaService sin bloquear la respuesta.
   */
  async function validarToken(req, res, next) {
    const ip = obtenerIpCliente(req);
    const authHeader = req.headers?.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      void auditoriaService.registrar(
        {
          usuarioId: null,
          accion: ACCIONES_AUDITORIA.TOKEN_INVALIDO,
          entidad: req.baseUrl || 'AUTH',
          entidadId: req.params?.id ?? null,
          ip,
        },
        { silencioso: true }
      );
      return res.status(401).json({
        error: 'AUTHENTICATION_ERROR',
        mensaje: 'Token de autenticación requerido (Authorization: Bearer <token>).',
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({
        error: 'AUTHENTICATION_ERROR',
        mensaje: 'Token de autenticación vacío.',
      });
    }

    try {
      const resultado = await resolverUsuarioDesdeToken(token);

      if (resultado.error || !resultado.usuario) {
        void auditoriaService.registrar(
          {
            usuarioId: null,
            accion: ACCIONES_AUDITORIA.TOKEN_INVALIDO,
            entidad: req.baseUrl || 'AUTH',
            entidadId: req.params?.id ?? null,
            ip,
          },
          { silencioso: true }
        );

        const mensaje =
          resultado.error === 'EXPIRED'
            ? 'El token de autenticación ha expirado.'
            : 'El token de autenticación no es válido.';

        return res.status(401).json({
          error: 'AUTHENTICATION_ERROR',
          mensaje,
        });
      }

      if (resultado.usuario.bloqueado) {
        void auditoriaService.registrar(
          {
            usuarioId: resultado.usuario.id,
            accion: ACCIONES_AUDITORIA.USUARIO_BLOQUEADO_ACCESO,
            entidad: req.baseUrl || 'AUTH',
            entidadId: req.params?.id ?? resultado.usuario.id,
            ip,
          },
          { silencioso: true }
        );

        return res.status(403).json({
          error: 'FORBIDDEN',
          mensaje: 'Tu cuenta se encuentra bloqueada y no tiene permisos para acceder.',
        });
      }

      req.usuario = {
        id: resultado.usuario.id,
        correo: resultado.usuario.correo,
        rol: resultado.usuario.rol,
        proveedorAuth: resultado.usuario.proveedorAuth,
      };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Intenta validar un JWT si viene en Authorization: Bearer <token>, sin rechazar peticiones anónimas.
   */
  async function validarTokenOpcional(req, _res, next) {
    const authHeader = req.headers?.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      req.usuario = null;
      return next();
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      req.usuario = null;
      return next();
    }

    try {
      const resultado = await resolverUsuarioDesdeToken(token);
      if (resultado.usuario && !resultado.usuario.bloqueado) {
        req.usuario = {
          id: resultado.usuario.id,
          correo: resultado.usuario.correo,
          rol: resultado.usuario.rol,
          proveedorAuth: resultado.usuario.proveedorAuth,
        };
      } else {
        req.usuario = null;
      }
    } catch {
      req.usuario = null;
    }

    return next();
  }

  /**
   * Verifica que el usuario autenticado posea alguno de los roles permitidos.
   * Devuelve HTTP 403 y audita el intento no autorizado.
   */
  function requerirRol(...rolesArgs) {
    const rolesPermitidos = rolesArgs.flat().map((r) => String(r).toUpperCase());

    return (req, res, next) => {
      if (!req.usuario) {
        return res.status(401).json({
          error: 'AUTHENTICATION_ERROR',
          mensaje: 'Debe autenticarse para acceder a este recurso.',
        });
      }

      if (!rolesPermitidos.includes(req.usuario.rol)) {
        void auditoriaService.registrar(
          {
            usuarioId: req.usuario.id,
            accion: ACCIONES_AUDITORIA.ACCESO_NO_AUTORIZADO_ROL,
            entidad: req.baseUrl || 'RECURSO',
            entidadId: req.params?.id ?? null,
            ip: obtenerIpCliente(req),
          },
          { silencioso: true }
        );

        return res.status(403).json({
          error: 'FORBIDDEN',
          mensaje: 'No cuenta con el rol requerido para realizar esta operación.',
        });
      }

      return next();
    };
  }

  /**
   * Verifica que el usuario autenticado sea el propietario del recurso (o administrador, si está habilitado).
   * Devuelve HTTP 403 y audita cualquier intento de acceso indebido.
   */
  function requerirPropietario(obtenerPropietarioId = 'id', opciones = {}) {
    const {
      permitirAdmin = true,
      entidad = 'RECURSO',
      obtenerEntidadId = (req) => req.params?.id ?? null,
    } = opciones;

    return async (req, res, next) => {
      if (!req.usuario) {
        return res.status(401).json({
          error: 'AUTHENTICATION_ERROR',
          mensaje: 'Debe autenticarse para acceder a este recurso.',
        });
      }

      if (permitirAdmin && req.usuario.rol === ROLES_USUARIO.ADMINISTRADOR) {
        return next();
      }

      try {
        const propietarioId =
          typeof obtenerPropietarioId === 'function'
            ? await obtenerPropietarioId(req)
            : req.params?.[obtenerPropietarioId] ?? req.body?.[obtenerPropietarioId] ?? null;

        if (!propietarioId) {
          return res.status(404).json({
            error: 'NOT_FOUND',
            mensaje: 'No se encontró el recurso solicitado.',
          });
        }

        if (String(propietarioId) !== String(req.usuario.id)) {
          void auditoriaService.registrar(
            {
              usuarioId: req.usuario.id,
              accion: ACCIONES_AUDITORIA.ACCESO_NO_AUTORIZADO_PROPIETARIO,
              entidad,
              entidadId: obtenerEntidadId(req),
              ip: obtenerIpCliente(req),
            },
            { silencioso: true }
          );

          return res.status(403).json({
            error: 'FORBIDDEN',
            mensaje: 'No tiene autorización para acceder o modificar un recurso que no le pertenece.',
          });
        }

        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  return {
    validarToken,
    validarTokenOpcional,
    requerirRol,
    requerirPropietario,
  };
}

const defaultJwtMiddleware = createJwtAuthMiddleware();

export const { validarToken, validarTokenOpcional, requerirRol, requerirPropietario } =
  defaultJwtMiddleware;
