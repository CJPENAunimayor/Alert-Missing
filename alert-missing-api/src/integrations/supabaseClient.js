import { createClient } from '@supabase/supabase-js';
import { env } from '../shared/env.js';

let adminClientInstance = null;
let publicAuthClientInstance = null;

/**
 * Cliente administrativo de Supabase (Service Role) para repositorios del servidor.
 * Se inicializa bajo demanda para evitar errores al importar módulos en pruebas sin .env.
 */
export function getSupabaseAdminClient() {
  if (!adminClientInstance) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'Configuración de Supabase incompleta: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias.'
      );
    }
    adminClientInstance = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClientInstance;
}

/**
 * Cliente público de Supabase (Anon Key) para verificar sesiones/tokens OAuth (Google).
 */
export function getSupabaseAuthClient() {
  if (!publicAuthClientInstance) {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      throw new Error(
        'Configuración de Supabase Auth incompleta: SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias.'
      );
    }
    publicAuthClientInstance = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return publicAuthClientInstance;
}
