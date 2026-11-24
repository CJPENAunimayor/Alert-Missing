import { Router } from 'express';
import { z } from 'zod';
import { MapaController } from '../controllers/MapaController.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';

const puntosApoyoQuerySchema = z.object({
  lat: z.coerce
    .number({ required_error: 'La latitud (lat) es obligatoria.' })
    .min(-90, 'Latitud mínima -90.')
    .max(90, 'Latitud máxima 90.'),
  lng: z.coerce
    .number({ required_error: 'La longitud (lng) es obligatoria.' })
    .min(-180, 'Longitud mínima -180.')
    .max(180, 'Longitud máxima 180.'),
  radioKm: z.coerce.number().min(0.5).max(100).optional().default(5),
  tipo: z.enum(['TODOS', 'POLICIA', 'SALUD']).optional().default('TODOS'),
  limite: z.coerce.number().int().min(1).max(100).optional().default(30),
});

const marcadoresQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radioKm: z.coerce.number().positive().max(500).optional(),
  esAlertaRosa: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limite: z.coerce.number().int().min(1).max(200).optional().default(100),
});

export function createMapaRouter({ mapaController = new MapaController() } = {}) {
  const router = Router();

  const limiteMapa = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 100,
  });

  // GET /api/mapa/puntos-apoyo?lat=...&lng=...&radioKm=5&tipo=TODOS
  router.get(
    '/puntos-apoyo',
    limiteMapa,
    validarEntrada(puntosApoyoQuerySchema, 'query'),
    mapaController.obtenerPuntosApoyo
  );

  // GET /api/mapa/alertas?lat=...&lng=...&radioKm=...
  router.get(
    '/alertas',
    limiteMapa,
    validarEntrada(marcadoresQuerySchema, 'query'),
    mapaController.obtenerMarcadoresAlertas
  );

  return router;
}

const mapaRouter = createMapaRouter();
export default mapaRouter;
