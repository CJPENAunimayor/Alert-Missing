import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { AppError } from '../shared/errors.js';

const TABLA_NOTIFICACIONES = 'notificaciones';

export const TIPOS_NOTIFICACION = Object.freeze({
  ALERTA_ZONA: 'ALERTA_ZONA',
  AVISTAMIENTO: 'AVISTAMIENTO',
});

export const CANALES_NOTIFICACION = Object.freeze({
  PUSH: 'PUSH',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
});

export const PRIORIDADES_NOTIFICACION = Object.freeze({
  ALTA: 'ALTA',
  NORMAL: 'NORMAL',
});

export const ESTADOS_NOTIFICACION = Object.freeze({
  ENCOLADA: 'ENCOLADA',
  ENVIADA: 'ENVIADA',
  FALLIDA: 'FALLIDA',
});

export class NotificacionRepo {
  constructor(supabaseClient = null) {
    this._client = supabaseClient;
  }

  get client() {
    return this._client || getSupabaseAdminClient();
  }

  /**
   * Encola una o múltiples notificaciones en la tabla `notificaciones`.
   */
  async encolarLote(registros) {
    if (!Array.isArray(registros) || registros.length === 0) return [];

    const filas = registros.map((r) => ({
      ficha_id: r.fichaId || null,
      avistamiento_id: r.avistamientoId || null,
      destinatario_id: String(r.destinatarioId),
      tipo: r.tipo,
      canal: r.canal,
      prioridad: r.prioridad || PRIORIDADES_NOTIFICACION.NORMAL,
      estado: r.estado || ESTADOS_NOTIFICACION.ENCOLADA,
      intentos: Number(r.intentos ?? 0),
      payload: r.payload || {},
      fecha_envio: r.fechaEnvio || null,
    }));

    const { data, error } = await this.client
      .from(TABLA_NOTIFICACIONES)
      .insert(filas)
      .select('*');

    if (error) {
      throw new AppError(`Error al encolar notificaciones: ${error.message}`, { statusCode: 500 });
    }

    return data || [];
  }

  /**
   * Obtiene notificaciones encoladas priorizando prioridad='ALTA' antes que 'NORMAL'.
   */
  async obtenerEncoladas({ limite = 20, maxIntentos = 3 } = {}) {
    const { data, error } = await this.client
      .from(TABLA_NOTIFICACIONES)
      .select('*')
      .eq('estado', ESTADOS_NOTIFICACION.ENCOLADA)
      .lt('intentos', maxIntentos)
      .order('prioridad', { ascending: true }) // 'ALTA' < 'NORMAL'
      .limit(limite);

    if (error) {
      throw new AppError(`Error al consultar cola de notificaciones: ${error.message}`, {
        statusCode: 500,
      });
    }

    return data || [];
  }

  async marcarEnviada(id, intentosActuales = 0) {
    const { error } = await this.client
      .from(TABLA_NOTIFICACIONES)
      .update({
        estado: ESTADOS_NOTIFICACION.ENVIADA,
        intentos: Number(intentosActuales) + 1,
        fecha_envio: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      throw new AppError(`Error al marcar notificación como enviada: ${error.message}`, {
        statusCode: 500,
      });
    }
  }

  async marcarFallida(id, { intentosActuales = 0, maxIntentos = 3, errorDetalle = '' } = {}) {
    const nuevoIntento = Number(intentosActuales) + 1;
    const estadoFinal =
      nuevoIntento >= maxIntentos
        ? ESTADOS_NOTIFICACION.FALLIDA
        : ESTADOS_NOTIFICACION.ENCOLADA;

    const { error } = await this.client
      .from(TABLA_NOTIFICACIONES)
      .update({
        estado: estadoFinal,
        intentos: nuevoIntento,
        payload: {
          ultimoError: String(errorDetalle || 'Fallo de envío').slice(0, 300),
          ultimoIntentoEn: new Date().toISOString(),
        },
      })
      .eq('id', id);

    if (error) {
      throw new AppError(`Error al actualizar fallo de notificación: ${error.message}`, {
        statusCode: 500,
      });
    }
  }

  /**
   * Detiene la difusión de notificaciones de zona aún encoladas cuando la ficha se cierra o cancela.
   */
  async cancelarEncoladasPorFicha(fichaId) {
    const { error } = await this.client
      .from(TABLA_NOTIFICACIONES)
      .update({
        estado: ESTADOS_NOTIFICACION.FALLIDA,
      })
      .eq('ficha_id', fichaId)
      .eq('tipo', TIPOS_NOTIFICACION.ALERTA_ZONA)
      .eq('estado', ESTADOS_NOTIFICACION.ENCOLADA);

    if (error) {
      console.error('[NotificacionRepo] Error al cancelar cola de ficha:', error.message);
    }
  }
}
