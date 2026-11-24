import { useEffect, useState } from 'react';
import {
  activarSuscripcionColaborativa,
  esOneSignalConfigurado,
  obtenerEstadoPermisosNavegador,
  obtenerEstadoSuscripcionLocal,
} from '../integrations/oneSignalInit.js';

export function BannerPermisosColaboracion({ expandidoExterno = false, onToggle = null }) {
  const [permisos, setPermisos] = useState({ notificaciones: 'prompt', ubicacion: 'prompt' });
  const [suscripcion, setSuscripcion] = useState(() => obtenerEstadoSuscripcionLocal());
  const [abierto, setAbierto] = useState(expandidoExterno);
  const [activando, setActivando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  useEffect(() => {
    let activo = true;
    obtenerEstadoPermisosNavegador().then((estado) => {
      if (activo) {
        setPermisos(estado);
        if (estado.notificaciones === 'denied' || estado.ubicacion === 'denied') {
          setAbierto(true);
        }
      }
    });
    return () => {
      activo = false;
    };
  }, []);

  const notificacionesBloqueadas =
    permisos.notificaciones === 'denied' || suscripcion?.notificacionesBloqueadas;
  const ubicacionBloqueada =
    permisos.ubicacion === 'denied' || suscripcion?.ubicacionBloqueada;

  const suscripcionCompleta = Boolean(
    suscripcion?.oneSignalId &&
      suscripcion?.permisoNotificaciones &&
      suscripcion?.permisoUbicacion &&
      !notificacionesBloqueadas &&
      !ubicacionBloqueada
  );

  const manejarActivar = async () => {
    setActivando(true);
    setError('');
    setExito('');

    try {
      const resultado = await activarSuscripcionColaborativa();
      setSuscripcion(resultado);

      const nuevosPermisos = await obtenerEstadoPermisosNavegador();
      setPermisos(nuevosPermisos);

      if (resultado.notificacionesBloqueadas || resultado.ubicacionBloqueada) {
        setError('Algunos permisos quedaron bloqueados en el navegador.');
      } else {
        setExito(
          resultado.modoSimulado
            ? 'Dispositivo registrado en modo desarrollo con ubicación activa (radio 5 km).'
            : 'Suscripción Push y ubicación activadas para alertas en tu zona (5 km).'
        );
      }
    } catch (err) {
      setError(err.message || 'No se pudo completar la suscripción del dispositivo.');
    } finally {
      setActivando(false);
    }
  };

  const alternarPanel = () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    onToggle?.(nuevo);
  };

  return (
    <div className="zona-control">
      <button
        type="button"
        className={`zona-chip ${
          notificacionesBloqueadas || ubicacionBloqueada
            ? 'zona-chip--alerta'
            : suscripcionCompleta
              ? 'zona-chip--activa'
              : ''
        }`}
        onClick={alternarPanel}
        aria-expanded={abierto}
      >
        <span>
          {notificacionesBloqueadas || ubicacionBloqueada
            ? '⚠ Permisos de zona bloqueados'
            : suscripcionCompleta
              ? '✓ Alertas 5 km activas'
              : '🔔 Alertas en mi zona (5 km)'}
        </span>
      </button>

      {abierto && (
        <section className="zona-panel" style={{ marginTop: 'var(--esp-3)' }} aria-label="Configuración de alertas en mi zona">
          <div className="zona-panel__fila">
            <div>
              <strong style={{ color: 'var(--color-primario)', fontSize: 'var(--tam-sm)' }}>
                Notificaciones geolocalizadas (radio 5 km)
              </strong>
              <p style={{ margin: '2px 0 0', fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
                Recibe alertas prioritarias (incluida Alerta Rosa) si ocurre una desaparición cerca
                de tu ubicación.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--primario btn--pequeno"
                onClick={manejarActivar}
                disabled={activando}
              >
                {activando
                  ? 'Configurando...'
                  : suscripcionCompleta
                    ? 'Actualizar ubicación'
                    : 'Activar ahora'}
              </button>
              <button
                type="button"
                className="btn btn--secundario btn--pequeno"
                onClick={alternarPanel}
              >
                Ocultar
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 'var(--esp-3)' }}>
            <span
              className={`badge ${
                notificacionesBloqueadas
                  ? 'badge--descartado'
                  : permisos.notificaciones === 'granted' || suscripcion?.permisoNotificaciones
                    ? 'badge--aprobado'
                    : 'badge--pendiente'
              }`}
            >
              Notificaciones:{' '}
              {notificacionesBloqueadas
                ? 'Bloqueadas'
                : permisos.notificaciones === 'granted' || suscripcion?.permisoNotificaciones
                  ? 'Activas'
                  : 'Pendiente'}
            </span>

            <span
              className={`badge ${
                ubicacionBloqueada
                  ? 'badge--descartado'
                  : permisos.ubicacion === 'granted' || suscripcion?.permisoUbicacion
                    ? 'badge--aprobado'
                    : 'badge--pendiente'
              }`}
            >
              GPS:{' '}
              {ubicacionBloqueada
                ? 'Bloqueado'
                : permisos.ubicacion === 'granted' || suscripcion?.permisoUbicacion
                  ? 'Activo'
                  : 'Pendiente'}
            </span>

            {!esOneSignalConfigurado() && (
              <span className="badge badge--activa">Modo desarrollo</span>
            )}
          </div>

          {(notificacionesBloqueadas || ubicacionBloqueada) && (
            <div className="aviso aviso--advertencia" style={{ marginTop: 'var(--esp-3)', marginBottom: 0 }}>
              <strong>Permisos bloqueados:</strong> haz clic en el ícono de candado en la barra de
              direcciones del navegador, cambia el permiso a <strong>Permitir</strong> y presiona{' '}
              <em>Activar ahora</em>.
            </div>
          )}

          {error && (
            <div className="aviso aviso--error" style={{ marginTop: 'var(--esp-3)', marginBottom: 0 }}>
              {error}
            </div>
          )}

          {exito && (
            <div className="aviso aviso--exito" style={{ marginTop: 'var(--esp-3)', marginBottom: 0 }}>
              {exito}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
