import {
  ESTADOS_FICHA,
  FichaBusqueda,
  evaluarCompletitudSirdec,
} from '../domain/FichaBusqueda.js';
import { Fotografia, parsearImagenBase64 } from '../domain/Fotografia.js';
import { HistorialEstado } from '../domain/HistorialEstado.js';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { ROLES_USUARIO } from '../domain/Usuario.js';
import { AlertaRepo } from '../repositories/AlertaRepo.js';
import { AuditoriaService } from './AuditoriaService.js';
import { NotificacionService } from './NotificacionService.js';
import { env } from '../shared/env.js';
import { sumarDiasHabilesColombia } from '../shared/diasHabilesColombia.js';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../shared/errors.js';

export class AlertaService {
  constructor({
    alertaRepo = new AlertaRepo(),
    auditoriaService = new AuditoriaService(),
    notificacionService = new NotificacionService(),
  } = {}) {
    this.alertaRepo = alertaRepo;
    this.auditoriaService = auditoriaService;
    this.notificacionService = notificacionService;
  }

  async _validarPropiedadORol(ficha, usuarioAutenticado, ip) {
    if (!usuarioAutenticado) {
      throw new AuthenticationError('Debe iniciar sesión para realizar esta operación.');
    }

    const autorizado =
      usuarioAutenticado.rol === ROLES_USUARIO.ADMINISTRADOR ||
      String(ficha.creadorId) === String(usuarioAutenticado.id);

    if (!autorizado) {
      void this.auditoriaService.registrar(
        {
          usuarioId: usuarioAutenticado.id,
          accion: ACCIONES_AUDITORIA.ACCESO_NO_AUTORIZADO_PROPIETARIO,
          entidad: 'FICHAS_BUSQUEDA',
          entidadId: ficha.id,
          ip,
        },
        { silencioso: true }
      );
      throw new AuthorizationError(
        'Solo el creador de la ficha o un administrador puede modificar o cerrar esta alerta.'
      );
    }
  }

