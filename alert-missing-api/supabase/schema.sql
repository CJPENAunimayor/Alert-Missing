-- ==============================================================================
-- Alert Missing (Colombia) - Script Completo de Creación para Supabase Cloud
-- PostgreSQL + PostGIS + Triggers de Inmutabilidad + Índices GIST + RPC + Storage + RLS
--
-- Cómo ejecutar:
--   1. Abre tu proyecto en Supabase Dashboard -> SQL Editor -> New Query
--   2. Pega y ejecuta este script completo (es 100% idempotente).
-- ==============================================================================

-- 1. Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Asegurar resolución de tipos/funciones PostGIS en public y extensions
SET search_path TO public, extensions;

-- ==============================================================================
-- 2. Funciones auxiliares para Triggers
-- ==============================================================================

-- 2.1 Bloqueo estricto de UPDATE y DELETE en tablas inmutables (append-only)
CREATE OR REPLACE FUNCTION public.impedir_modificacion_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operación % no permitida en la tabla inmutable "%". Los registros no pueden modificarse ni eliminarse.',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

-- 2.2 Actualización automática de columna updated_at
CREATE OR REPLACE FUNCTION public.actualizar_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==============================================================================
-- 3. Tablas de Dominio y Soporte
-- ==============================================================================

-- 3.1 Usuarios
CREATE TABLE IF NOT EXISTS public.usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo TEXT NOT NULL,
  documento TEXT UNIQUE,
  correo TEXT NOT NULL UNIQUE,
  telefono TEXT,
  password_hash TEXT,
  proveedor_auth TEXT NOT NULL DEFAULT 'LOCAL'
    CHECK (proveedor_auth IN ('LOCAL', 'GOOGLE')),
  rol TEXT NOT NULL DEFAULT 'USUARIO'
    CHECK (rol IN ('USUARIO', 'ADMINISTRADOR')),
  bloqueado BOOLEAN NOT NULL DEFAULT FALSE,
  acepto_habeas_data BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_aceptacion_habeas_data TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_usuarios_password_local CHECK (
    (proveedor_auth = 'LOCAL' AND password_hash IS NOT NULL)
    OR (proveedor_auth = 'GOOGLE')
  )
);

-- 3.2 Fichas de Búsqueda
CREATE TABLE IF NOT EXISTS public.fichas_busqueda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_desaparecido TEXT NOT NULL,
  edad INTEGER CHECK (edad >= 0 AND edad <= 130),
  genero TEXT NOT NULL,
  senas_particulares TEXT,
  vestimenta TEXT,
  datos_sirdec JSONB NOT NULL DEFAULT '{}'::jsonb,
  fecha_hora_ultimo_contacto TIMESTAMPTZ NOT NULL,
  ubicacion_ultimo_contacto GEOGRAPHY(Point, 4326) NOT NULL,
  direccion_texto TEXT,
  radio_busqueda_km DECIMAL(6, 2) NOT NULL DEFAULT 5.00
    CHECK (radio_busqueda_km > 0),
  es_alerta_rosa BOOLEAN NOT NULL DEFAULT FALSE,
  estado TEXT NOT NULL DEFAULT 'ACTIVA'
    CHECK (estado IN ('ACTIVA', 'LOCALIZADA', 'CANCELADA', 'SUSPENDIDA_SIRDEC')),
  sirdec_completado BOOLEAN NOT NULL DEFAULT FALSE,
  sirdec_fecha_limite TIMESTAMPTZ NULL,
  sirdec_completado_en TIMESTAMPTZ NULL,
  creador_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente para proyectos que ya tenían fichas_busqueda creada previamente
ALTER TABLE public.fichas_busqueda
  ADD COLUMN IF NOT EXISTS sirdec_completado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sirdec_fecha_limite TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sirdec_completado_en TIMESTAMPTZ NULL;

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.fichas_busqueda'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE public.fichas_busqueda DROP CONSTRAINT %I', v_constraint);
  END LOOP;

  ALTER TABLE public.fichas_busqueda
    ADD CONSTRAINT chk_fichas_busqueda_estado
    CHECK (estado IN ('ACTIVA', 'LOCALIZADA', 'CANCELADA', 'SUSPENDIDA_SIRDEC'));
END $$;

-- 3.3 Fotografías asociadas a fichas de búsqueda
CREATE TABLE IF NOT EXISTS public.fotografias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id UUID NOT NULL REFERENCES public.fichas_busqueda(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE
);

-- 3.4 Avistamientos reportados por ciudadanos/testigos
CREATE TABLE IF NOT EXISTS public.avistamientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id UUID NOT NULL REFERENCES public.fichas_busqueda(id) ON DELETE CASCADE,
  testigo_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  coordenadas GEOGRAPHY(Point, 4326) NOT NULL,
  fecha_hora TIMESTAMPTZ NOT NULL,
  descripcion TEXT NOT NULL,
  url_evidencia TEXT NULL,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'APROBADO', 'DESCARTADO')),
  motivo_rechazo TEXT NULL,
  ip_origen TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.5 Historial de Estados de Fichas (Inmutable / Append-Only)
