import { ValidationError } from '../shared/errors.js';
import { validarCoordenadas } from '../shared/geo.js';

export const TIPOS_PUNTO_APOYO = Object.freeze({
  POLICIA: 'POLICIA',
  SALUD: 'SALUD',
});

export class PuntoApoyo {
  constructor({
    id,
    tipo,
    subtipo = null,
    nombre,
    lat,
    lng,
    direccion = null,
    telefono = null,
    municipio = null,
    distanciaKm = null,
    fuente = 'OpenStreetMap',
  }) {
    if (!Object.values(TIPOS_PUNTO_APOYO).includes(tipo)) {
      throw new ValidationError(`Tipo de punto de apoyo no válido: ${tipo}`);
    }

    const coords = validarCoordenadas(lat, lng);

    this.id = String(id);
    this.tipo = tipo;
    this.subtipo = subtipo || null;
    this.nombre =
      typeof nombre === 'string' && nombre.trim().length > 0
        ? nombre.trim()
        : tipo === TIPOS_PUNTO_APOYO.POLICIA
          ? 'Estación de Policía / CAI'
          : 'Centro de Salud / Hospital';
    this.lat = coords.lat;
    this.lng = coords.lng;
    this.direccion = direccion ? String(direccion).trim() : null;
    this.telefono = telefono ? String(telefono).trim() : null;
    this.municipio = municipio ? String(municipio).trim() : null;
    this.distanciaKm =
      distanciaKm !== null && distanciaKm !== undefined ? Number(distanciaKm) : null;
    this.fuente = fuente;
  }

  toJSON() {
    return {
      id: this.id,
      tipo: this.tipo,
      subtipo: this.subtipo,
      nombre: this.nombre,
      lat: this.lat,
      lng: this.lng,
      direccion: this.direccion,
      telefono: this.telefono,
      municipio: this.municipio,
      distanciaKm: this.distanciaKm,
      fuente: this.fuente,
    };
  }
}
