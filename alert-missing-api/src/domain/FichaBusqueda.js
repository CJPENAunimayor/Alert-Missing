import { ValidationError } from '../shared/errors.js';
import { parsePostgisPoint, toPostgisPoint, validarCoordenadas } from '../shared/geo.js';
import { Fotografia } from './Fotografia.js';
import { HistorialEstado } from './HistorialEstado.js';

export const ESTADOS_FICHA = Object.freeze({
  ACTIVA: 'ACTIVA',
  LOCALIZADA: 'LOCALIZADA',
  CANCELADA: 'CANCELADA',
  SUSPENDIDA_SIRDEC: 'SUSPENDIDA_SIRDEC',
});

export const CAMPOS_SIRDEC_OBLIGATORIOS = Object.freeze([
  { clave: 'tipoDocumento', etiqueta: 'Tipo de documento' },
  { clave: 'numeroDocumento', etiqueta: 'Número de documento' },
  { clave: 'estaturaCm', etiqueta: 'Estatura aproximada (cm)' },
  { clave: 'contextura', etiqueta: 'Contextura corporal' },
  { clave: 'colorPiel', etiqueta: 'Color de piel' },
  { clave: 'colorCabello', etiqueta: 'Color de cabello' },
  { clave: 'colorOjos', etiqueta: 'Color de ojos' },
  { clave: 'departamentoDesaparicion', etiqueta: 'Departamento de desaparición' },
  { clave: 'municipioDesaparicion', etiqueta: 'Municipio de desaparición' },
]);

/**
 * Evalúa si los 9 campos obligatorios del formato SIRDEC están diligenciados.
 */
export function evaluarCompletitudSirdec(datosSirdec = {}) {
  const fuente = datosSirdec && typeof datosSirdec === 'object' ? datosSirdec : {};
  const faltantesObligatorios = [];

  for (const campo of CAMPOS_SIRDEC_OBLIGATORIOS) {
    const valor = fuente[campo.clave];
    const valido = valor !== undefined && valor !== null && String(valor).trim() !== '';
    if (!valido) {
      faltantesObligatorios.push(campo);
    }
  }

  const totalObligatorios = CAMPOS_SIRDEC_OBLIGATORIOS.length;
  const completadosObligatorios = totalObligatorios - faltantesObligatorios.length;

  return {
    completo: faltantesObligatorios.length === 0,
    totalObligatorios,
    completadosObligatorios,
    porcentaje: Math.round((completadosObligatorios / totalObligatorios) * 100),
    faltantesObligatorios,
  };
}

export const GENEROS = Object.freeze({
  FEMENINO: 'FEMENINO',
  MASCULINO: 'MASCULINO',
  NO_BINARIO: 'NO_BINARIO',
  OTRO: 'OTRO',
});

const MAPA_ALIASES_GENERO = Object.freeze({
  FEMENINO: GENEROS.FEMENINO,
  MUJER: GENEROS.FEMENINO,
  F: GENEROS.FEMENINO,
  MASCULINO: GENEROS.MASCULINO,
  HOMBRE: GENEROS.MASCULINO,
  M: GENEROS.MASCULINO,
  NO_BINARIO: GENEROS.NO_BINARIO,
  'NO BINARIO': GENEROS.NO_BINARIO,
  OTRO: GENEROS.OTRO,
});

export function normalizarGenero(genero) {
  if (typeof genero !== 'string' || genero.trim().length === 0) {
    throw new ValidationError('El género de la persona desaparecida es obligatorio.');
  }
  const clave = genero.trim().toUpperCase();
  const normalizado = MAPA_ALIASES_GENERO[clave];
  if (!normalizado) {
    throw new ValidationError(
      `Género no válido: "${genero}". Valores permitidos: FEMENINO, MASCULINO, NO_BINARIO, OTRO.`
    );
  }
  return normalizado;
}

export function validarEdad(edad) {
  if (edad === null || edad === undefined || edad === '') {
    throw new ValidationError('La edad de la persona desaparecida es obligatoria.');
  }
  const edadNum = Number(edad);
  if (!Number.isInteger(edadNum) || edadNum < 0 || edadNum > 130) {
    throw new ValidationError('La edad debe ser un número entero entre 0 y 130 años.');
  }
  return edadNum;
}

