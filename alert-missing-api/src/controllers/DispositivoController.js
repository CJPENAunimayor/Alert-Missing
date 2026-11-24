import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { DispositivoRepo } from '../repositories/DispositivoRepo.js';
import { AuditoriaService } from '../services/AuditoriaService.js';
import { obtenerIpCliente } from '../shared/http.js';

export class DispositivoController {
  constructor({
    dispositivoRepo = new DispositivoRepo(),
    auditoriaService = new AuditoriaService(),
  } = {}) {
    this.dispositivoRepo = dispositivoRepo;
    this.auditoriaService = auditoriaService;
  }

  suscribir = async (req, res, next) => {
    try {
      const {
        oneSignalId,
        lat = null,
        lng = null,
        permisoNotificaciones = true,
        permisoUbicacion = false,
      } = req.body;

      const dispositivo = await this.dispositivoRepo.suscribir({
        oneSignalId,
        usuarioId: req.usuario?.id ?? null,
        lat,
        lng,
        permisoNotificaciones,
        permisoUbicacion,
      });

      void this.auditoriaService.registrar(
        {
          usuarioId: req.usuario?.id ?? null,
          accion: ACCIONES_AUDITORIA.SUSCRIPCION_DISPOSITIVO,
          entidad: 'DISPOSITIVOS_SUSCRITOS',
          entidadId: dispositivo.oneSignalId,
          ip: obtenerIpCliente(req),
        },
        { silencioso: true }
      );

      return res.status(200).json({
        mensaje: 'Dispositivo suscrito correctamente para alertas geolocalizadas.',
        dispositivo,
      });
    } catch (error) {
      return next(error);
    }
  };
}
