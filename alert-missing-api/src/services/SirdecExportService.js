import PDFDocument from 'pdfkit';
import { ACCIONES_AUDITORIA } from '../domain/RegistroAuditoria.js';
import { AlertaRepo } from '../repositories/AlertaRepo.js';
import { AvistamientoRepo } from '../repositories/AvistamientoRepo.js';
import { UsuarioRepo } from '../repositories/UsuarioRepo.js';
import { AuditoriaService } from './AuditoriaService.js';
import { NotFoundError } from '../shared/errors.js';

const CAMPOS_MORFOLOGICOS_SIRDEC = [
  { clave: 'tipoDocumento', etiqueta: 'Tipo de documento del desaparecido' },
  { clave: 'numeroDocumento', etiqueta: 'Número de documento del desaparecido' },
  { clave: 'estaturaCm', etiqueta: 'Estatura aproximada (cm)' },
  { clave: 'pesoKg', etiqueta: 'Peso aproximado (kg)' },
  { clave: 'contextura', etiqueta: 'Contextura corporal' },
  { clave: 'colorPiel', etiqueta: 'Color de piel' },
  { clave: 'colorCabello', etiqueta: 'Color de cabello' },
  { clave: 'tipoCabello', etiqueta: 'Tipo / longitud de cabello' },
  { clave: 'colorOjos', etiqueta: 'Color de ojos' },
  { clave: 'tipoDentadura', etiqueta: 'Características dentales' },
  { clave: 'cicatrices', etiqueta: 'Cicatrices o marcas quirúrgicas' },
  { clave: 'tatuajes', etiqueta: 'Tatuajes (ubicación y descripción)' },
  { clave: 'departamentoDesaparicion', etiqueta: 'Departamento de desaparición' },
  { clave: 'municipioDesaparicion', etiqueta: 'Municipio de desaparición' },
];

