import { OneSignalClient } from '../integrations/OneSignalClient.js';
import { CanalAlternoClient } from '../integrations/CanalAlternoClient.js';
import { DispositivoRepo } from '../repositories/DispositivoRepo.js';
import {
  CANALES_NOTIFICACION,
  ESTADOS_NOTIFICACION,
  NotificacionRepo,
  PRIORIDADES_NOTIFICACION,
  TIPOS_NOTIFICACION,
} from '../repositories/NotificacionRepo.js';
import { UsuarioRepo } from '../repositories/UsuarioRepo.js';
import { env } from '../shared/env.js';

/**
 * Cola asíncrona en memoria con prioridad + persistencia en tabla `notificaciones`.
 * Garantiza:
 * - No bloquear la respuesta HTTP al publicar alertas o avistamientos.
 * - Prioridad estricta para Alerta Rosa y avisos de avistamiento (ALTA antes que NORMAL).
 * - Despacho rápido (< 3 s) y fallback automático a Email/SMS ante fallo o ausencia de Push.
 */
export class ColaNotificaciones {
  constructor({
    oneSignalClient = new OneSignalClient(),
    canalAlternoClient = new CanalAlternoClient(),
    dispositivoRepo = new DispositivoRepo(),
    notificacionRepo = new NotificacionRepo(),
    usuarioRepo = new UsuarioRepo(),
    pollIntervalMs = env.WORKER_POLL_INTERVAL_MS || 5000,
    maxReintentos = env.WORKER_MAX_RETRIES || 3,
  } = {}) {
    this.oneSignalClient = oneSignalClient;
    this.canalAlternoClient = canalAlternoClient;
    this.dispositivoRepo = dispositivoRepo;
    this.notificacionRepo = notificacionRepo;
    this.usuarioRepo = usuarioRepo;
    this.pollIntervalMs = pollIntervalMs;
    this.maxReintentos = maxReintentos;

    this._colaAlta = [];
    this._colaNormal = [];
    this._fichasDetenidas = new Set();
    this._procesando = false;
    this._timerPolling = null;

    this.metricas = {
      trabajosEncolados: 0,
      trabajosProcesados: 0,
      trabajosFallidos: 0,
      ultimoDespachoMs: null,
    };
  }

  obtenerEstado() {
    return {
      pendientesAlta: this._colaAlta.length,
      pendientesNormal: this._colaNormal.length,
      procesando: this._procesando,
      pollingActivo: Boolean(this._timerPolling),
      ...this.metricas,
    };
  }

  /**
   * Marca una ficha como cerrada/cancelada para detener cualquier despacho en curso o encolado.
   */
  detenerFicha(fichaId) {
    if (!fichaId) return;
    this._fichasDetenidas.add(fichaId);
    this._colaAlta = this._colaAlta.filter((t) => t.fichaId !== fichaId);
    this._colaNormal = this._colaNormal.filter((t) => t.fichaId !== fichaId);
    void this.notificacionRepo.cancelarEncoladasPorFicha(fichaId).catch(() => {});
  }

  /**
   * Encola un trabajo asíncrono sin bloquear el hilo de respuesta HTTP.
   */
  encolar(trabajo) {
    const prioridad =
      trabajo.prioridad === PRIORIDADES_NOTIFICACION.ALTA
        ? PRIORIDADES_NOTIFICACION.ALTA
        : PRIORIDADES_NOTIFICACION.NORMAL;

    const item = {
      ...trabajo,
      prioridad,
      encoladoEn: Date.now(),
    };

    if (prioridad === PRIORIDADES_NOTIFICACION.ALTA) {
      this._colaAlta.push(item);
    } else {
      this._colaNormal.push(item);
    }

    this.metricas.trabajosEncolados += 1;

    // Despertar el worker en el siguiente tick sin bloquear la respuesta HTTP
    setImmediate(() => {
      void this.procesarSiguiente();
    });

    return { encolado: true, prioridad };
  }

