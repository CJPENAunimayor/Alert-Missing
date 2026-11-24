import { AppError } from '../shared/errors.js';
import { env } from '../shared/env.js';

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    const body = {
      error: err.code,
      mensaje: err.message,
    };
    if (err.details) {
      body.detalles = err.details;
    }
    return res.status(err.statusCode).json(body);
  }

  // Error de JSON malformado enviado por express.json()
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'INVALID_JSON',
      mensaje: 'El cuerpo de la petición contiene JSON malformado.',
    });
  }

  console.error('[Error no controlado]', err);

  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    mensaje:
      env.NODE_ENV === 'production'
        ? 'Error interno del servidor.'
        : err.message || 'Error interno del servidor.',
  });
}
