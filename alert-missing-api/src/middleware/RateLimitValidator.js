import { obtenerIpCliente } from '../shared/http.js';

/**
 * Middleware de limitación de tasa (rate limiting) por ventana fija en memoria.
 * Protege endpoints críticos contra abuso y ataques de fuerza bruta sin dependencias externas.
 *
 * @param {object} [opciones]
 * @param {number} [opciones.ventanaMs=900000] Duración de la ventana en milisegundos (15 min por defecto)
 * @param {number} [opciones.maxPeticiones=100] Máximo de peticiones permitidas por clave dentro de la ventana
 * @param {string} [opciones.mensaje] Mensaje de error al superar el límite
 * @param {(req: import('express').Request) => string} [opciones.generadorClave]
 */
export function limitarPeticiones({
  ventanaMs = 15 * 60 * 1000,
  maxPeticiones = 100,
  mensaje = 'Demasiadas peticiones desde esta dirección. Intente nuevamente más tarde.',
  generadorClave = (req) => `${obtenerIpCliente(req)}:${req.baseUrl}${req.path}`,
} = {}) {
  const registros = new Map();

  // Limpieza periódica de ventanas vencidas para evitar fuga de memoria
  const intervaloLimpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [clave, entrada] of registros.entries()) {
      if (entrada.reiniciaEn <= ahora) {
        registros.delete(clave);
      }
    }
  }, Math.min(ventanaMs, 60 * 1000));

  intervaloLimpieza.unref?.();

  return (req, res, next) => {
    const ahora = Date.now();
    const clave = generadorClave(req);
    let entrada = registros.get(clave);

    if (!entrada || entrada.reiniciaEn <= ahora) {
      entrada = {
        conteo: 0,
        reiniciaEn: ahora + ventanaMs,
      };
      registros.set(clave, entrada);
    }

    entrada.conteo += 1;

    const restantes = Math.max(0, maxPeticiones - entrada.conteo);
    const segundosRestantes = Math.max(1, Math.ceil((entrada.reiniciaEn - ahora) / 1000));

    res.setHeader('X-RateLimit-Limit', String(maxPeticiones));
    res.setHeader('X-RateLimit-Remaining', String(restantes));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entrada.reiniciaEn / 1000)));

    if (entrada.conteo > maxPeticiones) {
      res.setHeader('Retry-After', String(segundosRestantes));
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        mensaje,
        reintentarEnSegundos: segundosRestantes,
      });
    }

    return next();
  };
}

/**
 * Middleware de validación de entrada usando esquemas Zod.
 * Sanea/reemplaza req[origen] con los datos validados o devuelve HTTP 400 detallado.
 *
 * @param {import('zod').ZodTypeAny} esquemaZod
 * @param {'body'|'query'|'params'} [origen='body']
 */
export function validarEntrada(esquemaZod, origen = 'body') {
  return (req, res, next) => {
    const resultado = esquemaZod.safeParse(req[origen]);

    if (!resultado.success) {
      const detalles = resultado.error.issues.map((issue) => ({
        campo: issue.path.join('.') || origen,
        mensaje: issue.message,
      }));

      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        mensaje: 'Los datos enviados no cumplen las reglas de validación.',
        detalles,
      });
    }

    req[origen] = resultado.data;
    return next();
  };
}
