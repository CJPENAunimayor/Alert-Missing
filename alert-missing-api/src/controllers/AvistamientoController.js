import { AvistamientoService } from '../services/AvistamientoService.js';
import { obtenerIpCliente } from '../shared/http.js';

export class AvistamientoController {
  constructor(avistamientoService = new AvistamientoService()) {
    this.avistamientoService = avistamientoService;
  }

  reportar = async (req, res, next) => {
    try {
      const fichaId = req.params.fichaId || req.body.fichaId;
      const avistamiento = await this.avistamientoService.reportar(fichaId, req.body, {
        usuarioAutenticado: req.usuario || null,
        ip: obtenerIpCliente(req),
      });

      return res.status(201).json({
        mensaje:
          'Avistamiento registrado exitosamente en estado PENDIENTE de validación por el creador o un administrador.',
        avistamiento,
      });
    } catch (error) {
      return next(error);
    }
  };

  listarPorFicha = async (req, res, next) => {
    try {
      const resultado = await this.avistamientoService.listarPorFicha(req.params.fichaId, {
        usuarioAutenticado: req.usuario || null,
        estado: req.query.estado || null,
      });
      return res.status(200).json(resultado);
    } catch (error) {
      return next(error);
    }
  };

  listarMios = async (req, res, next) => {
    try {
      const resultado = await this.avistamientoService.listarMios(req.usuario.id);
      return res.status(200).json(resultado);
    } catch (error) {
      return next(error);
    }
  };

  aprobar = async (req, res, next) => {
    try {
      const avistamiento = await this.avistamientoService.aprobar(
        req.params.id,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: 'Avistamiento aprobado y publicado en el mapa.',
        avistamiento,
      });
    } catch (error) {
      return next(error);
    }
  };

  descartar = async (req, res, next) => {
    try {
      const resultado = await this.avistamientoService.descartar(
        req.params.id,
        req.body,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: 'Avistamiento descartado y ocultado del mapa público.',
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };
}
