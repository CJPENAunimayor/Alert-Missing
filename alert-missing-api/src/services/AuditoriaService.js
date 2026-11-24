import { RegistroAuditoria } from '../domain/RegistroAuditoria.js';
import { AuditoriaRepo } from '../repositories/AuditoriaRepo.js';

export class AuditoriaService {
  constructor(auditoriaRepo = new AuditoriaRepo()) {
    this.auditoriaRepo = auditoriaRepo;
  }

  /**
   * Registra un evento inmutable en la tabla registros_auditoria.
   * @param {object} params
   * @param {string|null} [params.usuarioId]
   * @param {string} params.accion
   * @param {string} params.entidad
   * @param {string|null} [params.entidadId]
   * @param {string} [params.ip]
   * @param {{ silencioso?: boolean }} [opciones]
   */
  async registrar(
    { usuarioId = null, accion, entidad, entidadId = null, ip = '0.0.0.0' },
    { silencioso = false } = {}
  ) {
    try {
      const registro = new RegistroAuditoria({
        usuarioId,
        accion,
        entidad,
        entidadId,
        ip,
      });
      return await this.auditoriaRepo.crear(registro);
    } catch (error) {
      if (silencioso) {
        console.error('[AuditoriaService] Error no bloqueante al registrar auditoría:', error.message);
        return null;
      }
      throw error;
    }
  }
}
