import {
  colaNotificacionesDefault,
} from '../jobs/ColaNotificaciones.js';
import {
  PRIORIDADES_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../repositories/NotificacionRepo.js';

export class NotificacionService {
  constructor(colaNotificaciones = colaNotificacionesDefault) {
    this.cola = colaNotificaciones;
  }

  /**
   * Encola la difusión por zona al publicar una ficha activa sin bloquear la respuesta HTTP.
   * Prioriza Alerta Rosa (prioridad ALTA).
   */
  encolarDifusionZona(ficha) {
    if (!ficha || ficha.estado !== 'ACTIVA') {
      return { encolado: false };
    }

    return this.cola.encolar({
      tipo: TIPOS_NOTIFICACION.ALERTA_ZONA,
      fichaId: ficha.id,
      ficha,
      prioridad: ficha.esAlertaRosa
        ? PRIORIDADES_NOTIFICACION.ALTA
        : PRIORIDADES_NOTIFICACION.NORMAL,
    });
  }

  /**
   * Notifica de inmediato al creador de la ficha cuando se registra un nuevo avistamiento.
   * Usa Push y, si falla o no hay suscripción activa, aplica respaldo automático por Email/SMS.
   */
  notificarAvistamientoACreador({ ficha, avistamiento }) {
    if (!ficha || !avistamiento) {
      return { encolado: false };
    }

    return this.cola.encolar({
      tipo: TIPOS_NOTIFICACION.AVISTAMIENTO,
      fichaId: ficha.id,
      avistamientoId: avistamiento.id,
      ficha,
      avistamiento,
      prioridad: PRIORIDADES_NOTIFICACION.ALTA,
    });
  }

  /**
   * Detiene la difusión pendiente cuando una alerta es cerrada (LOCALIZADA) o cancelada (CANCELADA).
   */
  detenerDifusionFicha(fichaId) {
    this.cola.detenerFicha(fichaId);
  }

  obtenerEstadoCola() {
    return this.cola.obtenerEstado();
  }
}