CREATE TABLE IF NOT EXISTS public.historial_estados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id UUID NOT NULL REFERENCES public.fichas_busqueda(id) ON DELETE RESTRICT,
  estado_nuevo TEXT NOT NULL
    CHECK (estado_nuevo IN ('ACTIVA', 'LOCALIZADA', 'CANCELADA', 'SUSPENDIDA_SIRDEC')),
  resumen_o_motivo TEXT NOT NULL,
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.historial_estados'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado_nuevo%'
  LOOP
    EXECUTE format('ALTER TABLE public.historial_estados DROP CONSTRAINT %I', v_constraint);
  END LOOP;

  ALTER TABLE public.historial_estados
    ADD CONSTRAINT chk_historial_estados_estado_nuevo
    CHECK (estado_nuevo IN ('ACTIVA', 'LOCALIZADA', 'CANCELADA', 'SUSPENDIDA_SIRDEC'));
END $$;

DROP TRIGGER IF EXISTS trg_historial_estados_inmutable ON public.historial_estados;
CREATE TRIGGER trg_historial_estados_inmutable
  BEFORE UPDATE OR DELETE ON public.historial_estados
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_modificacion_inmutable();

-- 3.6 Dispositivos Suscritos (OneSignal + Geolocalización)
CREATE TABLE IF NOT EXISTS public.dispositivos_suscritos (
  one_signal_id TEXT PRIMARY KEY,
  usuario_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultima_ubicacion GEOGRAPHY(Point, 4326),
  permiso_notificaciones BOOLEAN NOT NULL DEFAULT FALSE,
  permiso_ubicacion BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_dispositivos_suscritos_updated_at ON public.dispositivos_suscritos;
CREATE TRIGGER trg_dispositivos_suscritos_updated_at
  BEFORE UPDATE ON public.dispositivos_suscritos
  FOR EACH ROW
  EXECUTE FUNCTION public.actualizar_updated_at();

-- 3.7 Cola y Registro de Notificaciones
CREATE TABLE IF NOT EXISTS public.notificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ficha_id UUID NULL REFERENCES public.fichas_busqueda(id) ON DELETE SET NULL,
  avistamiento_id UUID NULL REFERENCES public.avistamientos(id) ON DELETE SET NULL,
  destinatario_id TEXT NOT NULL,
  tipo TEXT NOT NULL
    CHECK (tipo IN ('ALERTA_ZONA', 'AVISTAMIENTO')),
  canal TEXT NOT NULL
    CHECK (canal IN ('PUSH', 'SMS', 'EMAIL')),
  prioridad TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (prioridad IN ('ALTA', 'NORMAL')),
  estado TEXT NOT NULL DEFAULT 'ENCOLADA'
    CHECK (estado IN ('ENCOLADA', 'ENVIADA', 'FALLIDA')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fecha_envio TIMESTAMPTZ NULL
);

-- 3.8 Registros de Auditoría (Inmutable / Append-Only)
CREATE TABLE IF NOT EXISTS public.registros_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT NULL,
  ip TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_registros_auditoria_inmutable ON public.registros_auditoria;
CREATE TRIGGER trg_registros_auditoria_inmutable
  BEFORE UPDATE OR DELETE ON public.registros_auditoria
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_modificacion_inmutable();

-- ==============================================================================
-- 4. Índices Espaciales (GIST) y B-Tree de Rendimiento
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_fichas_busqueda_ubicacion_gist
  ON public.fichas_busqueda
  USING GIST (ubicacion_ultimo_contacto);

CREATE INDEX IF NOT EXISTS idx_avistamientos_coordenadas_gist
  ON public.avistamientos
  USING GIST (coordenadas);

CREATE INDEX IF NOT EXISTS idx_dispositivos_suscritos_ubicacion_gist
  ON public.dispositivos_suscritos
  USING GIST (ultima_ubicacion);

CREATE INDEX IF NOT EXISTS idx_usuarios_correo
  ON public.usuarios (LOWER(correo));

CREATE INDEX IF NOT EXISTS idx_fichas_busqueda_estado_alerta
  ON public.fichas_busqueda (estado, es_alerta_rosa DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fichas_sirdec_pendiente
  ON public.fichas_busqueda (sirdec_fecha_limite)
  WHERE estado = 'ACTIVA' AND sirdec_completado = FALSE;

CREATE INDEX IF NOT EXISTS idx_fotografias_ficha_id
  ON public.fotografias (ficha_id);

CREATE INDEX IF NOT EXISTS idx_avistamientos_ficha_estado
  ON public.avistamientos (ficha_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_historial_estados_ficha_fecha
  ON public.historial_estados (ficha_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_notificaciones_cola
  ON public.notificaciones (estado, prioridad, intentos);

CREATE INDEX IF NOT EXISTS idx_registros_auditoria_usuario_fecha
  ON public.registros_auditoria (usuario_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_registros_auditoria_entidad
  ON public.registros_auditoria (entidad, entidad_id);

-- ==============================================================================
-- 5. Funciones Espaciales PostGIS (RPC) para Consultas Geográficas por Radio
-- ==============================================================================

-- 5.1 Buscar fichas activas dentro de un radio en kilómetros (usa índice GIST)
CREATE OR REPLACE FUNCTION public.buscar_fichas_activas_en_radio(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radio_km DOUBLE PRECISION DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  nombre_desaparecido TEXT,
  edad INTEGER,
  genero TEXT,
  es_alerta_rosa BOOLEAN,
  radio_busqueda_km DECIMAL,
  direccion_texto TEXT,
  fecha_hora_ultimo_contacto TIMESTAMPTZ,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  distancia_km DOUBLE PRECISION,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    f.id,
    f.nombre_desaparecido,
    f.edad,
    f.genero,
    f.es_alerta_rosa,
    f.radio_busqueda_km,
    f.direccion_texto,
    f.fecha_hora_ultimo_contacto,
    ST_Y(f.ubicacion_ultimo_contacto::geometry) AS lat,
    ST_X(f.ubicacion_ultimo_contacto::geometry) AS lng,
    ROUND(
      (
        ST_Distance(
          f.ubicacion_ultimo_contacto,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ) / 1000.0
      )::numeric,
      3
    )::double precision AS distancia_km,
    f.created_at
  FROM public.fichas_busqueda f
  WHERE f.estado = 'ACTIVA'
    AND ST_DWithin(
      f.ubicacion_ultimo_contacto,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radio_km * 1000.0
    )
  ORDER BY f.es_alerta_rosa DESC, distancia_km ASC, f.created_at DESC;
$$;

-- 5.2 Buscar dispositivos suscritos dentro de un radio en kilómetros para notificaciones Push (Worker)
CREATE OR REPLACE FUNCTION public.buscar_dispositivos_en_radio(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radio_km DOUBLE PRECISION DEFAULT 5
)
RETURNS TABLE (
  one_signal_id TEXT,
  usuario_id UUID,
  distancia_km DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    d.one_signal_id,
    d.usuario_id,
    ROUND(
      (
        ST_Distance(
          d.ultima_ubicacion,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ) / 1000.0
      )::numeric,
      3
    )::double precision AS distancia_km
  FROM public.dispositivos_suscritos d
  WHERE d.permiso_notificaciones = TRUE
    AND d.permiso_ubicacion = TRUE
    AND d.ultima_ubicacion IS NOT NULL
    AND ST_DWithin(
      d.ultima_ubicacion,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radio_km * 1000.0
    )
  ORDER BY distancia_km ASC;
$$;

-- 5.3 Buscar dispositivos suscritos dentro de un radio en metros (por defecto 5000 m = 5 km) usando ST_DWithin + índice GIST
CREATE OR REPLACE FUNCTION public.buscar_dispositivos_en_radio_metros(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radio_metros DOUBLE PRECISION DEFAULT 5000
)
RETURNS TABLE (
  one_signal_id TEXT,
  usuario_id UUID,
  distancia_metros DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    d.one_signal_id,
    d.usuario_id,
    ROUND(
      ST_Distance(
        d.ultima_ubicacion,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      )::numeric,
      2
    )::double precision AS distancia_metros
  FROM public.dispositivos_suscritos d
  WHERE d.permiso_notificaciones = TRUE
    AND d.permiso_ubicacion = TRUE
    AND d.ultima_ubicacion IS NOT NULL
    AND ST_DWithin(
      d.ultima_ubicacion,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      p_radio_metros
    )
  ORDER BY distancia_metros ASC;
$$;

-- ==============================================================================
-- 6. Seguridad Row Level Security (RLS)
-- Todo acceso de negocio se realiza a través de alert-missing-api (service_role),
-- impidiendo lecturas/escrituras directas no autorizadas con la clave pública.
-- ==============================================================================

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fichas_busqueda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotografias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avistamientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositivos_suscritos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_auditoria ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 7. Supabase Storage: Bucket público de lectura para fotografías de alertas
-- Nota: Se crea "alert-photos" por estándar del proyecto. Si usas otro nombre
-- (ej. ImageAlertMissing), asegúrate de que coincida con SUPABASE_STORAGE_BUCKET.
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'alert-photos',
  'alert-photos',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

UPDATE storage.buckets
SET public = TRUE
WHERE id = 'ImageAlertMissing';

DROP POLICY IF EXISTS "Lectura publica de fotografias alert-photos" ON storage.objects;
CREATE POLICY "Lectura publica de fotografias alert-photos"
  ON storage.objects
  FOR SELECT
  USING (bucket_id IN ('alert-photos', 'ImageAlertMissing'));

-- Recargar caché de esquema de PostgREST (Supabase API)
NOTIFY pgrst, 'reload schema';
