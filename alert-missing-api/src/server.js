import app from './app.js';
import { sirdecExpirationJobDefault } from './jobs/SirdecExpirationJob.js';
import { env, validarEnvRequerido } from './shared/env.js';

validarEnvRequerido(['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

sirdecExpirationJobDefault.iniciar();

app.listen(env.PORT, () => {
  console.log(
    `[alert-missing-api] Servidor escuchando en http://localhost:${env.PORT}${env.API_PREFIX} (${env.NODE_ENV})`
  );
});
