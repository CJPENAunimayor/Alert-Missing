import { RegistroAuditoria } from '../domain/RegistroAuditoria.js';
import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { AppError } from '../shared/errors.js';

const TABLA_AUDITORIA = 'registros_auditoria';

/**
 * Repositorio append-only para registros de auditoría.
 * No expone operaciones de actualización ni eliminación por política de inmutabilidad.
 */
export class AuditoriaRepo {
  constructor(supabaseClient = null) {
    this._client = supabaseClient;
  }

  get client() {
    return this._client || getSupabaseAdminClient();
  }

  async crear(registro) {
    const entidad = registro instanceof RegistroAuditoria ? registro : new RegistroAuditoria(registro);

    const { data, error } = await this.client
      .from(TABLA_AUDITORIA)
      .insert(entidad.toPersistence())
      .select('*')
      .single();

    if (error) {
      throw new AppError(`Error al registrar evento de auditoría: ${error.message}`, {
        statusCode: 500,
      });
    }

    return RegistroAuditoria.fromPersistence(data);
  }

  async listarPorUsuario(usuarioId, { limite = 50, desplazamiento = 0 } = {}) {
    const { data, error } = await this.client
      .from(TABLA_AUDITORIA)
      .select('*')
      .eq('usuario_id', usuarioId)
      .order('fecha', { ascending: false })
      .range(desplazamiento, desplazamiento + limite - 1);

    if (error) {
      throw new AppError(`Error al consultar auditoría por usuario: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((fila) => RegistroAuditoria.fromPersistence(fila));
  }

  async listarPorEntidad(entidad, entidadId, { limite = 50 } = {}) {
    let query = this.client
      .from(TABLA_AUDITORIA)
      .select('*')
      .eq('entidad', String(entidad).trim().toUpperCase())
      .order('fecha', { ascending: false })
      .limit(limite);

    if (entidadId !== null && entidadId !== undefined) {
      query = query.eq('entidad_id', String(entidadId));
    }

    const { data, error } = await query;

    if (error) {
      throw new AppError(`Error al consultar auditoría por entidad: ${error.message}`, {
        statusCode: 500,
      });
    }

    return (data || []).map((fila) => RegistroAuditoria.fromPersistence(fila));
  }
}
