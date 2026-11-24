import { Avistamiento, ESTADOS_AVISTAMIENTO } from '../domain/Avistamiento.js';
import { parsearImagenBase64, validarUrlFotografia } from '../domain/Fotografia.js';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { ROLES_USUARIO } from '../domain/Usuario.js';
import { AlertaRepo } from '../repositories/AlertaRepo.js';
import { AvistamientoRepo } from '../repositories/AvistamientoRepo.js';
import { UsuarioRepo } from '../repositories/UsuarioRepo.js';
import { AuditoriaService } from './AuditoriaService.js';
import { NotificacionService } from './NotificacionService.js';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../shared/errors.js';

export class AvistamientoService {
  constructor({
    avistamientoRepo = new AvistamientoRepo(),
    alertaRepo = new AlertaRepo(),
    usuarioRepo = new UsuarioRepo(),
    auditoriaService = new AuditoriaService(),
    notificacionService = new NotificacionService(),
  } = {}) {
    this.avistamientoRepo = avistamientoRepo;
    this.alertaRepo = alertaRepo;
    this.usuarioRepo = usuarioRepo;
    this.auditoriaService = auditoriaService;
    this.notificacionService = notificacionService;
  }

  _esModeradorDeFicha(ficha, usuarioAutenticado) {
    if (!usuarioAutenticado) return false;
    return (
      usuarioAutenticado.rol === ROLES_USUARIO.ADMINISTRADOR ||
      String(ficha.creadorId) === String(usuarioAutenticado.id)
    );
  }

  async _validarAutorizacionModeracion(ficha, usuarioAutenticado, avistamientoId, ip) {
    if (!usuarioAutenticado) {
      throw new AuthenticationError('Debe iniciar sesión para moderar avistamientos.');
    }

    if (!this._esModeradorDeFicha(ficha, usuarioAutenticado)) {
      await this.auditoriaService.registrar(
        {
          usuarioId: usuarioAutenticado.id,
          accion: ACCIONES_AUDITORIA.ACCESO_NO_AUTORIZADO_PROPIETARIO,
          entidad: 'AVISTAMIENTOS',
          entidadId: avistamientoId,
          ip,
        },
        { silencioso: true }
      );

      throw new AuthorizationError(
        'Solo el creador de la ficha de búsqueda o un administrador puede moderar este avistamiento.'
      );
    }
  }

