import { PuntoApoyo, TIPOS_PUNTO_APOYO } from '../domain/PuntoApoyo.js';
import { OverpassClient } from '../integrations/overpassClient.js';
import { ValidationError } from '../shared/errors.js';
import { calcularDistanciaKm, validarCoordenadas } from '../shared/geo.js';

const RADIOS_EXPANSION_RURAL_KM = [15, 35, 75];

function construirDireccionOsm(tags = {}) {
  const partes = [
    tags['addr:street'],
    tags['addr:housenumber'],
    tags['addr:neighbourhood'] || tags['addr:suburb'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:municipality'],
  ].filter(Boolean);

  return partes.length > 0 ? partes.join(', ') : tags['addr:full'] || null;
}

function mapearElementoOsm(elemento, origenLat, origenLng) {
  const tags = elemento.tags || {};
  const amenity = tags.amenity;
  if (!['police', 'hospital', 'clinic'].includes(amenity)) {
    return null;
  }

  const lat = elemento.lat ?? elemento.center?.lat;
  const lng = elemento.lon ?? elemento.center?.lon;
  if (lat === undefined || lng === undefined) {
    return null;
  }

  const tipo = amenity === 'police' ? TIPOS_PUNTO_APOYO.POLICIA : TIPOS_PUNTO_APOYO.SALUD;
  const distanciaKm = calcularDistanciaKm(origenLat, origenLng, Number(lat), Number(lng));

  return new PuntoApoyo({
    id: `${elemento.type}/${elemento.id}`,
    tipo,
    subtipo: amenity,
    nombre: tags.name || tags.official_name || tags.operator || null,
    lat: Number(lat),
    lng: Number(lng),
    direccion: construirDireccionOsm(tags),
    telefono: tags.phone || tags['contact:phone'] || tags['phone:emergency'] || null,
    municipio: tags['addr:city'] || tags['addr:town'] || tags['addr:municipality'] || null,
    distanciaKm,
  });
}

function seleccionarAmenitiesPorTipo(tipoFiltro) {
  const filtro = String(tipoFiltro || 'TODOS').trim().toUpperCase();
  if (filtro === TIPOS_PUNTO_APOYO.POLICIA) {
    return ['police'];
  }
  if (filtro === TIPOS_PUNTO_APOYO.SALUD) {
    return ['hospital', 'clinic'];
  }
  if (filtro === 'TODOS') {
    return ['police', 'hospital', 'clinic'];
  }
  throw new ValidationError('El filtro "tipo" debe ser TODOS, POLICIA o SALUD.');
}

export class GeoService {
  constructor(overpassClient = new OverpassClient()) {
    this.overpassClient = overpassClient;
  }

  /**
   * Obtiene puntos de apoyo cercanos (estaciones/CAI de policía y centros médicos) usando Overpass API.
   * Si en el radio inicial no existen resultados (zonas rurales), amplía progresivamente el radio
   * hasta localizar la estación municipal o centro médico más cercano.
   */
  async obtenerPuntosApoyoCercanos({ lat, lng, radioKm = 5, tipo = 'TODOS', limite = 30 }) {
    const coords = validarCoordenadas(lat, lng);
    const radioInicialKm = Number(radioKm);
    if (!Number.isFinite(radioInicialKm) || radioInicialKm <= 0 || radioInicialKm > 100) {
      throw new ValidationError('El parámetro radioKm debe estar entre 0.5 y 100 km.');
    }

    const amenities = seleccionarAmenitiesPorTipo(tipo);
    const requierePolicia = amenities.includes('police');

    let radioAplicadoKm = radioInicialKm;
    let busquedaAmpliadaRural = false;
    let elementos = await this.overpassClient.consultarPuntosApoyo({
      lat: coords.lat,
      lng: coords.lng,
      radioMetros: radioInicialKm * 1000,
      amenities,
    });

    let puntos = this._normalizarYOrdenar(elementos, coords.lat, coords.lng);

    // Ampliación progresiva en zonas rurales si no hay resultados o no se halló estación policial
    const necesitaAmpliar = () =>
      puntos.length === 0 ||
      (requierePolicia && !puntos.some((p) => p.tipo === TIPOS_PUNTO_APOYO.POLICIA));

    if (necesitaAmpliar()) {
      for (const radioRuralKm of RADIOS_EXPANSION_RURAL_KM) {
        if (radioRuralKm <= radioAplicadoKm) continue;

        const amenitiesExpansion =
          puntos.length > 0 && requierePolicia ? ['police'] : amenities;

        const elementosExtra = await this.overpassClient.consultarPuntosApoyo({
          lat: coords.lat,
          lng: coords.lng,
          radioMetros: radioRuralKm * 1000,
          amenities: amenitiesExpansion,
        });

        const nuevosPuntos = this._normalizarYOrdenar(elementosExtra, coords.lat, coords.lng);
        if (nuevosPuntos.length > 0) {
          puntos = this._combinarUnicos([...puntos, ...nuevosPuntos]);
          radioAplicadoKm = radioRuralKm;
          busquedaAmpliadaRural = true;
        } else {
          radioAplicadoKm = radioRuralKm;
          busquedaAmpliadaRural = true;
        }

        if (!necesitaAmpliar()) {
          break;
        }
      }
    }

    const puntosLimitados = puntos.slice(0, limite);
    const policia = puntosLimitados.filter((p) => p.tipo === TIPOS_PUNTO_APOYO.POLICIA);
    const salud = puntosLimitados.filter((p) => p.tipo === TIPOS_PUNTO_APOYO.SALUD);

    return {
      centro: coords,
      radioInicialKm,
      radioAplicadoKm,
      busquedaAmpliadaRural,
      estacionMunicipalMasCercana: policia[0]?.toJSON() || null,
      centroSaludMasCercano: salud[0]?.toJSON() || null,
      total: puntosLimitados.length,
      policia: policia.map((p) => p.toJSON()),
      salud: salud.map((p) => p.toJSON()),
      puntos: puntosLimitados.map((p) => p.toJSON()),
    };
  }

  _normalizarYOrdenar(elementos, origenLat, origenLng) {
    const mapa = new Map();
    for (const el of elementos) {
      const punto = mapearElementoOsm(el, origenLat, origenLng);
      if (punto && !mapa.has(punto.id)) {
        mapa.set(punto.id, punto);
      }
    }
    return [...mapa.values()].sort((a, b) => a.distanciaKm - b.distanciaKm);
  }

  _combinarUnicos(lista) {
    const mapa = new Map();
    for (const punto of lista) {
      if (!mapa.has(punto.id)) {
        mapa.set(punto.id, punto);
      }
    }
    return [...mapa.values()].sort((a, b) => a.distanciaKm - b.distanciaKm);
  }
}
