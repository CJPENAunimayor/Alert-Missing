import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { AppError, ValidationError } from '../shared/errors.js';
import { parsePostgisPoint, toPostgisPoint, validarCoordenadas } from '../shared/geo.js';

const TABLA_DISPOSITIVOS = 'dispositivos_suscritos';

function mapearDispositivo(row) {
  if (!row) return null;
  return {
    oneSignalId: row.one_signal_id,
    usuarioId: row.usuario_id,
    ultimaUbicacion: parsePostgisPoint(row.ultima_ubicacion),
    permisoNotificaciones: Boolean(row.permiso_notificaciones),
    permisoUbicacion: Boolean(row.permiso_ubicacion),
    updatedAt: row.updated_at,
  };
}

export class DispositivoRepo {
  constructor(supabaseClient = null) {
    this._client = supabaseClient;
  }

  get client() {
    return this._client || getSupabaseAdminClient();
  }

  /**
   * Registra o actualiza la suscripción de un dispositivo OneSignal y su última ubicación PostGIS.
   */
  async suscribir({
    oneSignalId,
    usuarioId = null,
    lat = null,
    lng = null,
    permisoNotificaciones = true,
    permisoUbicacion = false,
  }) {
    if (typeof oneSignalId !== 'string' || oneSignalId.trim().length < 5) {
      throw new ValidationError('El identificador oneSignalId es obligatorio.');
    }

    const tieneCoords =
      lat !== null && lat !== undefined && lng !== null && lng !== undefined;

    const payload = {
      one_signal_id: oneSignalId.trim(),
      usuario_id: usuarioId || null,
      ultima_ubicacion: tieneCoords ? toPostgisPoint(lat, lng) : null,
      permiso_notificaciones: Boolean(permisoNotificaciones),
      permiso_ubicacion: Boolean(permisoUbicacion && tieneCoords),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from(TABLA_DISPOSITIVOS)
      .upsert(payload, { onConflict: 'one_signal_id' })
      .select('*')
      .single();

    if (error) {
      throw new AppError(`Error al suscribir dispositivo: ${error.message}`, { statusCode: 500 });
    }

    return mapearDispositivo(data);
  }

  /**
   * Consulta dispositivos suscritos dentro de un radio en metros (por defecto 5000 m = 5 km)
   * usando la función SQL/RPC PostGIS con ST_DWithin e índice GIST.
   */
  async buscarEnRadio({ lat, lng, radioMetros = 5000 }) {
    const coords = validarCoordenadas(lat, lng);
    const metros = Number(radioMetros) > 0 ? Number(radioMetros) : 5000;

    const { data, error } = await this.client.rpc('buscar_dispositivos_en_radio_metros', {
      p_lat: coords.lat,
      p_lng: coords.lng,
      p_radio_metros: metros,
    });

    if (error) {
      // Fallback a la versión en kilómetros si aún no se aplicó el nuevo RPC
      const fallback = await this.client.rpc('buscar_dispositivos_en_radio', {
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_radio_km: metros / 1000,
      });

      if (fallback.error) {
        throw new AppError(
          `Error al consultar dispositivos en radio PostGIS: ${error.message}`,
          { statusCode: 500 }
        );
      }

      return (fallback.data || []).map((row) => ({
        oneSignalId: row.one_signal_id,
        usuarioId: row.usuario_id,
        distanciaMetros: Number(((row.distancia_km || 0) * 1000).toFixed(2)),
      }));
    }

    return (data || []).map((row) => ({
      oneSignalId: row.one_signal_id,
      usuarioId: row.usuario_id,
      distanciaMetros: Number(row.distancia_metros ?? 0),
    }));
  }

  /**
   * Obtiene los dispositivos con notificaciones push habilitadas de un usuario específico.
   */
  async buscarPorUsuarioId(usuarioId) {
    if (!usuarioId) return [];

    const { data, error } = await this.client
      .from(TABLA_DISPOSITIVOS)
      .select('*')
      .eq('usuario_id', usuarioId)
      .eq('permiso_notificaciones', true);

    if (error) {
      throw new AppError(`Error al consultar dispositivos del usuario: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map(mapearDispositivo);
  }
}
