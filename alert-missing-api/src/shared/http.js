/**
 * Obtiene la dirección IP de origen del cliente respetando cabeceras de proxy inverso.
 * @param {import('express').Request} req
 * @returns {string}
 */
export function obtenerIpCliente(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}
