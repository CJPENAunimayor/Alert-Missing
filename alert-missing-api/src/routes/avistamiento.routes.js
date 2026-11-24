import { Router } from 'express';
import { z } from 'zod';
import { AvistamientoController } from '../controllers/AvistamientoController.js';
import { validarToken, validarTokenOpcional } from '../middleware/JwtAuthMiddleware.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';
import { obtenerIpCliente } from '../shared/http.js';

const fichaIdParamSchema = z.object({
  fichaId: z.string().uuid('El identificador de la ficha debe ser un UUID válido.'),
});

const avistamientoIdParamSchema = z.object({
  id: z.string().uuid('El identificador del avistamiento debe ser un UUID válido.'),
});

const listarQuerySchema = z.object({
  estado: z.enum(['PENDIENTE', 'APROBADO', 'DESCARTADO']).optional(),
});

const reportarBaseSchema = z.object({
  lat: z.coerce
    .number({ required_error: 'La latitud es obligatoria.' })
    .min(-90, 'Latitud mínima -90.')
    .max(90, 'Latitud máxima 90.'),
  lng: z.coerce
    .number({ required_error: 'La longitud es obligatoria.' })
    .min(-180, 'Longitud mínima -180.')
    .max(180, 'Longitud máxima 180.'),
  fechaHora: z.string({ required_error: 'La fecha y hora del avistamiento son obligatorias.' }),
  descripcion: z
    .string({ required_error: 'La descripción del avistamiento es obligatoria.' })
    .trim()
    .min(5, 'La descripción debe tener al menos 5 caracteres.')
    .max(1500, 'La descripción no puede superar los 1500 caracteres.'),
  evidenciaBase64: z.string().min(20).optional().nullable(),
  evidenciaContentType: z.string().optional().nullable(),
  evidenciaNombre: z.string().max(150).optional().nullable(),
  evidencia: z
    .object({
      base64: z.string().min(20),
      contentType: z.string().optional(),
      nombreArchivo: z.string().max(150).optional(),
    })
    .optional()
    .nullable(),
  urlEvidencia: z.string().url('La URL de evidencia no es válida.').optional().nullable(),
});

const reportarConFichaBodySchema = reportarBaseSchema.extend({
  fichaId: z.string().uuid('El identificador de la ficha debe ser un UUID válido.'),
});

const descartarSchema = z.object({
  motivo: z
    .string({ required_error: 'El motivo de rechazo es obligatorio.' })
    .trim()
    .min(3, 'El motivo debe tener al menos 3 caracteres.')
    .max(500, 'El motivo no puede superar los 500 caracteres.'),
  bloquearOrigen: z.boolean().optional().default(false),
});

export function createAvistamientoRouter({
  avistamientoController = new AvistamientoController(),
  authMiddleware = { validarToken, validarTokenOpcional },
} = {}) {
  const router = Router();

  // Rate limit estricto anti-spam para creación de reportes de avistamiento (5 reportes cada 10 min por IP)
  const limiteAntiSpamReporte = limitarPeticiones({
    ventanaMs: 10 * 60 * 1000,
    maxPeticiones: 5,
    mensaje:
      'Has superado el límite de reportes de avistamiento permitidos temporalmente (protección anti-spam). Intenta nuevamente en unos minutos.',
    generadorClave: (req) => `avistamiento-reporte:${obtenerIpCliente(req)}`,
  });

  const limiteLectura = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 150,
  });

  const limiteModeracion = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 60,
  });

  // GET /api/avistamientos/mios (avistamientos reportados por el usuario autenticado)
  router.get(
    '/mios',
    limiteLectura,
    authMiddleware.validarToken,
    avistamientoController.listarMios
  );

  // GET /api/avistamientos/ficha/:fichaId
  // Lectores públicos: solo APROBADO. Creador de la ficha o ADMINISTRADOR: también PENDIENTE y DESCARTADO.
  router.get(
    '/ficha/:fichaId',
    limiteLectura,
    authMiddleware.validarTokenOpcional,
    validarEntrada(fichaIdParamSchema, 'params'),
    validarEntrada(listarQuerySchema, 'query'),
    avistamientoController.listarPorFicha
  );

  // POST /api/avistamientos (con fichaId en el body — requiere sesión activa)
  router.post(
    '/',
    limiteAntiSpamReporte,
    authMiddleware.validarToken,
    validarEntrada(reportarConFichaBodySchema, 'body'),
    avistamientoController.reportar
  );

  // POST /api/avistamientos/ficha/:fichaId (con fichaId en la ruta — requiere sesión activa)
  router.post(
    '/ficha/:fichaId',
    limiteAntiSpamReporte,
    authMiddleware.validarToken,
    validarEntrada(fichaIdParamSchema, 'params'),
    validarEntrada(reportarBaseSchema, 'body'),
    avistamientoController.reportar
  );

  // PATCH /api/avistamientos/:id/aprobar (solo creador de la ficha o ADMINISTRADOR)
  router.patch(
    '/:id/aprobar',
    limiteModeracion,
    authMiddleware.validarToken,
    validarEntrada(avistamientoIdParamSchema, 'params'),
    avistamientoController.aprobar
  );

  // PATCH /api/avistamientos/:id/descartar (solo creador de la ficha o ADMINISTRADOR)
  router.patch(
    '/:id/descartar',
    limiteModeracion,
    authMiddleware.validarToken,
    validarEntrada(avistamientoIdParamSchema, 'params'),
    validarEntrada(descartarSchema, 'body'),
    avistamientoController.descartar
  );

  return router;
}

const avistamientoRouter = createAvistamientoRouter();
export default avistamientoRouter;
