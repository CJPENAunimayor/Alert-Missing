import crypto from 'node:crypto';
import { Avistamiento, ESTADOS_AVISTAMIENTO } from '../domain/Avistamiento.js';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { BUCKET_ALERT_PHOTOS } from './AlertaRepo.js';
import { env } from '../shared/env.js';
import { AppError, NotFoundError } from '../shared/errors.js';

const TABLA_AVISTAMIENTOS = 'avistamientos';
const TABLA_AUDITORIA = 'registros_auditoria';

export class AvistamientoRepo {
  constructor(supabaseClient = null) {
    this._client = supabaseClient;
    this._bucketVerificado = false;
  }

  get client() {
    return this._client || getSupabaseAdminClient();
  }

  get bucketFotos() {
    return env.SUPABASE_STORAGE_BUCKET || BUCKET_ALERT_PHOTOS;
  }

  async _asegurarBucketPublico() {
    if (this._bucketVerificado) return;
    try {
      const { data: bucket } = await this.client.storage.getBucket(this.bucketFotos);
      if (bucket && !bucket.public) {
        await this.client.storage.updateBucket(this.bucketFotos, {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
      }
      this._bucketVerificado = true;
    } catch {
      // No bloquear la subida si falla la consulta de metadatos
    }
  }

  /**
   * Sube evidencia fotográfica opcional del avistamiento a Supabase Storage.
   */
  async subirEvidencia({ buffer, contentType, extension = 'jpg', fichaId }) {
    await this._asegurarBucketPublico();
    const rutaArchivo = `avistamientos/${fichaId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await this.client.storage
      .from(this.bucketFotos)
      .upload(rutaArchivo, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new AppError(
        `Error al subir evidencia fotográfica a Supabase Storage (${this.bucketFotos}): ${uploadError.message}`,
        { statusCode: 502, code: 'STORAGE_UPLOAD_ERROR' }
      );
    }

    const { data: publicData } = this.client.storage
      .from(this.bucketFotos)
      .getPublicUrl(rutaArchivo);

    if (!publicData?.publicUrl) {
      throw new AppError('No se pudo obtener la URL pública de la evidencia cargada.', {
        statusCode: 500,
      });
    }

    return {
      ruta: rutaArchivo,
      url: publicData.publicUrl,
    };
  }

  /**
   * Inserta un avistamiento con coordenadas PostGIS SRID 4326.
   */
  async crear(avistamiento) {
    const entidad =
      avistamiento instanceof Avistamiento ? avistamiento : new Avistamiento(avistamiento);

    const { data, error } = await this.client
      .from(TABLA_AVISTAMIENTOS)
      .insert(entidad.toPersistence())
      .select('*')
      .single();

    if (error) {
      throw new AppError(`Error al registrar avistamiento: ${error.message}`, { statusCode: 500 });
    }

    return Avistamiento.fromPersistence(data);
  }

  /**
   * Busca un avistamiento por su UUID.
   */
  async obtenerPorId(id) {
    const { data, error } = await this.client
      .from(TABLA_AVISTAMIENTOS)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al consultar avistamiento: ${error.message}`, { statusCode: 500 });
    }

    return Avistamiento.fromPersistence(data);
  }

  /**
   * Lista avistamientos de una ficha:
   * - Lectores públicos (incluirTodos = false): retorna únicamente estado APROBADO.
   * - Creador de la ficha o ADMINISTRADOR (incluirTodos = true): retorna también PENDIENTE y DESCARTADO.
   */
  async listarPorFicha(fichaId, { incluirTodos = false, estado = null } = {}) {
    let query = this.client
      .from(TABLA_AVISTAMIENTOS)
      .select('*')
      .eq('ficha_id', fichaId)
      .order('created_at', { ascending: false });

    if (!incluirTodos) {
      query = query.eq('estado', ESTADOS_AVISTAMIENTO.APROBADO);
    } else if (estado) {
      query = query.eq('estado', String(estado).trim().toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      throw new AppError(`Error al listar avistamientos de la ficha: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((row) => Avistamiento.fromPersistence(row));
  }

  /**
   * Lista todos los avistamientos reportados por un testigo autenticado con datos básicos de la ficha.
   */
  async listarPorTestigo(testigoId) {
    const { data, error } = await this.client
      .from(TABLA_AVISTAMIENTOS)
      .select('*, fichas_busqueda(id, nombre_desaparecido, estado, es_alerta_rosa)')
      .eq('testigo_id', testigoId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError(`Error al listar avistamientos del usuario: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((row) => {
      const entidad = Avistamiento.fromPersistence(row);
      const ficha = row.fichas_busqueda || null;
      return {
        ...entidad.toJSON(),
        ficha: ficha
          ? {
              id: ficha.id,
              nombreDesaparecido: ficha.nombre_desaparecido,
              estado: ficha.estado,
              esAlertaRosa: Boolean(ficha.es_alerta_rosa),
            }
          : null,
      };
    });
  }

  /**
   * Persiste cambios de estado (APROBADO / DESCARTADO) y motivo_rechazo.
   */
  async actualizarEstado(avistamiento) {
    const { data, error } = await this.client
      .from(TABLA_AVISTAMIENTOS)
      .update({
        estado: avistamiento.estado,
        motivo_rechazo: avistamiento.motivoRechazo,
      })
      .eq('id', avistamiento.id)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al actualizar estado del avistamiento: ${error.message}`, {
        statusCode: 500,
      });
    }

    if (!data) {
      throw new NotFoundError('Avistamiento no encontrado.');
    }

    return Avistamiento.fromPersistence(data);
  }

  /**
   * Verifica en la bitácora inmutable si una dirección IP fue marcada por abuso/spam.
   */
  async estaIpBloqueada(ip) {
    if (!ip || ip === '0.0.0.0') return false;

    const { data, error } = await this.client
      .from(TABLA_AUDITORIA)
      .select('id')
      .eq('accion', ACCIONES_AUDITORIA.BLOQUEO_IP_SPAM)
      .eq('entidad', 'IP_BLOQUEADA')
      .eq('entidad_id', String(ip).trim())
      .limit(1);

    if (error) {
      // No bloquear la operación legítima por fallo transitorio en lectura de auditoría
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  }
}