  /**
   * Reporta un nuevo avistamiento ciudadano:
   * - Exige sesión autenticada activa (HTTP 401 si no hay usuario autenticado).
   * - Verifica que el origen (IP o usuario autenticado) no esté bloqueado por abuso/spam.
   * - Valida que la ficha exista y se encuentre ACTIVA.
   * - Sube evidencia fotográfica opcional a Supabase Storage.
   * - Registra el avistamiento en estado PENDIENTE asociado al testigo autenticado.
   */
  async reportar(fichaId, datos, { usuarioAutenticado = null, ip = '0.0.0.0' } = {}) {
    if (!usuarioAutenticado?.id) {
      throw new AuthenticationError(
        'Debe iniciar sesión con una cuenta activa para reportar un avistamiento.'
      );
    }

    const ipBloqueada = await this.avistamientoRepo.estaIpBloqueada(ip);
    if (ipBloqueada) {
      throw new AuthorizationError(
        'No es posible recibir reportes desde esta dirección debido a un bloqueo previo por abuso o spam.'
      );
    }

    const testigo = await this.usuarioRepo.buscarPorId(usuarioAutenticado.id);
    if (!testigo) {
      throw new AuthenticationError('La cuenta de usuario no es válida.');
    }
    if (testigo.estaBloqueado()) {
      throw new AuthorizationError(
        'Tu cuenta se encuentra bloqueada y no puede registrar avistamientos.'
      );
    }

    const ficha = await this.alertaRepo.obtenerPorId(fichaId);
    if (!ficha) {
      throw new NotFoundError('La ficha de búsqueda especificada no existe.');
    }

    if (!ficha.estaActiva()) {
      throw new ValidationError(
        `No se pueden reportar avistamientos porque la ficha se encuentra en estado ${ficha.estado}.`
      );
    }

    // Procesar evidencia fotográfica opcional (base64 para subir a Storage o URL ya cargada)
    let urlEvidencia = null;
    const evidenciaBase64 = datos.evidenciaBase64 || datos.evidencia?.base64 || null;

    if (evidenciaBase64) {
      const decodificada = parsearImagenBase64({
        base64: evidenciaBase64,
        contentType: datos.evidenciaContentType || datos.evidencia?.contentType,
        nombreArchivo: datos.evidenciaNombre || datos.evidencia?.nombreArchivo || 'evidencia',
      });

      const subida = await this.avistamientoRepo.subirEvidencia({
        buffer: decodificada.buffer,
        contentType: decodificada.contentType,
        extension: decodificada.extension,
        fichaId: ficha.id,
      });
      urlEvidencia = subida.url;
    } else if (datos.urlEvidencia) {
      urlEvidencia = validarUrlFotografia(datos.urlEvidencia);
    }

    const nuevoAvistamiento = new Avistamiento({
      fichaId: ficha.id,
      testigoId: usuarioAutenticado?.id ?? null,
      lat: datos.lat,
      lng: datos.lng,
      fechaHora: datos.fechaHora,
      descripcion: datos.descripcion,
      urlEvidencia,
      estado: ESTADOS_AVISTAMIENTO.PENDIENTE,
      ipOrigen: ip,
    });

    const guardado = await this.avistamientoRepo.crear(nuevoAvistamiento);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado?.id ?? null,
        accion: ACCIONES_AUDITORIA.REPORTE_AVISTAMIENTO,
        entidad: 'AVISTAMIENTOS',
        entidadId: guardado.id,
        ip,
      },
      { silencioso: true }
    );

    const avistamientoPublico = guardado.toPublicJSON();

    // Notificar de inmediato al creador de la ficha (Push con respaldo automático Email/SMS)
    this.notificacionService.notificarAvistamientoACreador({
      ficha: ficha.toJSON(),
      avistamiento: avistamientoPublico,
    });

    return avistamientoPublico;
  }

  /**
   * Lista avistamientos de una ficha respetando el nivel de visibilidad:
   * - Público: solo APROBADO (sin exponer ipOrigen ni motivoRechazo).
   * - Creador de la ficha o ADMINISTRADOR: también PENDIENTE y DESCARTADO.
   */
  async listarPorFicha(fichaId, { usuarioAutenticado = null, estado = null } = {}) {
    const ficha = await this.alertaRepo.obtenerPorId(fichaId);
    if (!ficha) {
      throw new NotFoundError('La ficha de búsqueda especificada no existe.');
    }

    const esModerador = this._esModeradorDeFicha(ficha, usuarioAutenticado);

    const avistamientos = await this.avistamientoRepo.listarPorFicha(fichaId, {
      incluirTodos: esModerador,
      estado: esModerador ? estado : null,
    });

    return {
      fichaId,
      vistaModeracion: esModerador,
      total: avistamientos.length,
      avistamientos: avistamientos.map((item) =>
        esModerador ? item.toJSON() : item.toPublicJSON()
      ),
    };
  }

  /**
   * Lista los avistamientos reportados por el usuario autenticado.
   */
  async listarMios(usuarioId) {
    const avistamientos = await this.avistamientoRepo.listarPorTestigo(usuarioId);
    return {
      total: avistamientos.length,
      avistamientos,
    };
  }

  /**
   * Aprueba un avistamiento pendiente (solo creador de la ficha o ADMINISTRADOR).
   */
  async aprobar(avistamientoId, usuarioAutenticado, ip = '0.0.0.0') {
    const avistamiento = await this.avistamientoRepo.obtenerPorId(avistamientoId);
    if (!avistamiento) {
      throw new NotFoundError('Avistamiento no encontrado.');
    }

    const ficha = await this.alertaRepo.obtenerPorId(avistamiento.fichaId);
    if (!ficha) {
      throw new NotFoundError('Ficha de búsqueda asociada no encontrada.');
    }

    await this._validarAutorizacionModeracion(ficha, usuarioAutenticado, avistamiento.id, ip);

    avistamiento.aprobar();
    const actualizado = await this.avistamientoRepo.actualizarEstado(avistamiento);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.APROBACION_AVISTAMIENTO,
        entidad: 'AVISTAMIENTOS',
        entidadId: actualizado.id,
        ip,
      },
      { silencioso: true }
    );

    return actualizado.toJSON();
  }

  /**
   * Descarta un avistamiento (solo creador de la ficha o ADMINISTRADOR), lo oculta del mapa público,
   * registra en auditoría y opcionalmente bloquea al usuario testigo o registra la IP por abuso/spam.
   */
  async descartar(
    avistamientoId,
    { motivo, bloquearOrigen = false },
    usuarioAutenticado,
    ip = '0.0.0.0'
  ) {
    const avistamiento = await this.avistamientoRepo.obtenerPorId(avistamientoId);
    if (!avistamiento) {
      throw new NotFoundError('Avistamiento no encontrado.');
    }

    const ficha = await this.alertaRepo.obtenerPorId(avistamiento.fichaId);
    if (!ficha) {
      throw new NotFoundError('Ficha de búsqueda asociada no encontrada.');
    }

    await this._validarAutorizacionModeracion(ficha, usuarioAutenticado, avistamiento.id, ip);

    avistamiento.descartar(motivo);
    const actualizado = await this.avistamientoRepo.actualizarEstado(avistamiento);

    await this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.DESCARTE_AVISTAMIENTO,
        entidad: 'AVISTAMIENTOS',
        entidadId: actualizado.id,
        ip,
      },
      { silencioso: true }
    );

    let usuarioBloqueado = false;
    let ipRegistrada = null;

    if (bloquearOrigen === true) {
      // Si el reporte vino de un usuario autenticado (y no es el propio moderador ni un admin), bloquear su cuenta
      if (
        actualizado.testigoId &&
        String(actualizado.testigoId) !== String(usuarioAutenticado.id)
      ) {
        const testigo = await this.usuarioRepo.buscarPorId(actualizado.testigoId);
        if (testigo && !testigo.esAdministrador() && !testigo.estaBloqueado()) {
          await this.usuarioRepo.actualizar(testigo.id, { bloqueado: true });
          usuarioBloqueado = true;

          await this.auditoriaService.registrar(
            {
              usuarioId: usuarioAutenticado.id,
              accion: ACCIONES_AUDITORIA.BLOQUEO_USUARIO_ABUSO,
              entidad: 'USUARIOS',
              entidadId: testigo.id,
              ip,
            },
            { silencioso: true }
          );
        }
      }

      // Registrar siempre la IP de origen para reportes anónimos o bloqueo adicional anti-spam
      if (actualizado.ipOrigen && actualizado.ipOrigen !== '0.0.0.0') {
        ipRegistrada = actualizado.ipOrigen;
        await this.auditoriaService.registrar(
          {
            usuarioId: usuarioAutenticado.id,
            accion: ACCIONES_AUDITORIA.BLOQUEO_IP_SPAM,
            entidad: 'IP_BLOQUEADA',
            entidadId: actualizado.ipOrigen,
            ip,
          },
          { silencioso: true }
        );
      }
    }

    return {
      avistamiento: actualizado.toJSON(),
      origenBloqueado: {
        solicitado: Boolean(bloquearOrigen),
        usuarioBloqueado,
        ipRegistrada,
      },
    };
  }
}