  async procesarSiguiente() {
    if (this._procesando) return;
    this._procesando = true;

    try {
      while (this._colaAlta.length > 0 || this._colaNormal.length > 0) {
        const trabajo =
          this._colaAlta.length > 0 ? this._colaAlta.shift() : this._colaNormal.shift();

        if (!trabajo) break;

        if (trabajo.fichaId && this._fichasDetenidas.has(trabajo.fichaId)) {
          continue;
        }

        const inicio = Date.now();
        try {
          if (trabajo.tipo === TIPOS_NOTIFICACION.ALERTA_ZONA) {
            await this._procesarAlertaZona(trabajo);
          } else if (trabajo.tipo === TIPOS_NOTIFICACION.AVISTAMIENTO) {
            await this._procesarNotificacionAvistamiento(trabajo);
          }
          this.metricas.trabajosProcesados += 1;
          this.metricas.ultimoDespachoMs = Date.now() - inicio;
        } catch (error) {
          this.metricas.trabajosFallidos += 1;
          console.error(`[ColaNotificaciones] Error procesando trabajo ${trabajo.tipo}:`, error.message);
        }
      }
    } finally {
      this._procesando = false;
    }
  }

  async _procesarAlertaZona(trabajo) {
    const { ficha } = trabajo;
    const radioMetros = Math.round((Number(ficha.radioBusquedaKm) || 5) * 1000);
    const lat = ficha.ubicacionUltimoContacto?.lat ?? ficha.lat;
    const lng = ficha.ubicacionUltimoContacto?.lng ?? ficha.lng;

    const dispositivos = await this.dispositivoRepo.buscarEnRadio({
      lat,
      lng,
      radioMetros,
    });

    if (dispositivos.length === 0) {
      return { dispositivosNotificados: 0 };
    }

    const subscriptionIds = dispositivos.map((d) => d.oneSignalId);
    const prioridad = ficha.esAlertaRosa
      ? PRIORIDADES_NOTIFICACION.ALTA
      : PRIORIDADES_NOTIFICACION.NORMAL;

    const titulo = `${ficha.nombreDesaparecido} (${ficha.edad} años)`;
    const mensaje = `Desaparecido cerca de ${
      ficha.direccionTexto || 'tu zona'
    }. Toca para ver foto y reportar si tienes información.`;

    // Persistir en tabla `notificaciones` antes del envío
    const encoladasDb = await this.notificacionRepo
      .encolarLote(
        subscriptionIds.map((idDisp) => ({
          fichaId: ficha.id,
          destinatarioId: idDisp,
          tipo: TIPOS_NOTIFICACION.ALERTA_ZONA,
          canal: CANALES_NOTIFICACION.PUSH,
          prioridad,
          estado: ESTADOS_NOTIFICACION.ENCOLADA,
          payload: { titulo, mensaje, esAlertaRosa: ficha.esAlertaRosa, radioMetros },
        }))
      )
      .catch(() => []);

    try {
      const resultado = await this.oneSignalClient.enviarPorLotes({
        subscriptionIds,
        titulo,
        mensaje,
        esAlertaRosa: Boolean(ficha.esAlertaRosa),
        prioridad,
        datos: {
          tipo: TIPOS_NOTIFICACION.ALERTA_ZONA,
          fichaId: ficha.id,
        },
      });

      const falloTotal = resultado.enviados === 0 && resultado.fallidos > 0;
      for (const reg of encoladasDb) {
        if (falloTotal) {
          await this.notificacionRepo
            .marcarFallida(reg.id, {
              intentosActuales: reg.intentos,
              maxIntentos: this.maxReintentos,
              errorDetalle: 'Fallo en envío de lote OneSignal',
            })
            .catch(() => {});
        } else {
          await this.notificacionRepo.marcarEnviada(reg.id, reg.intentos).catch(() => {});
        }
      }

      return resultado;
    } catch (error) {
      for (const reg of encoladasDb) {
        await this.notificacionRepo
          .marcarFallida(reg.id, {
            intentosActuales: reg.intentos,
            maxIntentos: this.maxReintentos,
            errorDetalle: error.message,
          })
          .catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Notifica de inmediato al creador de la ficha sobre un nuevo avistamiento.
   * Si Push falla o el creador no tiene dispositivos suscritos, dispara respaldo por Email y/o SMS.
   */
  async _procesarNotificacionAvistamiento(trabajo) {
    const { ficha, avistamiento } = trabajo;
    const creador = await this.usuarioRepo.buscarPorId(ficha.creadorId);
    if (!creador) return;

    const dispositivos = await this.dispositivoRepo.buscarPorUsuarioId(creador.id);
    const subscriptionIds = dispositivos.map((d) => d.oneSignalId);

    const titulo = `Nuevo avistamiento: ${ficha.nombreDesaparecido}`;
    const mensaje = `Se reportó un posible avistamiento para ${ficha.nombreDesaparecido}. Ingresa a Alert Missing para revisarlo y aprobarlo o descartarlo.`;

    let pushExitoso = false;

    if (subscriptionIds.length > 0) {
      const registrosPush = await this.notificacionRepo
        .encolarLote(
          subscriptionIds.map((idDisp) => ({
            fichaId: ficha.id,
            avistamientoId: avistamiento.id,
            destinatarioId: idDisp,
            tipo: TIPOS_NOTIFICACION.AVISTAMIENTO,
            canal: CANALES_NOTIFICACION.PUSH,
            prioridad: PRIORIDADES_NOTIFICACION.ALTA,
            payload: { titulo, mensaje },
          }))
        )
        .catch(() => []);

      try {
        const resPush = await this.oneSignalClient.enviarPorLotes({
          subscriptionIds,
          titulo,
          mensaje,
          esAlertaRosa: Boolean(ficha.esAlertaRosa),
          prioridad: PRIORIDADES_NOTIFICACION.ALTA,
          datos: {
            tipo: TIPOS_NOTIFICACION.AVISTAMIENTO,
            fichaId: ficha.id,
            avistamientoId: avistamiento.id,
          },
        });

        pushExitoso = resPush.enviados > 0;
        for (const reg of registrosPush) {
          if (pushExitoso) {
            await this.notificacionRepo.marcarEnviada(reg.id, reg.intentos).catch(() => {});
          } else {
            await this.notificacionRepo
              .marcarFallida(reg.id, {
                intentosActuales: reg.intentos,
                maxIntentos: this.maxReintentos,
                errorDetalle: 'OneSignal no confirmó entregas',
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        pushExitoso = false;
        for (const reg of registrosPush) {
          await this.notificacionRepo
            .marcarFallida(reg.id, {
              intentosActuales: reg.intentos,
              maxIntentos: this.maxReintentos,
              errorDetalle: err.message,
            })
            .catch(() => {});
        }
      }
    }

    // Respaldo automático por Email y/o SMS si Push falló o no hay suscripción activa
    if (!pushExitoso) {
      await this._enviarRespaldoCreador({ creador, ficha, avistamiento, titulo, mensaje });
    }
  }

  async _enviarRespaldoCreador({ creador, ficha, avistamiento, titulo, mensaje }) {
    const detalleTexto = [
      mensaje,
      '',
      `Descripción reportada: ${avistamiento.descripcion}`,
      `Fecha/hora del avistamiento: ${avistamiento.fechaHora}`,
      `Coordenadas: ${avistamiento.coordenadas?.lat ?? avistamiento.lat}, ${
        avistamiento.coordenadas?.lng ?? avistamiento.lng
      }`,
      '',
      'Recuerda: Líneas de emergencia 123 (Policía), 122 (Fiscalía) y 141 (ICBF).',
    ].join('\n');

    if (creador.correo) {
      const [regEmail] = await this.notificacionRepo
        .encolarLote([
          {
            fichaId: ficha.id,
            avistamientoId: avistamiento.id,
            destinatarioId: creador.correo,
            tipo: TIPOS_NOTIFICACION.AVISTAMIENTO,
            canal: CANALES_NOTIFICACION.EMAIL,
            prioridad: PRIORIDADES_NOTIFICACION.ALTA,
            payload: { asunto: titulo, respaldoDePush: true },
          },
        ])
        .catch(() => []);

      try {
        await this.canalAlternoClient.enviarEmail({
          destinatario: creador.correo,
          asunto: `[Alert Missing] ${titulo}`,
          texto: detalleTexto,
        });
        if (regEmail) {
          await this.notificacionRepo.marcarEnviada(regEmail.id, regEmail.intentos).catch(() => {});
        }
      } catch (err) {
        if (regEmail) {
          await this.notificacionRepo
            .marcarFallida(regEmail.id, {
              intentosActuales: regEmail.intentos,
              maxIntentos: this.maxReintentos,
              errorDetalle: err.message,
            })
            .catch(() => {});
        }
      }
    }

    if (creador.telefono) {
      const [regSms] = await this.notificacionRepo
        .encolarLote([
          {
            fichaId: ficha.id,
            avistamientoId: avistamiento.id,
            destinatarioId: creador.telefono,
            tipo: TIPOS_NOTIFICACION.AVISTAMIENTO,
            canal: CANALES_NOTIFICACION.SMS,
            prioridad: PRIORIDADES_NOTIFICACION.ALTA,
            payload: { respaldoDePush: true },
          },
        ])
        .catch(() => []);

      try {
        await this.canalAlternoClient.enviarSms({
          telefono: creador.telefono,
          mensaje: `Alert Missing: ${titulo}. Revisa el reporte en la plataforma.`,
        });
        if (regSms) {
          await this.notificacionRepo.marcarEnviada(regSms.id, regSms.intentos).catch(() => {});
        }
      } catch (err) {
        if (regSms) {
          await this.notificacionRepo
            .marcarFallida(regSms.id, {
              intentosActuales: regSms.intentos,
              maxIntentos: this.maxReintentos,
              errorDetalle: err.message,
            })
            .catch(() => {});
        }
      }
    }
  }

  /**
   * Reintenta notificaciones persistidas en BD en estado ENCOLADA (modo worker dedicado).
   */
  async procesarPendientesEnBd() {
    const pendientes = await this.notificacionRepo.obtenerEncoladas({
      limite: env.WORKER_BATCH_SIZE || 20,
      maxIntentos: this.maxReintentos,
    });

    for (const reg of pendientes) {
      if (reg.canal === CANALES_NOTIFICACION.PUSH) {
        try {
          await this.oneSignalClient.enviarPorLotes({
            subscriptionIds: [reg.destinatario_id],
            titulo: reg.payload?.titulo || 'Actualización Alert Missing',
            mensaje: reg.payload?.mensaje || 'Revisa la alerta en Alert Missing.',
            esAlertaRosa: Boolean(reg.payload?.esAlertaRosa),
            prioridad: reg.prioridad,
            datos: { fichaId: reg.ficha_id, avistamientoId: reg.avistamiento_id },
          });
          await this.notificacionRepo.marcarEnviada(reg.id, reg.intentos);
        } catch (err) {
          await this.notificacionRepo.marcarFallida(reg.id, {
            intentosActuales: reg.intentos,
            maxIntentos: this.maxReintentos,
            errorDetalle: err.message,
          });
        }
      } else if (reg.canal === CANALES_NOTIFICACION.EMAIL) {
        try {
          await this.canalAlternoClient.enviarEmail({
            destinatario: reg.destinatario_id,
            asunto: reg.payload?.asunto || '[Alert Missing] Notificación de búsqueda',
            texto: reg.payload?.mensaje || 'Tienes una nueva actualización en Alert Missing.',
          });
          await this.notificacionRepo.marcarEnviada(reg.id, reg.intentos);
        } catch (err) {
          await this.notificacionRepo.marcarFallida(reg.id, {
            intentosActuales: reg.intentos,
            maxIntentos: this.maxReintentos,
            errorDetalle: err.message,
          });
        }
      }
    }

    return pendientes.length;
  }

  iniciarPolling() {
    if (this._timerPolling) return;
    this._timerPolling = setInterval(() => {
      void this.procesarPendientesEnBd().catch((err) => {
        console.error('[ColaNotificaciones] Error en ciclo de polling:', err.message);
      });
    }, this.pollIntervalMs);
    this._timerPolling.unref?.();
  }

  detenerPolling() {
    if (this._timerPolling) {
      clearInterval(this._timerPolling);
      this._timerPolling = null;
    }
  }
}

export const colaNotificacionesDefault = new ColaNotificaciones();
