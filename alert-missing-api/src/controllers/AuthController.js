import { AuthService } from '../services/AuthService.js';
import { obtenerIpCliente } from '../shared/http.js';

export class AuthController {
  constructor(authService = new AuthService()) {
    this.authService = authService;
  }

  registrar = async (req, res, next) => {
    try {
      const resultado = await this.authService.registrar(req.body, obtenerIpCliente(req));
      return res.status(201).json({
        mensaje: 'Usuario registrado exitosamente.',
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };

  login = async (req, res, next) => {
    try {
      const resultado = await this.authService.autenticar(req.body, obtenerIpCliente(req));
      return res.status(200).json({
        mensaje: 'Autenticación exitosa.',
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };

  loginGoogle = async (req, res, next) => {
    try {
      const resultado = await this.authService.loginConGoogle(req.body, obtenerIpCliente(req));
      const status = resultado.esNuevoUsuario ? 201 : 200;
      return res.status(status).json({
        mensaje: resultado.esNuevoUsuario
          ? 'Cuenta creada y sincronizada con Google exitosamente.'
          : 'Inicio de sesión con Google exitoso.',
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };

  renovarToken = async (req, res, next) => {
    try {
      const resultado = await this.authService.renovarToken(req.usuario.id, obtenerIpCliente(req));
      return res.status(200).json({
        mensaje: 'Token renovado exitosamente.',
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };

  obtenerPerfil = async (req, res, next) => {
    try {
      const usuario = await this.authService.obtenerPerfil(req.usuario.id);
      return res.status(200).json({ usuario });
    } catch (error) {
      return next(error);
    }
  };

  actualizarPerfil = async (req, res, next) => {
    try {
      const usuario = await this.authService.completarPerfilDenunciante(
        req.usuario.id,
        req.body,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: 'Perfil de denunciante actualizado exitosamente.',
        usuario,
      });
    } catch (error) {
      return next(error);
    }
  };

  logout = async (req, res, next) => {
    try {
      await this.authService.cerrarSesion(req.usuario?.id ?? null, obtenerIpCliente(req));
      return res.status(200).json({
        mensaje: 'Sesión cerrada exitosamente.',
      });
    } catch (error) {
      return next(error);
    }
  };
}