/**
 * Regla de negocio Ley 2326 de 2023 (Alerta Rosa - Colombia):
 * La Alerta Rosa aplica exclusivamente para mujeres de cualquier edad o menores de 18 años.
 */
export function esElegibleAlertaRosa({ genero, edad }) {
  const generoNorm = normalizarGenero(genero);
  const edadNorm = validarEdad(edad);
  return generoNorm === GENEROS.FEMENINO || edadNorm < 18;
}

export function validarReglaAlertaRosa({ genero, edad, esAlertaRosa }) {
  if (!esAlertaRosa) {
    return false;
  }
  if (!esElegibleAlertaRosa({ genero, edad })) {
    throw new ValidationError(
      'No es posible activar la Alerta Rosa (Ley 2326 de 2023): solo aplica para mujeres o personas menores de 18 años.'
    );
  }
  return true;
}

export class FichaBusqueda {
  constructor({
    id = null,
    nombreDesaparecido,
    edad,
    genero,
    senasParticulares = null,
    vestimenta = null,
    datosSirdec = {},
    fechaHoraUltimoContacto,
    lat,
    lng,
    direccionTexto = null,
    radioBusquedaKm = 5,
    esAlertaRosa = false,
    estado = ESTADOS_FICHA.ACTIVA,
    sirdecCompletado = false,
    sirdecFechaLimite = null,
    sirdecCompletadoEn = null,
    creadorId,
    createdAt = null,
    fotografias = [],
    historialEstados = [],
  }) {
    if (typeof nombreDesaparecido !== 'string' || nombreDesaparecido.trim().length < 3) {
      throw new ValidationError(
        'El nombre de la persona desaparecida es obligatorio (mínimo 3 caracteres).'
      );
    }

    const edadValidada = validarEdad(edad);
    const generoValidado = normalizarGenero(genero);
    const alertaRosaValidada = validarReglaAlertaRosa({
      genero: generoValidado,
      edad: edadValidada,
      esAlertaRosa: Boolean(esAlertaRosa),
    });

    const fecha = new Date(fechaHoraUltimoContacto);
    if (!fechaHoraUltimoContacto || Number.isNaN(fecha.getTime())) {
      throw new ValidationError('La fecha y hora de último contacto no es válida.');
    }

    const coords = validarCoordenadas(lat, lng);

    const radioNum = Number(radioBusquedaKm ?? 5);
    if (!Number.isFinite(radioNum) || radioNum <= 0 || radioNum > 200) {
      throw new ValidationError('El radio de búsqueda debe ser un número mayor a 0 y máximo 200 km.');
    }

    const estadoNorm = String(estado || ESTADOS_FICHA.ACTIVA).trim().toUpperCase();
    if (!Object.values(ESTADOS_FICHA).includes(estadoNorm)) {
      throw new ValidationError(`Estado de ficha no válido: ${estado}`);
    }

    if (!creadorId || typeof creadorId !== 'string') {
      throw new ValidationError('El identificador del usuario creador es obligatorio.');
    }

    this.id = id;
    this.nombreDesaparecido = nombreDesaparecido.trim().replace(/\s+/g, ' ');
    this.edad = edadValidada;
    this.genero = generoValidado;
    this.senasParticulares = senasParticulares ? String(senasParticulares).trim() : null;
    this.vestimenta = vestimenta ? String(vestimenta).trim() : null;
    this.datosSirdec =
      datosSirdec && typeof datosSirdec === 'object' && !Array.isArray(datosSirdec)
        ? datosSirdec
        : {};
    this.fechaHoraUltimoContacto = fecha.toISOString();
    this.lat = coords.lat;
    this.lng = coords.lng;
    this.direccionTexto = direccionTexto ? String(direccionTexto).trim() : null;
    this.radioBusquedaKm = Number(radioNum.toFixed(2));
    this.esAlertaRosa = alertaRosaValidada;
    this.estado = estadoNorm;
    this.sirdecCompletado = Boolean(sirdecCompletado);
    this.sirdecFechaLimite = sirdecFechaLimite || null;
    this.sirdecCompletadoEn = sirdecCompletadoEn || null;
    this.creadorId = creadorId;
    this.createdAt = createdAt;
    this.fotografias = Array.isArray(fotografias)
      ? fotografias.map((f) => (f instanceof Fotografia ? f : Fotografia.fromPersistence(f)))
      : [];
    this.historialEstados = Array.isArray(historialEstados)
      ? historialEstados.map((h) =>
          h instanceof HistorialEstado ? h : HistorialEstado.fromPersistence(h)
        )
      : [];
  }

