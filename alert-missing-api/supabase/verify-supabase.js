import { getSupabaseAdminClient } from '../src/integrations/supabaseClient.js';
import { env, validarEnvRequerido } from '../src/shared/env.js';

const TABLAS_REQUERIDAS = [
  'usuarios',
  'fichas_busqueda',
  'fotografias',
  'avistamientos',
  'historial_estados',
  'dispositivos_suscritos',
  'notificaciones',
  'registros_auditoria',
];

async function verificarSupabase() {
  validarEnvRequerido(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const supabase = getSupabaseAdminClient();

  console.log(`\n[Verify] Conectando a Supabase: ${env.SUPABASE_URL}\n`);

  let errores = 0;

  for (const tabla of TABLAS_REQUERIDAS) {
    const { error } = await supabase.from(tabla).select('*', { head: true, count: 'exact' });
    if (error) {
      console.error(`  [ERROR] Tabla "${tabla}": ${error.message}`);
      errores += 1;
    } else {
      console.log(`  [OK]    Tabla "${tabla}" accesible`);
    }
  }

  // Verificar RPC espacial PostGIS
  const { error: rpcError } = await supabase.rpc('buscar_fichas_activas_en_radio', {
    p_lat: 4.711,
    p_lng: -74.0721,
    p_radio_km: 5,
  });

  if (rpcError) {
    console.error(`  [ERROR] RPC PostGIS "buscar_fichas_activas_en_radio": ${rpcError.message}`);
    errores += 1;
  } else {
    console.log('  [OK]    RPC PostGIS "buscar_fichas_activas_en_radio" operativo');
  }

  // Verificar bucket de Storage configurado en .env
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    console.error(`  [ERROR] Storage listBuckets: ${bucketError.message}`);
    errores += 1;
  } else {
    const bucketEncontrado = (buckets || []).find((b) => b.name === env.SUPABASE_STORAGE_BUCKET);
    if (bucketEncontrado) {
      if (bucketEncontrado.public) {
        console.log(`  [OK]    Bucket Storage "${env.SUPABASE_STORAGE_BUCKET}" encontrado y público`);
      } else {
        console.warn(
          `  [AVISO] Bucket "${env.SUPABASE_STORAGE_BUCKET}" existe pero es PRIVADO (public: false). Las imágenes no cargarán por URL pública.`
        );
        errores += 1;
      }
    } else {
      console.warn(
        `  [AVISO] Bucket "${env.SUPABASE_STORAGE_BUCKET}" no existe aún. Buckets actuales: ${
          (buckets || []).map((b) => b.name).join(', ') || '(ninguno)'
        }`
      );
      errores += 1;
    }
  }

  console.log('');
  if (errores > 0) {
    console.error(
      `[Verify] Se encontraron ${errores} problema(s). Ejecuta alert-missing-api/supabase/schema.sql en el SQL Editor de Supabase.`
    );
    process.exit(1);
  }

  console.log('[Verify] Toda la base de datos PostGIS y Storage de Alert Missing está lista.');
}

verificarSupabase().catch((err) => {
  console.error('[Verify] Error inesperado:', err.message);
  process.exit(1);
});
