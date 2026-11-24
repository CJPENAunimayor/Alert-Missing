import crypto from 'node:crypto';
import { FichaBusqueda, ESTADOS_FICHA } from '../domain/FichaBusqueda.js';
import { Fotografia } from '../domain/Fotografia.js';
import { HistorialEstado } from '../domain/HistorialEstado.js';
import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { env } from '../shared/env.js';
import { AppError, NotFoundError } from '../shared/errors.js';
import { calcularDistanciaKm } from '../shared/geo.js';

const TABLA_FICHAS = 'fichas_busqueda';
const TABLA_FOTOGRAFIAS = 'fotografias';
const TABLA_HISTORIAL = 'historial_estados';
export const BUCKET_ALERT_PHOTOS = 'alert-photos';

export class AlertaRepo {
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

  /**
   * Asegura que el bucket configurado exista y sea público para que las URLs carguen en el navegador.
   */
  async _asegurarBucketPublico() {
    if (this._bucketVerificado) return;
    try {
      const { data: bucket } = await this.client.storage.getBucket(this.bucketFotos);
      if (!bucket) {
        await this.client.storage.createBucket(this.bucketFotos, {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
      } else if (!bucket.public) {
        await this.client.storage.updateBucket(this.bucketFotos, {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
      }
      this._bucketVerificado = true;
    } catch {
      // No bloquear la subida si el servicio de metadatos de bucket falla temporalmente
    }
  }

  /**
   * Sube una imagen al bucket de Supabase Storage (`alert-photos` / `SUPABASE_STORAGE_BUCKET`) y devuelve su URL pública.
   */
  async subirFotografia({ buffer, contentType, extension = 'jpg', prefijo = 'fichas' }) {
    await this._asegurarBucketPublico();
    const rutaArchivo = `${prefijo}/${Date.now()}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await this.client.storage
      .from(this.bucketFotos)
      .upload(rutaArchivo, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new AppError(
        `Error al subir fotografía a Supabase Storage (${this.bucketFotos}): ${uploadError.message}`,
        { statusCode: 502, code: 'STORAGE_UPLOAD_ERROR' }
      );
    }

    const { data: publicData } = this.client.storage
      .from(this.bucketFotos)
      .getPublicUrl(rutaArchivo);

    if (!publicData?.publicUrl) {
      throw new AppError('No se pudo obtener la URL pública de la fotografía cargada.', {
        statusCode: 500,
      });
    }

    return {
      ruta: rutaArchivo,
      url: publicData.publicUrl,
    };
  }

  /**
   * Inserta una nueva ficha de búsqueda convirtiendo lat, lng a SRID=4326;POINT(lng lat).
   */
  async crearFicha(ficha) {
    const entidad = ficha instanceof FichaBusqueda ? ficha : new FichaBusqueda(ficha);
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .insert(entidad.toPersistence())
      .select('*')
      .single();

    if (error) {
      throw new AppError(`Error al crear ficha de búsqueda: ${error.message}`, {
        statusCode: 500,
      });
    }

    return FichaBusqueda.fromPersistence(data);
  }

  /**
   * Inserta las fotografías asociadas a una ficha de búsqueda.
   */
  async crearFotografias(fichaId, fotografias) {
    const filas = fotografias.map((foto) => {
      const entidad =
        foto instanceof Fotografia
          ? new Fotografia({ ...foto, fichaId })
          : new Fotografia({ ...foto, fichaId });
      return entidad.toPersistence();
    });

    const { data, error } = await this.client
      .from(TABLA_FOTOGRAFIAS)
      .insert(filas)
      .select('*');

    if (error) {
      throw new AppError(`Error al guardar fotografías de la ficha: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((row) => Fotografia.fromPersistence(row));
  }

  /**
   * Registra una entrada inmutable en historial_estados.
   */
  async registrarHistorialEstado(historial) {
    const entidad =
      historial instanceof HistorialEstado ? historial : new HistorialEstado(historial);

    const { data, error } = await this.client
      .from(TABLA_HISTORIAL)
      .insert(entidad.toPersistence())
      .select('*')
      .single();

    if (error) {
      throw new AppError(`Error al registrar historial de estado: ${error.message}`, {
        statusCode: 500,
      });
    }

    return HistorialEstado.fromPersistence(data);
  }

  /**
   * Lista fichas activas ordenando estrictamente por Alerta Rosa primero y luego más recientes:
   * es_alerta_rosa DESC, created_at DESC.
   */
  async listarActivas({
    busqueda = null,
    esAlertaRosa = null,
    genero = null,
    edadMin = null,
    edadMax = null,
    lat = null,
    lng = null,
    radioKm = null,
    pagina = 1,
    limite = 20,
  } = {}) {
    let query = this.client
      .from(TABLA_FICHAS)
      .select('*, fotografias(*)', { count: 'exact' })
      .eq('estado', ESTADOS_FICHA.ACTIVA)
      .order('es_alerta_rosa', { ascending: false })
      .order('created_at', { ascending: false });

    if (typeof esAlertaRosa === 'boolean') {
      query = query.eq('es_alerta_rosa', esAlertaRosa);
    }

    if (genero) {
      query = query.eq('genero', String(genero).trim().toUpperCase());
    }

    if (edadMin !== null && edadMin !== undefined) {
      query = query.gte('edad', Number(edadMin));
    }

    if (edadMax !== null && edadMax !== undefined) {
      query = query.lte('edad', Number(edadMax));
    }

    if (busqueda && String(busqueda).trim().length > 0) {
      const termino = String(busqueda).trim().replace(/[,%()]/g, '');
      query = query.or(
        `nombre_desaparecido.ilike.%${termino}%,direccion_texto.ilike.%${termino}%,senas_particulares.ilike.%${termino}%`
      );
    }

    const tieneFiltroEspacial =
      lat !== null && lat !== undefined && lng !== null && lng !== undefined && radioKm !== null;

    if (!tieneFiltroEspacial) {
      const inicio = (pagina - 1) * limite;
      const fin = inicio + limite - 1;
      query = query.range(inicio, fin);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new AppError(`Error al listar fichas activas: ${error.message}`, { statusCode: 500 });
    }

    let fichas = (data || []).map((row) => {
      const fotosOrdenadas = [...(row.fotografias || [])].sort(
        (a, b) => Number(Boolean(b.es_principal)) - Number(Boolean(a.es_principal))
      );
      return FichaBusqueda.fromPersistence({ ...row, fotografias: fotosOrdenadas });
    });

    // Ocultar de inmediato fichas temporales cuyo plazo SIRDEC de 1 día hábil ya venció
    const ahoraMs = Date.now();
    fichas = fichas.filter((ficha) => {
      if (ficha.sirdecCompletado || !ficha.sirdecFechaLimite) return true;
      return new Date(ficha.sirdecFechaLimite).getTime() > ahoraMs;
    });

    if (tieneFiltroEspacial) {
      const radioMax = Number(radioKm);
      fichas = fichas.filter(
        (ficha) => calcularDistanciaKm(Number(lat), Number(lng), ficha.lat, ficha.lng) <= radioMax
      );
      const totalFiltrado = fichas.length;
      const inicio = (pagina - 1) * limite;
      return {
        items: fichas.slice(inicio, inicio + limite),
        total: totalFiltrado,
        pagina,
        limite,
      };
    }

    return {
      items: fichas,
      total: count ?? fichas.length,
      pagina,
      limite,
    };
  }

  /**
   * Lista todas las fichas creadas por un usuario (ACTIVA, LOCALIZADA y CANCELADA).
   */
  async listarPorCreador(creadorId) {
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .select('*, fotografias(*)')
      .eq('creador_id', creadorId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError(`Error al listar fichas del usuario: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((row) => {
      const fotosOrdenadas = [...(row.fotografias || [])].sort(
        (a, b) => Number(Boolean(b.es_principal)) - Number(Boolean(a.es_principal))
      );
      return FichaBusqueda.fromPersistence({ ...row, fotografias: fotosOrdenadas });
    });
  }

  /**
   * Obtiene una ficha de búsqueda por ID incluyendo fotografías e historial inmutable de estados.
   */
  async obtenerPorId(id) {
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .select('*, fotografias(*), historial_estados(*)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al consultar ficha de búsqueda: ${error.message}`, {
        statusCode: 500,
      });
    }

    if (!data) {
      return null;
    }

    const fotosOrdenadas = [...(data.fotografias || [])].sort(
      (a, b) => Number(Boolean(b.es_principal)) - Number(Boolean(a.es_principal))
    );
    const historialOrdenado = [...(data.historial_estados || [])].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );

    return FichaBusqueda.fromPersistence({
      ...data,
      fotografias: fotosOrdenadas,
      historial_estados: historialOrdenado,
    });
  }

  /**
   * Actualiza únicamente el indicador es_alerta_rosa de una ficha existente.
   */
  async actualizarAlertaRosa(id, esAlertaRosa) {
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .update({ es_alerta_rosa: Boolean(esAlertaRosa) })
      .eq('id', id)
      .select('*, fotografias(*), historial_estados(*)')
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al actualizar Alerta Rosa: ${error.message}`, { statusCode: 500 });
    }

    if (!data) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    return FichaBusqueda.fromPersistence(data);
  }

  /**
   * Actualiza el estado de una ficha de búsqueda ('LOCALIZADA' | 'CANCELADA' | 'ACTIVA').
   */
  async actualizarEstado(id, nuevoEstado) {
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .update({ estado: nuevoEstado })
      .eq('id', id)
      .select('*, fotografias(*), historial_estados(*)')
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al actualizar estado de la ficha: ${error.message}`, {
        statusCode: 500,
      });
    }

    if (!data) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    return FichaBusqueda.fromPersistence(data);
  }

  /**
   * Actualiza los campos morfológicos JSONB (datos_sirdec), estado de completitud SIRDEC
   * y opcionalmente reactiva la ficha si estaba SUSPENDIDA_SIRDEC.
   */
  async actualizarDatosSirdec(
    id,
    { datosSirdec, sirdecCompletado, sirdecCompletadoEn = null, estado = null }
  ) {
    const payload = {
      datos_sirdec: datosSirdec || {},
    };
    if (sirdecCompletado !== undefined) {
      payload.sirdec_completado = Boolean(sirdecCompletado);
    }
    if (sirdecCompletadoEn !== undefined) {
      payload.sirdec_completado_en = sirdecCompletadoEn;
    }
    if (estado) {
      payload.estado = estado;
    }

    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .update(payload)
      .eq('id', id)
      .select('*, fotografias(*), historial_estados(*)')
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al actualizar datos SIRDEC de la ficha: ${error.message}`, {
        statusCode: 500,
      });
    }

    if (!data) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    return FichaBusqueda.fromPersistence(data);
  }

  /**
   * Obtiene fichas activas temporales cuyo plazo SIRDEC ya expiró.
   */
  async buscarPendientesSirdecVencidas(fechaCorteIso = new Date().toISOString()) {
    const { data, error } = await this.client
      .from(TABLA_FICHAS)
      .select('*')
      .eq('estado', ESTADOS_FICHA.ACTIVA)
      .eq('sirdec_completado', false)
      .not('sirdec_fecha_limite', 'is', null)
      .lte('sirdec_fecha_limite', fechaCorteIso);

    if (error) {
      throw new AppError(`Error al buscar fichas vencidas por plazo SIRDEC: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((row) => FichaBusqueda.fromPersistence(row));
  }
}