  /**
   * Crea una ficha de búsqueda:
   * - Exige al menos una fotografía (en base64 para subir a Storage o URL ya cargada).
   * - Valida la regla de Alerta Rosa (Ley 2326 de 2023).
   * - Persiste ficha + fotografías + entrada inmutable en historial_estados + auditoría.
   * - Encola de forma asíncrona (no bloqueante) la difusión georreferenciada por zona.
   */
  async crearFicha(datos, usuarioAutenticado, ip = '0.0.0.0') {
    const fotosEntrada = datos.fotografias;
    if (!Array.isArray(fotosEntrada) || fotosEntrada.length === 0) {
      throw new ValidationError(
        'Debe adjuntar al menos una fotografía de la persona desaparecida para crear la ficha.'
      );
    }

    const evaluacionInicialSirdec = evaluarCompletitudSirdec(datos.datosSirdec);
    const ahora = new Date();
    const sirdecFechaLimite = evaluacionInicialSirdec.completo
      ? null
      : sumarDiasHabilesColombia(ahora, env.SIRDEC_PLAZO_DIAS_HABILES);

    const fichaDominio = new FichaBusqueda({
      nombreDesaparecido: datos.nombreDesaparecido,
      edad: datos.edad,
      genero: datos.genero,
      senasParticulares: datos.senasParticulares,
      vestimenta: datos.vestimenta,
      datosSirdec: datos.datosSirdec,
      fechaHoraUltimoContacto: datos.fechaHoraUltimoContacto,
      lat: datos.lat,
      lng: datos.lng,
      direccionTexto: datos.direccionTexto,
      radioBusquedaKm: datos.radioBusquedaKm ?? 5,
      esAlertaRosa: Boolean(datos.esAlertaRosa),
      estado: ESTADOS_FICHA.ACTIVA,
      sirdecCompletado: evaluacionInicialSirdec.completo,
      sirdecFechaLimite,
      sirdecCompletadoEn: evaluacionInicialSirdec.completo ? ahora.toISOString() : null,
      creadorId: usuarioAutenticado.id,
    });

    const fotosPreparadas = fotosEntrada.map((item, idx) => {
      if (item.base64) {
        const decodificada = parsearImagenBase64({
          base64: item.base64,
          contentType: item.contentType,
          nombreArchivo: item.nombreArchivo || `foto_${idx + 1}`,
        });
        return {
          tipo: 'UPLOAD',
          ...decodificada,
          esPrincipal: Boolean(item.esPrincipal),
        };
      }

      if (item.url) {
        new Fotografia({ url: item.url, esPrincipal: Boolean(item.esPrincipal) });
        return {
          tipo: 'URL',
          url: item.url.trim(),
          esPrincipal: Boolean(item.esPrincipal),
        };
      }

      throw new ValidationError(
        `La fotografía #${idx + 1} debe incluir contenido en "base64" o una "url" válida.`
      );
    });

    const tienePrincipal = fotosPreparadas.some((f) => f.esPrincipal);
    if (!tienePrincipal) {
      fotosPreparadas[0].esPrincipal = true;
    } else {
      let principalAsignada = false;
      for (const f of fotosPreparadas) {
        if (f.esPrincipal && !principalAsignada) {
          principalAsignada = true;
        } else {
          f.esPrincipal = false;
        }
      }
    }

    const fichaCreada = await this.alertaRepo.crearFicha(fichaDominio);

    const fotosParaGuardar = [];
    for (const foto of fotosPreparadas) {
      if (foto.tipo === 'UPLOAD') {
        const subida = await this.alertaRepo.subirFotografia({
          buffer: foto.buffer,
          contentType: foto.contentType,
          extension: foto.extension,
          prefijo: `fichas/${fichaCreada.id}`,
        });
        fotosParaGuardar.push(
          new Fotografia({
            fichaId: fichaCreada.id,
            url: subida.url,
            esPrincipal: foto.esPrincipal,
          })
        );
      } else {
        fotosParaGuardar.push(
          new Fotografia({
            fichaId: fichaCreada.id,
            url: foto.url,
            esPrincipal: foto.esPrincipal,
          })
        );
      }
    }

    const fotografiasGuardadas = await this.alertaRepo.crearFotografias(
      fichaCreada.id,
      fotosParaGuardar
    );

    const historialInicial = await this.alertaRepo.registrarHistorialEstado(
      new HistorialEstado({
        fichaId: fichaCreada.id,
        estadoNuevo: ESTADOS_FICHA.ACTIVA,
        resumenOMotivo: fichaCreada.sirdecCompletado
          ? fichaCreada.esAlertaRosa
            ? 'Creación de ficha de búsqueda con Alerta Rosa y formato SIRDEC completo.'
            : 'Creación inicial de ficha de búsqueda con formato SIRDEC completo.'
          : fichaCreada.esAlertaRosa
            ? 'Publicación temporal de Alerta Rosa (Ley 2326). Pendiente completar formato SIRDEC obligatorio en 1 día hábil.'
            : 'Publicación temporal de ficha de búsqueda. Pendiente completar formato SIRDEC obligatorio en 1 día hábil.',
        usuarioId: usuarioAutenticado.id,
      })
    );

    void this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.CREACION_FICHA_BUSQUEDA,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: fichaCreada.id,
        ip,
      },
      { silencioso: true }
    );

    fichaCreada.fotografias = fotografiasGuardadas;
    fichaCreada.historialEstados = [historialInicial];

    const fichaJson = fichaCreada.toJSON();

    // Despacho asíncrono no bloqueante (priorizando Alerta Rosa)
    this.notificacionService.encolarDifusionZona(fichaJson);

    return fichaJson;
  }

  /**
   * Lista alertas activas priorizando Alerta Rosa y más recientes (es_alerta_rosa DESC, created_at DESC).
   */
  async listarActivas(filtros = {}) {
    const resultado = await this.alertaRepo.listarActivas(filtros);
    return {
      total: resultado.total,
      pagina: resultado.pagina,
      limite: resultado.limite,
      alertas: resultado.items.map((ficha) => ficha.toJSON()),
    };
  }

  /**
   * Lista todas las fichas creadas por el usuario autenticado (Activas, Localizadas y Canceladas).
   */
  async listarMias(usuarioId) {
    const fichas = await this.alertaRepo.listarPorCreador(usuarioId);
    return {
      total: fichas.length,
      alertas: fichas.map((ficha) => ficha.toJSON()),
    };
  }

  /**
   * Obtiene el detalle completo de una ficha por ID.
   */
  async obtenerPorId(id) {
    const ficha = await this.alertaRepo.obtenerPorId(id);
    if (!ficha) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }
    return ficha.toJSON();
  }

  /**
   * Activa o desactiva Alerta Rosa validando Ley 2326 de 2023 y propiedad/rol.
   */
  async actualizarAlertaRosa(id, { esAlertaRosa, motivo }, usuarioAutenticado, ip = '0.0.0.0') {
    const fichaActual = await this.alertaRepo.obtenerPorId(id);
    if (!fichaActual) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    await this._validarPropiedadORol(fichaActual, usuarioAutenticado, ip);

    if (!fichaActual.estaActiva()) {
      throw new ValidationError(
        `No se puede modificar Alerta Rosa porque la ficha se encuentra en estado ${fichaActual.estado}.`
      );
    }

    const valorValidado = fichaActual.validarCambioAlertaRosa(Boolean(esAlertaRosa));
    const fichaActualizada = await this.alertaRepo.actualizarAlertaRosa(id, valorValidado);

    const resumen =
      motivo && String(motivo).trim().length >= 3
        ? String(motivo).trim()
        : valorValidado
          ? 'Activación de Alerta Rosa (Ley 2326 de 2023).'
          : 'Desactivación de Alerta Rosa.';

    const historial = await this.alertaRepo.registrarHistorialEstado(
      new HistorialEstado({
        fichaId: id,
        estadoNuevo: fichaActual.estado,
        resumenOMotivo: resumen,
        usuarioId: usuarioAutenticado.id,
      })
    );

    void this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.ACTUALIZACION_ALERTA_ROSA,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: id,
        ip,
      },
      { silencioso: true }
    );

    fichaActualizada.historialEstados = [historial, ...fichaActualizada.historialEstados];
    return fichaActualizada.toJSON();
  }

  /**
   * Cierra una alerta por localización de la persona (estado LOCALIZADA):
   * - Valida propiedad/rol (HTTP 403 si no es creador ni administrador).
   * - Detiene la difusión en la cola de notificaciones.
   * - Registra el resumen en HistorialEstado inmutable y en AuditoriaService.
   */
  async cerrarAlerta(id, { resumen }, usuarioAutenticado, ip = '0.0.0.0') {
    const fichaActual = await this.alertaRepo.obtenerPorId(id);
    if (!fichaActual) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    await this._validarPropiedadORol(fichaActual, usuarioAutenticado, ip);

    if (!fichaActual.estaActiva()) {
      throw new ValidationError(
        `La ficha ya no está activa (estado actual: ${fichaActual.estado}).`
      );
    }

    if (typeof resumen !== 'string' || resumen.trim().length < 5) {
      throw new ValidationError(
        'Debe ingresar un resumen del cierre por localización (mínimo 5 caracteres).'
      );
    }

    const fichaCerrada = await this.alertaRepo.actualizarEstado(id, ESTADOS_FICHA.LOCALIZADA);

    // Detener difusión de notificaciones de zona
    this.notificacionService.detenerDifusionFicha(id);

    const historial = await this.alertaRepo.registrarHistorialEstado(
      new HistorialEstado({
        fichaId: id,
        estadoNuevo: ESTADOS_FICHA.LOCALIZADA,
        resumenOMotivo: resumen.trim(),
        usuarioId: usuarioAutenticado.id,
      })
    );

    void this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.CIERRE_ALERTA_LOCALIZADA,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: id,
        ip,
      },
      { silencioso: true }
    );

    fichaCerrada.historialEstados = [historial, ...fichaCerrada.historialEstados];
    return fichaCerrada.toJSON();
  }

  /**
   * Cancela una alerta (estado CANCELADA):
   * - Valida propiedad/rol (HTTP 403 si no es creador ni administrador).
   * - Retira la ficha del mapa y listados públicos y detiene difusión.
   * - Registra el motivo en HistorialEstado inmutable y en AuditoriaService.
   */
  async cancelarAlerta(id, { motivo }, usuarioAutenticado, ip = '0.0.0.0') {
    const fichaActual = await this.alertaRepo.obtenerPorId(id);
    if (!fichaActual) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    await this._validarPropiedadORol(fichaActual, usuarioAutenticado, ip);

    if (!fichaActual.estaActiva()) {
      throw new ValidationError(
        `La ficha ya no está activa (estado actual: ${fichaActual.estado}).`
      );
    }

    if (typeof motivo !== 'string' || motivo.trim().length < 5) {
      throw new ValidationError(
        'Debe especificar el motivo de cancelación (mínimo 5 caracteres).'
      );
    }

    const fichaCancelada = await this.alertaRepo.actualizarEstado(id, ESTADOS_FICHA.CANCELADA);

    // Detener difusión de notificaciones de zona
    this.notificacionService.detenerDifusionFicha(id);

    const historial = await this.alertaRepo.registrarHistorialEstado(
      new HistorialEstado({
        fichaId: id,
        estadoNuevo: ESTADOS_FICHA.CANCELADA,
        resumenOMotivo: motivo.trim(),
        usuarioId: usuarioAutenticado.id,
      })
    );

    void this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: ACCIONES_AUDITORIA.CANCELACION_ALERTA,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: id,
        ip,
      },
      { silencioso: true }
    );

    fichaCancelada.historialEstados = [historial, ...fichaCancelada.historialEstados];
    return fichaCancelada.toJSON();
  }

  /**
   * Completa o actualiza los campos morfológicos SIRDEC (datos_sirdec) de una ficha.
   * Si se completan los 9 campos obligatorios:
   * - Marca `sirdecCompletado = true` (deja de ser publicación temporal).
   * - Si la ficha estaba en `SUSPENDIDA_SIRDEC`, la reactiva automáticamente a `ACTIVA`.
   */
  async actualizarDatosSirdec(id, datosSirdec, usuarioAutenticado, ip = '0.0.0.0') {
    const fichaActual = await this.alertaRepo.obtenerPorId(id);
    if (!fichaActual) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    await this._validarPropiedadORol(fichaActual, usuarioAutenticado, ip);

    const fusionados = {
      ...(fichaActual.datosSirdec || {}),
      ...(datosSirdec && typeof datosSirdec === 'object' ? datosSirdec : {}),
    };

    const evaluacion = evaluarCompletitudSirdec(fusionados);
    const acabaDeCompletar = evaluacion.completo && !fichaActual.sirdecCompletado;
    const debeReactivar = evaluacion.completo && fichaActual.estaSuspendidaPorSirdec();

    const fichaActualizada = await this.alertaRepo.actualizarDatosSirdec(id, {
      datosSirdec: fusionados,
      sirdecCompletado: evaluacion.completo,
      sirdecCompletadoEn: evaluacion.completo
        ? fichaActual.sirdecCompletadoEn || new Date().toISOString()
        : null,
      estado: debeReactivar ? ESTADOS_FICHA.ACTIVA : null,
    });

    if (debeReactivar) {
      const historialReact = await this.alertaRepo.registrarHistorialEstado(
        new HistorialEstado({
          fichaId: id,
          estadoNuevo: ESTADOS_FICHA.ACTIVA,
          resumenOMotivo:
            'Ficha reactivada automáticamente tras completar los campos obligatorios del formato SIRDEC.',
          usuarioId: usuarioAutenticado.id,
        })
      );
      fichaActualizada.historialEstados = [historialReact, ...fichaActualizada.historialEstados];

      void this.auditoriaService.registrar(
        {
          usuarioId: usuarioAutenticado.id,
          accion: ACCIONES_AUDITORIA.REACTIVACION_TRAS_SIRDEC,
          entidad: 'FICHAS_BUSQUEDA',
          entidadId: id,
          ip,
        },
        { silencioso: true }
      );

      this.notificacionService.encolarDifusionZona(fichaActualizada.toJSON());
    } else if (acabaDeCompletar) {
      const historialComp = await this.alertaRepo.registrarHistorialEstado(
        new HistorialEstado({
          fichaId: id,
          estadoNuevo: fichaActualizada.estado,
          resumenOMotivo:
            'Formato SIRDEC obligatorio completado. La ficha pasó de publicación temporal a registro definitivo.',
          usuarioId: usuarioAutenticado.id,
        })
      );
      fichaActualizada.historialEstados = [historialComp, ...fichaActualizada.historialEstados];
    }

    void this.auditoriaService.registrar(
      {
        usuarioId: usuarioAutenticado.id,
        accion: evaluacion.completo
          ? ACCIONES_AUDITORIA.SIRDEC_COMPLETADO
          : 'ACTUALIZACION_DATOS_SIRDEC',
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: id,
        ip,
      },
      { silencioso: true }
    );

    return {
      ficha: fichaActualizada.toJSON(),
      sirdec: evaluacion,
      reactivada: debeReactivar,
    };
  }

  /**
   * Suspende automáticamente las fichas temporales cuyo plazo de 1 día hábil venció sin completar SIRDEC.
   */
  async procesarFichasSirdecVencidas() {
    const vencidas = await this.alertaRepo.buscarPendientesSirdecVencidas();
    let suspendidas = 0;

    for (const ficha of vencidas) {
      try {
        await this.alertaRepo.actualizarEstado(ficha.id, ESTADOS_FICHA.SUSPENDIDA_SIRDEC);
        this.notificacionService.detenerDifusionFicha(ficha.id);

        await this.alertaRepo.registrarHistorialEstado(
          new HistorialEstado({
            fichaId: ficha.id,
            estadoNuevo: ESTADOS_FICHA.SUSPENDIDA_SIRDEC,
            resumenOMotivo:
              'Suspensión automática: venció el plazo de 1 día hábil sin completar el formato SIRDEC obligatorio. Puede reactivarse al diligenciar los campos requeridos.',
            usuarioId: ficha.creadorId,
          })
        );

        void this.auditoriaService.registrar(
          {
            usuarioId: ficha.creadorId,
            accion: ACCIONES_AUDITORIA.SUSPENSION_AUTOMATICA_SIRDEC,
            entidad: 'FICHAS_BUSQUEDA',
            entidadId: ficha.id,
            ip: '127.0.0.1',
          },
          { silencioso: true }
        );

        suspendidas += 1;
      } catch (err) {
        console.error(
          `[AlertaService] Error al suspender ficha vencida ${ficha.id}:`,
          err.message
        );
      }
    }

    return { revisadas: vencidas.length, suspendidas };
  }
}
