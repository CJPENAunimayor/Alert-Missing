import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import alertaRoutes from './routes/alerta.routes.js';
import mapaRoutes from './routes/mapa.routes.js';
import avistamientoRoutes from './routes/avistamiento.routes.js';
import dispositivoRoutes from './routes/dispositivo.routes.js';
import auditoriaRoutes from './routes/auditoria.routes.js';
import { colaNotificacionesDefault } from './jobs/ColaNotificaciones.js';
import { errorHandler } from './middleware/errorHandler.js';
import { env } from './shared/env.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean),
      credentials: true,
    })
  );

  app.use(express.json({ limit: '15mb' }));

  // Verificación de estado del servicio (CAL-08)
  app.get(`${env.API_PREFIX}/health`, (_req, res) => {
    res.status(200).json({
      estado: 'OK',
      servicio: 'alert-missing-api',
      version: '1.0.0',
      entorno: env.NODE_ENV,
      uptimeSegundos: Math.round(process.uptime()),
      colaNotificaciones: colaNotificacionesDefault.obtenerEstado(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(`${env.API_PREFIX}/auth`, authRoutes);
  app.use(`${env.API_PREFIX}/alertas`, alertaRoutes);
  app.use(`${env.API_PREFIX}/mapa`, mapaRoutes);
  app.use(`${env.API_PREFIX}/avistamientos`, avistamientoRoutes);
  app.use(`${env.API_PREFIX}/dispositivos`, dispositivoRoutes);
  app.use(`${env.API_PREFIX}/auditoria`, auditoriaRoutes);

  app.use((_req, res) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      mensaje: 'Ruta no encontrada.',
    });
  });

  app.use(errorHandler);

  return app;
}

export default createApp();
