import { Router } from 'express';
import { z } from 'zod';
import { AuthController } from '../controllers/AuthController.js';
import { validarToken, validarTokenOpcional } from '../middleware/JwtAuthMiddleware.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';

const REGEX_DOCUMENTO = /^(?:(?:CC|TI|CE|PA|PPT)[\s-]?)?[A-Za-z0-9]{5,15}$/i;
const REGEX_TELEFONO = /^(?:\+?57)?(?:3\d{9}|60[1-8]\d{7})$|^\+[1-9]\d{7,14}$/;
const REGEX_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

const registerSchema = z.object({
  nombreCompleto: z
    .string({ required_error: 'El nombre completo es obligatorio.' })
    .trim()
    .min(3, 'El nombre completo debe tener al menos 3 caracteres.')
    .max(120, 'El nombre completo no puede superar los 120 caracteres.'),
  documento: z
    .string({ required_error: 'El documento es obligatorio.' })
    .trim()
    .regex(
      REGEX_DOCUMENTO,
      'El documento debe tener entre 5 y 15 caracteres alfanuméricos válidos.'
    ),
  correo: z
    .string({ required_error: 'El correo electrónico es obligatorio.' })
    .trim()
    .toLowerCase()
    .email('El formato del correo electrónico no es válido.')
    .max(254),
  telefono: z
    .string({ required_error: 'El teléfono es obligatorio.' })
    .trim()
    .transform((v) => v.replace(/[\s\-()]/g, ''))
    .refine(
      (v) => REGEX_TELEFONO.test(v),
      'El teléfono debe ser un número colombiano válido o formato internacional E.164.'
    ),
  password: z
    .string({ required_error: 'La contraseña es obligatoria.' })
    .regex(
      REGEX_PASSWORD,
      'La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.'
    ),
  aceptoHabeasData: z.literal(true, {
    errorMap: () => ({
      message:
        'Debe aceptar explícitamente la autorización de tratamiento de datos personales (Ley 1581 de 2012 - Hábeas Data).',
    }),
  }),
});

const loginSchema = z.object({
  correo: z
    .string({ required_error: 'El correo electrónico es obligatorio.' })
    .trim()
    .toLowerCase()
    .email('El formato del correo electrónico no es válido.'),
  password: z
    .string({ required_error: 'La contraseña es obligatoria.' })
    .min(1, 'La contraseña es obligatoria.'),
});

const googleLoginSchema = z.object({
  accessToken: z
    .string({ required_error: 'El token de sesión de Google es obligatorio.' })
    .trim()
    .min(10, 'El token de sesión de Google no es válido.'),
  supabaseUser: z
    .object({
      id: z.string().optional(),
      email: z.string().email().optional(),
      user_metadata: z.record(z.any()).optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
  aceptoHabeasData: z.boolean().optional().default(false),
});

const updateProfileSchema = z
  .object({
    nombreCompleto: z
      .string()
      .trim()
      .min(3, 'El nombre completo debe tener al menos 3 caracteres.')
      .max(120, 'El nombre completo no puede superar los 120 caracteres.')
      .optional(),
    documento: z
      .string()
      .trim()
      .regex(
        REGEX_DOCUMENTO,
        'El documento debe tener entre 5 y 15 caracteres alfanuméricos válidos.'
      )
      .optional(),
    telefono: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s\-()]/g, ''))
      .refine(
        (v) => REGEX_TELEFONO.test(v),
        'El teléfono debe ser un número colombiano válido o formato internacional E.164.'
      )
      .optional(),
    aceptoHabeasData: z.boolean().optional(),
    passwordActual: z.string().min(1).optional(),
    passwordNueva: z
      .string()
      .regex(
        REGEX_PASSWORD,
        'La nueva contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.'
      )
      .optional(),
  })
  .refine(
    (data) =>
      data.nombreCompleto !== undefined ||
      data.documento !== undefined ||
      data.telefono !== undefined ||
      data.aceptoHabeasData !== undefined ||
      data.passwordNueva !== undefined,
    {
      message: 'Debe proporcionar al menos un campo para actualizar el perfil.',
    }
  )
  .refine((data) => !data.passwordNueva || Boolean(data.passwordActual), {
    message: 'Debe proporcionar su contraseña actual para cambiar la contraseña.',
    path: ['passwordActual'],
  });

export function createAuthRouter({
  authController = new AuthController(),
  authMiddleware = { validarToken, validarTokenOpcional },
} = {}) {
  const router = Router();

  const limiteAuthEstricto = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 25,
    mensaje: 'Demasiados intentos de autenticación. Espere 15 minutos e intente de nuevo.',
  });

  const limitePerfil = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 60,
  });

  // POST /api/auth/register
  router.post(
    '/register',
    limiteAuthEstricto,
    validarEntrada(registerSchema, 'body'),
    authController.registrar
  );

  // POST /api/auth/login
  router.post(
    '/login',
    limiteAuthEstricto,
    validarEntrada(loginSchema, 'body'),
    authController.login
  );

  // POST /api/auth/google (intercambio/sincronización de sesión Supabase Google OAuth)
  router.post(
    '/google',
    limiteAuthEstricto,
    validarEntrada(googleLoginSchema, 'body'),
    authController.loginGoogle
  );

  // POST /api/auth/refresh
  router.post(
    '/refresh',
    limitePerfil,
    authMiddleware.validarToken,
    authController.renovarToken
  );

  // GET /api/auth/me (protegida)
  router.get(
    '/me',
    limitePerfil,
    authMiddleware.validarToken,
    authController.obtenerPerfil
  );

  // PUT /api/auth/profile (protegida, RF-01)
  router.put(
    '/profile',
    limitePerfil,
    authMiddleware.validarToken,
    validarEntrada(updateProfileSchema, 'body'),
    authController.actualizarPerfil
  );

  // POST /api/auth/logout
  router.post(
    '/logout',
    limitePerfil,
    authMiddleware.validarTokenOpcional,
    authController.logout
  );

  return router;
}

const authRouter = createAuthRouter();
export default authRouter;
