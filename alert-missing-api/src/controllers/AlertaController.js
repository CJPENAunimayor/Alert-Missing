import { AlertaService } from '../services/AlertaService.js';
import { SirdecExportService } from '../services/SirdecExportService.js';
import { obtenerIpCliente } from '../shared/http.js';

export class AlertaController {
  constructor({
    alertaService = new AlertaService(),
    sirdecExportService = new SirdecExportService(),
  } = {}) {
    this.alertaService = alertaService;
    this.sirdecExportService = sirdecExportService;
  }

  crearFicha = async (req, res, next) => {
    try {
      const ficha = await this.alertaService.crearFicha(
        req.body,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(201).json({
        mensaje: ficha.sirdecCompletado
          ? 'Ficha de búsqueda publicada con formato SIRDEC completo.'
          : 'Alerta publicada temporalmente. Tienes 1 día hábil para completar el formato SIRDEC obligatorio.',
        ficha,
      });
    } catch (error) {
      return next(error);
    }
  };

  listarActivas = async (req, res, next) => {
    try {
      const resultado = await this.alertaService.listarActivas(req.query);
      return res.status(200).json(resultado);
    } catch (error) {
      return next(error);
    }
  };

  listarMias = async (req, res, next) => {
    try {
      const resultado = await this.alertaService.listarMias(req.usuario.id);
      return res.status(200).json(resultado);
    } catch (error) {
      return next(error);
    }
  };

  obtenerPorId = async (req, res, next) => {
    try {
      const ficha = await this.alertaService.obtenerPorId(req.params.id);
      return res.status(200).json({ ficha });
    } catch (error) {
      return next(error);
    }
  };

  actualizarAlertaRosa = async (req, res, next) => {
    try {
      const ficha = await this.alertaService.actualizarAlertaRosa(
        req.params.id,
        req.body,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: ficha.esAlertaRosa
          ? 'Alerta Rosa activada exitosamente.'
          : 'Alerta Rosa desactivada exitosamente.',
        ficha,
      });
    } catch (error) {
      return next(error);
    }
  };

  cerrarAlerta = async (req, res, next) => {
    try {
      const ficha = await this.alertaService.cerrarAlerta(
        req.params.id,
        req.body,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: 'Alerta cerrada como LOCALIZADA y difusión detenida exitosamente.',
        ficha,
      });
    } catch (error) {
      return next(error);
    }
  };

  cancelarAlerta = async (req, res, next) => {
    try {
      const ficha = await this.alertaService.cancelarAlerta(
        req.params.id,
        req.body,
        req.usuario,
        obtenerIpCliente(req)
      );
      return res.status(200).json({
        mensaje: 'Alerta cancelada y retirada del mapa público exitosamente.',
        ficha,
      });
    } catch (error) {
      return next(error);
    }
  };

  exportarSirdec = async (req, res, next) => {
    try {
      const formato = String(req.query.formato || 'json').toLowerCase();
      const contexto = {
        usuarioId: req.usuario?.id ?? null,
        ip: obtenerIpCliente(req),
      };

      if (formato === 'pdf') {
        const { buffer, nombreArchivo } = await this.sirdecExportService.exportarPdf(
          req.params.id,
          contexto
        );
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.setHeader('Content-Length', String(buffer.length));
        return res.status(200).send(buffer);
      }

      const fichaSirdec = await this.sirdecExportService.exportarJson(req.params.id, contexto);
      return res.status(200).json(fichaSirdec);
    } catch (error) {
      return next(error);
    }
  };

  actualizarDatosSirdec = async (req, res, next) => {
    try {
      const resultado = await this.alertaService.actualizarDatosSirdec(
        req.params.id,
        req.body.datosSirdec,
        req.usuario,
        obtenerIpCliente(req)
      );

      const mensaje = resultado.reactivada
        ? 'Formato SIRDEC completado. La alerta fue reactivada y vuelve a estar visible en el mapa público.'
        : resultado.sirdec.completo
          ? 'Formato SIRDEC obligatorio completado. Tu alerta pasó a registro definitivo.'
          : `Avance SIRDEC guardado (${resultado.sirdec.completadosObligatorios}/${resultado.sirdec.totalObligatorios} campos obligatorios). Completa los restantes antes de la fecha límite.`;

      return res.status(200).json({
        mensaje,
        ...resultado,
      });
    } catch (error) {
      return next(error);
    }
  };
}
