import { Router } from 'express';
import { z } from 'zod';
import { AlertaRepo } from '../repositories/AlertaRepo.js';
import { AuditoriaRepo } from '../repositories/AuditoriaRepo.js';
import { validarToken, requerirPropietario } from '../middleware/JwtAuthMiddleware.js';
import { limitarPeticiones, validarEntrada } from '../middleware/RateLimitValidator.js';

const fichaIdParamSchema = z.object({
  fichaId: z.string().uuid('El identificador de la ficha debe ser un UUID válido.'),
});

export function createAuditoriaRouter({
  auditoriaRepo = new AuditoriaRepo(),
  alertaRepo = new AlertaRepo(),
  authMiddleware = { validarToken, requerirPropietario },
} = {}) {
  const router = Router();

  const limiteConsulta = limitarPeticiones({
    ventanaMs: 15 * 60 * 1000,
    maxPeticiones: 100,
  });

  // GET /api/auditoria/mios — últimos eventos del usuario autenticado
  router.get('/mios', limiteConsulta, authMiddleware.validarToken, async (req, res, next) => {
    try {
      const registros = await auditoriaRepo.listarPorUsuario(req.usuario.id, { limite: 50 });
      return res.status(200).json({
        total: registros.length,
        registros: registros.map((r) => r.toJSON()),
      });
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/auditoria/ficha/:fichaId — trazabilidad de una ficha (solo creador o ADMINISTRADOR)
  router.get(
    '/ficha/:fichaId',
    limiteConsulta,
    authMiddleware.validarToken,
    validarEntrada(fichaIdParamSchema, 'params'),
    authMiddleware.requerirPropietario(
      async (req) => {
        const ficha = await alertaRepo.obtenerPorId(req.params.fichaId);
        return ficha ? ficha.creadorId : null;
      },
      {
        permitirAdmin: true,
        entidad: 'REGISTROS_AUDITORIA',
        obtenerEntidadId: (req) => req.params.fichaId,
      }
    ),
    async (req, res, next) => {
      try {
        const registros = await auditoriaRepo.listarPorEntidad(
          'FICHAS_BUSQUEDA',
          req.params.fichaId,
          { limite: 50 }
        );
        return res.status(200).json({
          fichaId: req.params.fichaId,
          total: registros.length,
          registros: registros.map((r) => r.toJSON()),
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}

const auditoriaRouter = createAuditoriaRouter();
export default auditoriaRouter;
