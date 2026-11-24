import { useCallback, useEffect, useState } from 'react';
import { obtenerAuditoriaFicha, obtenerSaludServicio } from '../api-client/alertaApi.js';
import { useAuth } from '../state/AuthContext.jsx';

function formatearFecha(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PanelAuditoria({ ficha }) {
  const { user } = useAuth();
  const [salud, setSalud] = useState(null);
  const [registrosAuditoria, setRegistrosAuditoria] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorAuditoria, setErrorAuditoria] = useState('');

  const puedeVerAuditoria = Boolean(
    user &&
      ficha &&
      (user.rol === 'ADMINISTRADOR' || String(user.id) === String(ficha.creadorId))
  );

  const cargarTrazabilidad = useCallback(async () => {
    setCargando(true);
    setErrorAuditoria('');

    try {
      const healthData = await obtenerSaludServicio();
      setSalud(healthData);
    } catch {
      setSalud(null);
    }

    if (puedeVerAuditoria && ficha?.id) {
      try {
        const res = await obtenerAuditoriaFicha(ficha.id);
        setRegistrosAuditoria(res.registros || []);
      } catch (err) {
        setErrorAuditoria(
          err.message || 'No se pudieron consultar los registros de auditoría.'
        );
      }
    }

    setCargando(false);
  }, [ficha?.id, puedeVerAuditoria]);

  useEffect(() => {
    cargarTrazabilidad();
  }, [cargarTrazabilidad, ficha?.estado, ficha?.historialEstados?.length]);

  if (!ficha) return null;

  return (
    <section className="panel-auditoria" aria-label="Panel de auditoría, trazabilidad y rendimiento">
      <div className="panel-auditoria__cabecera">
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--tam-lg)', color: 'var(--color-primario)' }}>
            Trazabilidad, Auditoría Inmutable y Rendimiento
          </h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
            Registros protegidos en PostgreSQL mediante triggers append-only (sin UPDATE ni DELETE)
            y verificación en tiempo real del API y cola de notificaciones.
          </p>
        </div>

        <button
          type="button"
          className="btn btn--secundario btn--pequeno"
          onClick={cargarTrazabilidad}
          disabled={cargando}
        >
          {cargando ? 'Actualizando...' : 'Actualizar métricas'}
        </button>
      </div>

      {/* Indicadores de salud y rendimiento (CAL-04 / CAL-05 / CAL-08) */}
      {salud && (
        <div className="grid-metricas">
          <div className="metrica-card">
            <span className="metrica-card__label">Estado API (/api/health)</span>
            <strong className="metrica-card__valor" style={{ color: 'var(--color-exito)' }}>
              {salud.estado}
            </strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-card__label">Latencia respuesta</span>
            <strong className="metrica-card__valor">{salud.latenciaMs} ms</strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-card__label">Cola Prioridad Alta / Normal</span>
            <strong className="metrica-card__valor">
              {salud.colaNotificaciones?.pendientesAlta ?? 0} /{' '}
              {salud.colaNotificaciones?.pendientesNormal ?? 0}
            </strong>
          </div>
          <div className="metrica-card">
            <span className="metrica-card__label">Último despacho Worker</span>
            <strong className="metrica-card__valor">
              {salud.colaNotificaciones?.ultimoDespachoMs !== null &&
              salud.colaNotificaciones?.ultimoDespachoMs !== undefined
                ? `${salud.colaNotificaciones.ultimoDespachoMs} ms`
                : 'Sin despachos'}
            </strong>
          </div>
        </div>
      )}

      {/* Historial Inmutable de Estados */}
      <div style={{ marginTop: 'var(--esp-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 'var(--esp-2)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tam-base)', color: 'var(--color-primario)' }}>
            Historial inmutable de estados ({ficha.historialEstados?.length || 0})
          </h3>
          <span className="badge badge--activa">Append-Only</span>
        </div>

        {ficha.historialEstados?.length > 0 ? (
          <ul className="historial-lista">
            {ficha.historialEstados.map((item) => (
              <li key={item.id || item.fecha} className="historial-item">
                <strong>{item.estadoNuevo}</strong>
                <p style={{ margin: '0.2rem 0', fontSize: 'var(--tam-sm)' }}>
                  {item.resumenOMotivo}
                </p>
                <span className="historial-item__fecha">{formatearFecha(item.fecha)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
            Sin eventos en el historial de estados.
          </p>
        )}
      </div>

      {/* Bitácora de Auditoría (visible para creador o administrador) */}
      <div style={{ marginTop: 'var(--esp-4)', paddingTop: 'var(--esp-4)', borderTop: '1px solid var(--color-borde)' }}>
        <h3 style={{ margin: '0 0 var(--esp-2)', fontSize: 'var(--tam-base)', color: 'var(--color-primario)' }}>
          Bitácora de seguridad y auditoría (registros_auditoria)
        </h3>

        {!puedeVerAuditoria ? (
          <p style={{ margin: 0, fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
            Inicia sesión como creador de la ficha o administrador para consultar los registros
            detallados de auditoría (IPs, acciones de moderación y exportaciones SIRDEC).
          </p>
        ) : errorAuditoria ? (
          <div className="aviso aviso--error" style={{ marginBottom: 0 }}>
            {errorAuditoria}
          </div>
        ) : registrosAuditoria.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
            No hay eventos de auditoría registrados aún para esta ficha.
          </p>
        ) : (
          <div className="tabla-scroll">
            <table className="tabla-auditoria">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>IP origen</th>
                </tr>
              </thead>
              <tbody>
                {registrosAuditoria.map((reg) => (
                  <tr key={reg.id}>
                    <td>{formatearFecha(reg.fecha)}</td>
                    <td>
                      <code>{reg.accion}</code>
                    </td>
                    <td>{reg.entidad}</td>
                    <td>{reg.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
