import { AlertaService } from '../services/AlertaService.js';
import { env } from '../shared/env.js';

/**
 * Job periódico que suspende automáticamente las fichas temporales cuyo plazo
 * de 1 día hábil venció sin completar los campos obligatorios del formato SIRDEC.
 */
export class SirdecExpirationJob {
  constructor({
    alertaService = new AlertaService(),
    intervalMs = env.SIRDEC_CHECK_INTERVAL_MS || 5 * 60 * 1000,
  } = {}) {
    this.alertaService = alertaService;
    this.intervalMs = intervalMs;
    this._timer = null;
    this.ultimaEjecucion = null;
    this.totalSuspendidas = 0;
  }

  async ejecutarUnaVez() {
    try {
      const resultado = await this.alertaService.procesarFichasSirdecVencidas();
      this.ultimaEjecucion = new Date().toISOString();
      this.totalSuspendidas += resultado.suspendidas;
      if (resultado.suspendidas > 0) {
        console.log(
          `[SirdecExpirationJob] Suspendidas ${resultado.suspendidas} ficha(s) por vencimiento del plazo SIRDEC.`
        );
      }
      return resultado;
    } catch (error) {
      console.error('[SirdecExpirationJob] Error verificando plazos SIRDEC:', error.message);
      return { revisadas: 0, suspendidas: 0, error: error.message };
    }
  }

  iniciar() {
    if (this._timer) return;
    // Ejecutar una comprobación inicial diferida 10 s y luego periódicamente
    const inicioTimer = setTimeout(() => {
      void this.ejecutarUnaVez();
    }, 10000);
    inicioTimer.unref?.();

    this._timer = setInterval(() => {
      void this.ejecutarUnaVez();
    }, this.intervalMs);
    this._timer.unref?.();
  }

  detener() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  obtenerEstado() {
    return {
      activo: Boolean(this._timer),
      intervalMs: this.intervalMs,
      ultimaEjecucion: this.ultimaEjecucion,
      totalSuspendidas: this.totalSuspendidas,
    };
  }
}

export const sirdecExpirationJobDefault = new SirdecExpirationJob();
