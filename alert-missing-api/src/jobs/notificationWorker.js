import { colaNotificacionesDefault } from './ColaNotificaciones.js';
import { sirdecExpirationJobDefault } from './SirdecExpirationJob.js';
import { env, validarEnvRequerido } from '../shared/env.js';

validarEnvRequerido(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

console.log(
  `[notification-worker] Iniciando worker de notificaciones (${env.WORKER_POLL_INTERVAL_MS} ms) y expiración SIRDEC (${env.SIRDEC_CHECK_INTERVAL_MS} ms)...`
);

colaNotificacionesDefault.iniciarPolling();
sirdecExpirationJobDefault.iniciar();

const detener = () => {
  console.log('[notification-worker] Deteniendo worker...');
  colaNotificacionesDefault.detenerPolling();
  sirdecExpirationJobDefault.detener();
  process.exit(0);
};

process.on('SIGINT', detener);
process.on('SIGTERM', detener);