  estaActiva() {
    return this.estado === ESTADOS_FICHA.ACTIVA;
  }

  estaSuspendidaPorSirdec() {
    return this.estado === ESTADOS_FICHA.SUSPENDIDA_SIRDEC;
  }

  evaluarCompletitudSirdec() {
    return evaluarCompletitudSirdec(this.datosSirdec);
  }

  validarCambioAlertaRosa(nuevoValor) {
    return validarReglaAlertaRosa({
      genero: this.genero,
      edad: this.edad,
      esAlertaRosa: Boolean(nuevoValor),
    });
  }

  toPointWKT() {
    return toPostgisPoint(this.lat, this.lng);
  }

  static fromPersistence(row) {
    if (!row) return null;
    const punto = parsePostgisPoint(row.ubicacion_ultimo_contacto);
    if (!punto) {
      throw new ValidationError(
        `No se pudieron interpretar las coordenadas almacenadas para la ficha ${row.id}.`
      );
    }

    return new FichaBusqueda({
      id: row.id,
      nombreDesaparecido: row.nombre_desaparecido,
      edad: row.edad,
      genero: row.genero,
      senasParticulares: row.senas_particulares,
      vestimenta: row.vestimenta,
      datosSirdec: row.datos_sirdec || {},
      fechaHoraUltimoContacto: row.fecha_hora_ultimo_contacto,
      lat: punto.lat,
      lng: punto.lng,
      direccionTexto: row.direccion_texto,
      radioBusquedaKm: Number(row.radio_busqueda_km),
      esAlertaRosa: row.es_alerta_rosa,
      estado: row.estado,
      sirdecCompletado: Boolean(row.sirdec_completado),
      sirdecFechaLimite: row.sirdec_fecha_limite || null,
      sirdecCompletadoEn: row.sirdec_completado_en || null,
      creadorId: row.creador_id,
      createdAt: row.created_at,
      fotografias: row.fotografias || [],
      historialEstados: row.historial_estados || [],
    });
  }

  toPersistence() {
    const payload = {
      nombre_desaparecido: this.nombreDesaparecido,
      edad: this.edad,
      genero: this.genero,
      senas_particulares: this.senasParticulares,
      vestimenta: this.vestimenta,
      datos_sirdec: this.datosSirdec,
      fecha_hora_ultimo_contacto: this.fechaHoraUltimoContacto,
      ubicacion_ultimo_contacto: this.toPointWKT(),
      direccion_texto: this.direccionTexto,
      radio_busqueda_km: this.radioBusquedaKm,
      es_alerta_rosa: this.esAlertaRosa,
      estado: this.estado,
      sirdec_completado: this.sirdecCompletado,
      sirdec_fecha_limite: this.sirdecFechaLimite,
      sirdec_completado_en: this.sirdecCompletadoEn,
      creador_id: this.creadorId,
    };
    if (this.id) {
      payload.id = this.id;
    }
    return payload;
  }

  toJSON() {
    return {
      id: this.id,
      nombreDesaparecido: this.nombreDesaparecido,
      edad: this.edad,
      genero: this.genero,
      senasParticulares: this.senasParticulares,
      vestimenta: this.vestimenta,
      datosSirdec: this.datosSirdec,
      fechaHoraUltimoContacto: this.fechaHoraUltimoContacto,
      ubicacionUltimoContacto: {
        lat: this.lat,
        lng: this.lng,
      },
      direccionTexto: this.direccionTexto,
      radioBusquedaKm: this.radioBusquedaKm,
      esAlertaRosa: this.esAlertaRosa,
      estado: this.estado,
      sirdecCompletado: this.sirdecCompletado,
      sirdecFechaLimite: this.sirdecFechaLimite,
      sirdecCompletadoEn: this.sirdecCompletadoEn,
      esTemporal: this.estado === ESTADOS_FICHA.ACTIVA && !this.sirdecCompletado,
      resumenSirdec: this.evaluarCompletitudSirdec(),
      creadorId: this.creadorId,
      createdAt: this.createdAt,
      fotografias: this.fotografias.map((f) => f.toJSON()),
      historialEstados: this.historialEstados.map((h) => h.toJSON()),
    };
  }
}
