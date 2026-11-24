export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos de entrada inválidos.', details = null) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'No autenticado o credenciales inválidas.') {
    super(message, { statusCode: 401, code: 'AUTHENTICATION_ERROR' });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'No tiene permisos para acceder a este recurso.') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado.') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto con un registro existente.') {
    super(message, { statusCode: 409, code: 'CONFLICT' });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Demasiadas peticiones. Intente nuevamente más tarde.') {
    super(message, { statusCode: 429, code: 'RATE_LIMIT_EXCEEDED' });
  }
}