function formatearFechaLegible(iso) {
  if (!iso) return 'No registrada';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export class SirdecExportService {
  constructor({
    alertaRepo = new AlertaRepo(),
    avistamientoRepo = new AvistamientoRepo(),
    usuarioRepo = new UsuarioRepo(),
    auditoriaService = new AuditoriaService(),
  } = {}) {
    this.alertaRepo = alertaRepo;
    this.avistamientoRepo = avistamientoRepo;
    this.usuarioRepo = usuarioRepo;
    this.auditoriaService = auditoriaService;
  }

  /**
   * Construye el documento estructurado compatible con SIRDEC (Fiscalía / Medicina Legal).
   */
  async construirEstructuraSirdec(fichaId) {
    const ficha = await this.alertaRepo.obtenerPorId(fichaId);
    if (!ficha) {
      throw new NotFoundError('Ficha de búsqueda no encontrada.');
    }

    const [denunciante, avistamientosAprobados] = await Promise.all([
      this.usuarioRepo.buscarPorId(ficha.creadorId).catch(() => null),
      this.avistamientoRepo
        .listarPorFicha(ficha.id, { incluirTodos: false })
        .catch(() => []),
    ]);

    const datosSirdec = ficha.datosSirdec || {};
    const datosMorfologicos = {};
    const camposFaltantes = [];

    for (const campo of CAMPOS_MORFOLOGICOS_SIRDEC) {
      const valor = datosSirdec[campo.clave];
      const tieneValor = valor !== undefined && valor !== null && String(valor).trim() !== '';
      datosMorfologicos[campo.clave] = tieneValor ? valor : null;
      if (!tieneValor) {
        camposFaltantes.push(campo.etiqueta);
      }
    }

    return {
      metadatosExportacion: {
        formato: 'SIRDEC-CO-COMPATIBLE',
        version: '1.0',
        plataforma: 'Alert Missing Colombia',
        fechaGeneracion: new Date().toISOString(),
        marcoNormativo: ficha.esAlertaRosa
          ? ['Ley 2326 de 2023 (Alerta Rosa)', 'Ley 589 de 2000 (MBU)', 'Ley 1581 de 2012 (Hábeas Data)']
          : ['Ley 589 de 2000 (MBU)', 'Ley 1581 de 2012 (Hábeas Data)'],
      },
      identificacionCaso: {
        fichaId: ficha.id,
        estado: ficha.estado,
        esAlertaRosa: ficha.esAlertaRosa,
        fechaCreacion: ficha.createdAt,
      },
      datosDesaparecido: {
        nombreCompleto: ficha.nombreDesaparecido,
        edad: ficha.edad,
        genero: ficha.genero,
        senasParticulares: ficha.senasParticulares || null,
        vestimenta: ficha.vestimenta || null,
      },
      hechosYGeorreferenciacion: {
        fechaHoraUltimoContacto: ficha.fechaHoraUltimoContacto,
        direccionTexto: ficha.direccionTexto || null,
        coordenadasWGS84: {
          lat: ficha.lat,
          lng: ficha.lng,
        },
        radioBusquedaKm: ficha.radioBusquedaKm,
      },
      datosMorfologicosSirdec: datosMorfologicos,
      camposFaltantesParaInstitucion: camposFaltantes,
      denunciante: denunciante
        ? {
            nombreCompleto: denunciante.nombreCompleto,
            documento: denunciante.documento,
            telefono: denunciante.telefono,
            correo: denunciante.correo,
          }
        : null,
      fotografias: ficha.fotografias.map((f) => ({
        url: f.url,
        esPrincipal: f.esPrincipal,
      })),
      avistamientosConfirmados: avistamientosAprobados.map((av) => av.toPublicJSON()),
      trazabilidadInmutable: ficha.historialEstados.map((h) => h.toJSON()),
    };
  }

  async exportarJson(fichaId, { usuarioId = null, ip = '0.0.0.0' } = {}) {
    const estructura = await this.construirEstructuraSirdec(fichaId);

    void this.auditoriaService.registrar(
      {
        usuarioId,
        accion: ACCIONES_AUDITORIA.EXPORTACION_SIRDEC,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: fichaId,
        ip,
      },
      { silencioso: true }
    );

    return estructura;
  }

  /**
   * Genera un documento PDF compatible con SIRDEC usando PDFKit, indicando explícitamente
   * los campos morfológicos faltantes por completar ante Fiscalía / Medicina Legal.
   */
  async exportarPdf(fichaId, { usuarioId = null, ip = '0.0.0.0' } = {}) {
    const datos = await this.construirEstructuraSirdec(fichaId);

    void this.auditoriaService.registrar(
      {
        usuarioId,
        accion: ACCIONES_AUDITORIA.EXPORTACION_SIRDEC,
        entidad: 'FICHAS_BUSQUEDA',
        entidadId: fichaId,
        ip,
      },
      { silencioso: true }
    );

    const buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Encabezado institucional
      const colorHeader = datos.identificacionCaso.esAlertaRosa ? '#ad1457' : '#0f2942';
      doc.rect(0, 0, doc.page.width, 84).fill(colorHeader);
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(16)
        .text('ALERT MISSING COLOMBIA — FICHA COMPATIBLE SIRDEC', 48, 22);
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(
          'Documento de apoyo para radicación ante Fiscalía General de la Nación / Medicina Legal (SIRDEC)',
          48,
          44
        );
      if (datos.identificacionCaso.esAlertaRosa) {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .text('PRIORIDAD MÁXIMA — ALERTA ROSA ACTIVA (LEY 2326 DE 2023)', 48, 60);
      }

      doc.fillColor('#142130').moveDown(3);

      const escribirSeccion = (titulo) => {
        doc
          .moveDown(0.6)
          .font('Helvetica-Bold')
          .fontSize(12)
          .fillColor(colorHeader)
          .text(titulo);
        doc
          .moveTo(48, doc.y + 2)
          .lineTo(doc.page.width - 48, doc.y + 2)
          .strokeColor('#cbd5e1')
          .stroke();
        doc.moveDown(0.4).fillColor('#142130').font('Helvetica').fontSize(10);
      };

      const escribirLinea = (etiqueta, valor) => {
        doc
          .font('Helvetica-Bold')
          .text(`${etiqueta}: `, { continued: true })
          .font('Helvetica')
          .text(valor ?? 'Sin registrar');
      };

      escribirSeccion('1. IDENTIFICACIÓN DEL CASO');
      escribirLinea('ID de ficha', datos.identificacionCaso.fichaId);
      escribirLinea('Estado actual', datos.identificacionCaso.estado);
      escribirLinea('Alerta Rosa (Ley 2326)', datos.identificacionCaso.esAlertaRosa ? 'SÍ' : 'NO');
      escribirLinea('Fecha de generación', formatearFechaLegible(datos.metadatosExportacion.fechaGeneracion));

      escribirSeccion('2. DATOS DE LA PERSONA DESAPARECIDA');
      escribirLinea('Nombre completo', datos.datosDesaparecido.nombreCompleto);
      escribirLinea('Edad', `${datos.datosDesaparecido.edad} años`);
      escribirLinea('Género', datos.datosDesaparecido.genero);
      escribirLinea('Señas particulares', datos.datosDesaparecido.senasParticulares || 'No registradas');
      escribirLinea('Vestimenta', datos.datosDesaparecido.vestimenta || 'No registrada');

      escribirSeccion('3. HECHOS Y GEORREFERENCIACIÓN (WGS84)');
      escribirLinea(
        'Último contacto',
        formatearFechaLegible(datos.hechosYGeorreferenciacion.fechaHoraUltimoContacto)
      );
      escribirLinea(
        'Dirección / referencia',
        datos.hechosYGeorreferenciacion.direccionTexto || 'No registrada'
      );
      escribirLinea(
        'Coordenadas',
        `${datos.hechosYGeorreferenciacion.coordenadasWGS84.lat}, ${datos.hechosYGeorreferenciacion.coordenadasWGS84.lng}`
      );
      escribirLinea('Radio inicial de búsqueda', `${datos.hechosYGeorreferenciacion.radioBusquedaKm} km`);

      escribirSeccion('4. DATOS MORFOLÓGICOS SIRDEC');
      for (const campo of CAMPOS_MORFOLOGICOS_SIRDEC) {
        const val = datos.datosMorfologicosSirdec[campo.clave];
        escribirLinea(campo.etiqueta, val !== null ? String(val) : '[PENDIENTE POR COMPLETAR]');
      }

      // Aviso explícito de campos morfológicos faltantes para la institución
      if (datos.camposFaltantesParaInstitucion.length > 0) {
        doc.moveDown(0.8);
        doc
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .fillColor('#b45309')
          .text(
            `AVISO PARA RADICACIÓN INSTITUCIONAL (${datos.camposFaltantesParaInstitucion.length} campos morfológicos pendientes):`
          );
        doc
          .font('Helvetica')
          .fontSize(9.5)
          .fillColor('#78350f')
          .text(
            'Los siguientes campos requeridos habitualmente por SIRDEC (Fiscalía / Medicina Legal) no fueron suministrados en la plataforma y deben completarse ante la autoridad competente:'
          );
        doc.moveDown(0.2);
        for (const faltante of datos.camposFaltantesParaInstitucion) {
          doc.text(`  • ${faltante}`);
        }
        doc.fillColor('#142130');
      }

      escribirSeccion('5. DATOS DEL DENUNCIANTE');
      if (datos.denunciante) {
        escribirLinea('Nombre', datos.denunciante.nombreCompleto);
        escribirLinea('Documento', datos.denunciante.documento || 'No registrado');
        escribirLinea('Teléfono', datos.denunciante.telefono || 'No registrado');
        escribirLinea('Correo electrónico', datos.denunciante.correo);
      } else {
        doc.text('Información del denunciante no disponible.');
      }

      escribirSeccion(`6. FOTOGRAFÍAS REGISTRADAS (${datos.fotografias.length})`);
      if (datos.fotografias.length === 0) {
        doc.text('No se registraron fotografías.');
      } else {
        datos.fotografias.forEach((foto, idx) => {
          doc.text(`${idx + 1}. ${foto.esPrincipal ? '[PRINCIPAL] ' : ''}${foto.url}`);
        });
      }

      escribirSeccion(`7. AVISTAMIENTOS CONFIRMADOS (${datos.avistamientosConfirmados.length})`);
      if (datos.avistamientosConfirmados.length === 0) {
        doc.text('Sin avistamientos aprobados a la fecha de generación.');
      } else {
        datos.avistamientosConfirmados.forEach((av, idx) => {
          doc.text(
            `${idx + 1}. [${formatearFechaLegible(av.fechaHora)}] (${av.coordenadas.lat}, ${
              av.coordenadas.lng
            }) — ${av.descripcion}`
          );
        });
      }

      escribirSeccion('8. HISTORIAL INMUTABLE DE ESTADOS');
      if (datos.trazabilidadInmutable.length === 0) {
        doc.text('Sin registros de historial.');
      } else {
        datos.trazabilidadInmutable.forEach((h) => {
          doc.text(`• [${formatearFechaLegible(h.fecha)}] ${h.estadoNuevo}: ${h.resumenOMotivo}`);
        });
      }

      doc
        .moveDown(1)
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor('#4b5c70')
        .text(
          'Líneas de emergencia Colombia: 123 (Policía Nacional) · 122 (Fiscalía — MBU) · 141 (ICBF). Este documento no sustituye la denuncia formal ante la Fiscalía General de la Nación.'
        );

      doc.end();
    });

    return {
      buffer,
      nombreArchivo: `ficha-sirdec-${fichaId}.pdf`,
    };
  }
}
