import { Usuario } from '../domain/Usuario.js';
import { getSupabaseAdminClient } from '../integrations/supabaseClient.js';
import { AppError, ConflictError, NotFoundError } from '../shared/errors.js';

const TABLA_USUARIOS = 'usuarios';

export class UsuarioRepo {
  constructor(supabaseClient = null) {
    this._client = supabaseClient;
  }

  get client() {
    return this._client || getSupabaseAdminClient();
  }

  async buscarPorId(id) {
    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al consultar usuario por ID: ${error.message}`, { statusCode: 500 });
    }
    return Usuario.fromPersistence(data);
  }

  /**
   * Consulta ligera de estado de acceso (id, correo, rol, bloqueado, proveedor_auth)
   * optimizada para validación rápida en JwtAuthMiddleware (<200 ms, CAL-05).
   */
  async buscarEstadoAccesoPorId(id) {
    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .select('id, correo, rol, bloqueado, proveedor_auth')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al verificar estado de acceso del usuario: ${error.message}`, {
        statusCode: 500,
      });
    }
    return data || null;
  }

  async buscarPorCorreo(correo) {
    const correoNormalizado = String(correo || '').trim().toLowerCase();
    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .select('*')
      .eq('correo', correoNormalizado)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al consultar usuario por correo: ${error.message}`, {
        statusCode: 500,
      });
    }
    return Usuario.fromPersistence(data);
  }

  async buscarPorDocumento(documento) {
    const docNormalizado = String(documento || '').trim().toUpperCase();
    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .select('*')
      .eq('documento', docNormalizado)
      .maybeSingle();

    if (error) {
      throw new AppError(`Error al consultar usuario por documento: ${error.message}`, {
        statusCode: 500,
      });
    }
    return Usuario.fromPersistence(data);
  }

  async crear(usuario) {
    const entidad = usuario instanceof Usuario ? usuario : new Usuario(usuario);
    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .insert(entidad.toPersistence())
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictError('Ya existe un usuario registrado con ese correo o documento.');
      }
      throw new AppError(`Error al crear usuario: ${error.message}`, { statusCode: 500 });
    }
    return Usuario.fromPersistence(data);
  }

  async actualizar(id, cambios) {
    const payload = {};
    if (cambios.nombreCompleto !== undefined) payload.nombre_completo = cambios.nombreCompleto;
    if (cambios.documento !== undefined) payload.documento = cambios.documento;
    if (cambios.telefono !== undefined) payload.telefono = cambios.telefono;
    if (cambios.passwordHash !== undefined) payload.password_hash = cambios.passwordHash;
    if (cambios.bloqueado !== undefined) payload.bloqueado = Boolean(cambios.bloqueado);
    if (cambios.rol !== undefined) payload.rol = cambios.rol;
    if (cambios.aceptoHabeasData !== undefined) {
      payload.acepto_habeas_data = Boolean(cambios.aceptoHabeasData);
    }
    if (cambios.fechaAceptacionHabeasData !== undefined) {
      payload.fecha_aceptacion_habeas_data = cambios.fechaAceptacionHabeasData;
    }

    if (Object.keys(payload).length === 0) {
      const actual = await this.buscarPorId(id);
      if (!actual) {
        throw new NotFoundError('Usuario no encontrado.');
      }
      return actual;
    }

    const { data, error } = await this.client
      .from(TABLA_USUARIOS)
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        throw new ConflictError('El documento ingresado ya pertenece a otra cuenta.');
      }
      throw new AppError(`Error al actualizar usuario: ${error.message}`, { statusCode: 500 });
    }

    if (!data) {
      throw new NotFoundError('Usuario no encontrado.');
    }

    return Usuario.fromPersistence(data);
  }
}
