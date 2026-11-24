import { AlertaService } from '../services/AlertaService.js';
import { GeoService } from '../services/GeoService.js';

export class MapaController {
  constructor({
    geoService = new GeoService(),
    alertaService = new AlertaService(),
  } = {}) {
    this.geoService = geoService;
    this.alertaService = alertaService;
  }

  obtenerPuntosApoyo = async (req, res, next) => {
    try {
      const resultado = await this.geoService.obtenerPuntosApoyoCercanos(req.query);
      return res.status(200).json(resultado);
    } catch (error) {
      return next(error);
    }
  };

  obtenerMarcadoresAlertas = async (req, res, next) => {
    try {
      const { lat, lng, radioKm, esAlertaRosa, limite = 100 } = req.query;
      const resultado = await this.alertaService.listarActivas({
        lat,
        lng,
        radioKm,
        esAlertaRosa,
        pagina: 1,
        limite,
      });

      const marcadores = resultado.alertas.map((ficha) => ({
        id: ficha.id,
        nombreDesaparecido: ficha.nombreDesaparecido,
        edad: ficha.edad,
        genero: ficha.genero,
        esAlertaRosa: ficha.esAlertaRosa,
        radioBusquedaKm: ficha.radioBusquedaKm,
        direccionTexto: ficha.direccionTexto,
        fechaHoraUltimoContacto: ficha.fechaHoraUltimoContacto,
        ubicacion: ficha.ubicacionUltimoContacto,
        fotoPrincipal:
          ficha.fotografias.find((f) => f.esPrincipal)?.url ||
          ficha.fotografias[0]?.url ||
          null,
      }));

      return res.status(200).json({
        total: resultado.total,
        marcadores,
      });
    } catch (error) {
      return next(error);
    }
  };
}
