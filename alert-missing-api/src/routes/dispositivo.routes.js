import { Router } from 'express';
import { z } from 'zod';
import { DispositivoController } from '../controllers/DispositivoController.js';
import { validarTokenOpcional } from '../middleware/JwtAuthMiddleware.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';

const suscribirDispositivoSchema = z
  .object({
    oneSignalId: z
      .string({ required_error: 'El identificador oneSignalId es obligatorio.' })
      .trim()
      .min(5, 'El identificador oneSignalId no es válido.')
      .max(200),
    lat: z.coerce.number().min(-90).max(90).optional().nullable(),
    lng: z.coerce.number().min(-180).max(180).optional().nullable(),
    permisoNotificaciones: z.boolean().optional().default(true),
    permisoUbicacion: z.boolean().optional().default(false),
  })
  .refine(
    (data) =>
      (data.lat === undefined || data.lat === null) ===
      (data.lng === undefined || data.lng === null),
    {
      message: 'Si envía coordenadas, debe incluir tanto lat como lng.',
    }
  );

export function createDispositivoRouter({
  dispositivoController = new DispositivoController(),
  authMiddleware = { validarTokenOpcional },
} = {}) {
  const router = Router();

  const limiteSuscripcion = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 60,
  });

  // POST /api/dispositivos/suscribir
  router.post(
    '/suscribir',
    limiteSuscripcion,
    authMiddleware.validarTokenOpcional,
    validarEntrada(suscribirDispositivoSchema, 'body'),
    dispositivoController.suscribir
  );

  return router;
}

const dispositivoRouter = createDispositivoRouter();
export default dispositivoRouter;
