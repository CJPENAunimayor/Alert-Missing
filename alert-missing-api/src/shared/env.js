import 'dotenv/config';

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseNumber(process.env.PORT, 4000),
  API_PREFIX: process.env.API_PREFIX || '/api',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',

  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',
  BCRYPT_SALT_ROUNDS: parseNumber(process.env.BCRYPT_SALT_ROUNDS, 10),

  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET || '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || 'alert-photos',

  // OneSignal (Push)
  ONESIGNAL_APP_ID: process.env.ONESIGNAL_APP_ID || '',
  ONESIGNAL_REST_API_KEY: process.env.ONESIGNAL_REST_API_KEY || '',
  ONESIGNAL_API_URL: process.env.ONESIGNAL_API_URL || 'https://api.onesignal.com/notifications',

  // Worker asíncrono de notificaciones
  WORKER_POLL_INTERVAL_MS: parseNumber(process.env.WORKER_POLL_INTERVAL_MS, 5000),
  WORKER_BATCH_SIZE: parseNumber(process.env.WORKER_BATCH_SIZE, 20),
  WORKER_MAX_RETRIES: parseNumber(process.env.WORKER_MAX_RETRIES, 3),

  // SMTP / Nodemailer (Canal alterno Email)
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseNumber(process.env.SMTP_PORT, 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'Alert Missing <notificaciones@alertmissing.co>',

  // Adaptador SMS opcional
  SMS_WEBHOOK_URL: process.env.SMS_WEBHOOK_URL || '',
  SMS_API_KEY: process.env.SMS_API_KEY || '',
  SMS_SENDER_ID: process.env.SMS_SENDER_ID || 'AlertMissing',

  // Plazo obligatorio SIRDEC (días hábiles en Colombia) e intervalo del job de verificación
  SIRDEC_PLAZO_DIAS_HABILES: parseNumber(process.env.SIRDEC_PLAZO_DIAS_HABILES, 1),
  SIRDEC_CHECK_INTERVAL_MS: parseNumber(process.env.SIRDEC_CHECK_INTERVAL_MS, 5 * 60 * 1000),
});

export function validarEnvRequerido(claves = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  const faltantes = claves.filter((clave) => !env[clave]);
  if (faltantes.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
  }
}
