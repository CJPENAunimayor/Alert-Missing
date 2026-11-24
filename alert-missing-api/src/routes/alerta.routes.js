import { Router } from 'express';
import { z } from 'zod';
import { AlertaController } from '../controllers/AlertaController.js';
import { AlertaRepo } from '../repositories/AlertaRepo.js';
import {
  validarToken,
  validarTokenOpcional,
  requerirPropietario,
} from '../middleware/JwtAuthMiddleware.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';

const uuidParamSchema = z.object({
  id: z.string().uuid('El identificador de la ficha debe ser un UUID válido.'),
});

const fotografiaInputSchema = z
  .object({
    base64: z.string().min(20).optional(),
    contentType: z.string().optional(),
    nombreArchivo: z.string().max(150).optional(),
    url: z.string().url('La URL de fotografía no es válida.').optional(),
    esPrincipal: z.boolean().optional().default(false),
  })
  .refine((data) => Boolean(data.base64 || data.url), {
    message: 'Cada fotografía debe incluir "base64" o "url".',
  });

const crearFichaSchema = z.object({
  nombreDesaparecido: z
    .string({ required_error: 'El nombre del desaparecido es obligatorio.' })
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres.')
    .max(150),
  edad: z.coerce
    .number({ required_error: 'La edad es obligatoria.' })
    .int('La edad debe ser un número entero.')
    .min(0, 'La edad no puede ser negativa.')
    .max(130, 'La edad no puede superar 130 años.'),
  genero: z.string({ required_error: 'El género es obligatorio.' }).trim().min(1),
  senasParticulares: z.string().trim().max(1000).optional().nullable(),
  vestimenta: z.string().trim().max(1000).optional().nullable(),
  datosSirdec: z.record(z.any()).optional().default({}),
  fechaHoraUltimoContacto: z.string({
    required_error: 'La fecha y hora de último contacto son obligatorias.',
  }),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  direccionTexto: z.string().trim().max(300).optional().nullable(),
  radioBusquedaKm: z.coerce.number().positive().max(200).optional().default(5),
  esAlertaRosa: z.boolean().optional().default(false),
  fotografias: z
    .array(fotografiaInputSchema)
    .min(1, 'Debe adjuntar al menos una fotografía de la persona desaparecida.')
    .max(6, 'Puede adjuntar un máximo de 6 fotografías por ficha.'),
});

const listarAlertasQuerySchema = z.object({
  busqueda: z.string().trim().max(120).optional(),
  esAlertaRosa: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  genero: z.string().trim().optional(),
  edadMin: z.coerce.number().int().min(0).max(130).optional(),
  edadMax: z.coerce.number().int().min(0).max(130).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radioKm: z.coerce.number().positive().max(500).optional(),
  pagina: z.coerce.number().int().min(1).optional().default(1),
  limite: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const actualizarAlertaRosaSchema = z.object({
  esAlertaRosa: z.boolean({
    required_error: 'El campo esAlertaRosa (booleano) es obligatorio.',
  }),
  motivo: z.string().trim().min(3).max(500).optional(),
});

const cerrarAlertaSchema = z.object({
  resumen: z
    .string({ required_error: 'El resumen de cierre por localización es obligatorio.' })
    .trim()
    .min(5, 'El resumen de cierre debe tener al menos 5 caracteres.')
    .max(1000, 'El resumen no puede superar los 1000 caracteres.'),
});

const cancelarAlertaSchema = z.object({
  motivo: z
    .string({ required_error: 'El motivo de cancelación es obligatorio.' })
    .trim()
    .min(5, 'El motivo de cancelación debe tener al menos 5 caracteres.')
    .max(1000, 'El motivo no puede superar los 1000 caracteres.'),
});

const exportarSirdecQuerySchema = z.object({
  formato: z.enum(['pdf', 'json']).optional().default('json'),
});

const actualizarSirdecSchema = z.object({
  datosSirdec: z.record(z.any()),
});

export function createAlertaRouter({
  alertaController = new AlertaController(),
  alertaRepo = new AlertaRepo(),
  authMiddleware = { validarToken, validarTokenOpcional, requerirPropietario },
} = {}) {
  const router = Router();

  const limiteLectura = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 150,
  });

  const limiteEscritura = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 30,
    mensaje: 'Ha excedido el límite temporal de creación o edición de alertas.',
  });

  const verificarPropietarioFicha = authMiddleware.requerirPropietario(
    async (req) => {
      const ficha = await alertaRepo.obtenerPorId(req.params.id);
      return ficha ? ficha.creadorId : null;
    },
    {
      permitirAdmin: true,
      entidad: 'FICHAS_BUSQUEDA',
      obtenerEntidadId: (req) => req.params.id,
    }
  );

  // GET /api/alertas
  router.get(
    '/',
    limiteLectura,
    validarEntrada(listarAlertasQuerySchema, 'query'),
    alertaController.listarActivas
  );

  // GET /api/alertas/mias (fichas creadas por el usuario autenticado)
  router.get(
    '/mias',
    limiteLectura,
    authMiddleware.validarToken,
    alertaController.listarMias
  );

  // GET /api/alertas/:id/exportar-sirdec?formato=pdf|json
  router.get(
    '/:id/exportar-sirdec',
    limiteLectura,
    authMiddleware.validarTokenOpcional,
    validarEntrada(uuidParamSchema, 'params'),
    validarEntrada(exportarSirdecQuerySchema, 'query'),
    alertaController.exportarSirdec
  );

  // GET /api/alertas/:id
  router.get(
    '/:id',
    limiteLectura,
    validarEntrada(uuidParamSchema, 'params'),
    alertaController.obtenerPorId
  );

  // POST /api/alertas
  router.post(
    '/',
    limiteEscritura,
    authMiddleware.validarToken,
    validarEntrada(crearFichaSchema, 'body'),
    alertaController.crearFicha
  );

  // PATCH /api/alertas/:id/alerta-rosa
  router.patch(
    '/:id/alerta-rosa',
    limiteEscritura,
    authMiddleware.validarToken,
    validarEntrada(uuidParamSchema, 'params'),
    verificarPropietarioFicha,
    validarEntrada(actualizarAlertaRosaSchema, 'body'),
    alertaController.actualizarAlertaRosa
  );

  // PATCH /api/alertas/:id/cerrar (estado LOCALIZADA)
  router.patch(
    '/:id/cerrar',
    limiteEscritura,
    authMiddleware.validarToken,
    validarEntrada(uuidParamSchema, 'params'),
    verificarPropietarioFicha,
    validarEntrada(cerrarAlertaSchema, 'body'),
    alertaController.cerrarAlerta
  );

  // PATCH /api/alertas/:id/cancelar (estado CANCELADA)
  router.patch(
    '/:id/cancelar',
    limiteEscritura,
    authMiddleware.validarToken,
    validarEntrada(uuidParamSchema, 'params'),
    verificarPropietarioFicha,
    validarEntrada(cancelarAlertaSchema, 'body'),
    alertaController.cancelarAlerta
  );

  // PATCH /api/alertas/:id/sirdec (completar campos morfológicos SIRDEC)
  router.patch(
    '/:id/sirdec',
    limiteEscritura,
    authMiddleware.validarToken,
    validarEntrada(uuidParamSchema, 'params'),
    verificarPropietarioFicha,
    validarEntrada(actualizarSirdecSchema, 'body'),
    alertaController.actualizarDatosSirdec
  );

  return router;
}

const alertaRouter = createAlertaRouter();
export default alertaRouter;
