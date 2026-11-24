import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarMisAlertas, obtenerMiAuditoria } from '../api-client/alertaApi.js';
import { listarMisAvistamientos } from '../api-client/avistamientoApi.js';

function formatearFecha(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function MisReportesPage() {
  const [tab, setTab] = useState('fichas');
  const [misFichas, setMisFichas] = useState([]);
  const [misAvistamientos, setMisAvistamientos] = useState([]);
  const [miAuditoria, setMiAuditoria] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function cargarTodo() {
      setCargando(true);
      setError('');
      try {
        const [fichasRes, avistRes, auditRes] = await Promise.all([
          listarMisAlertas(controller.signal),
          listarMisAvistamientos(controller.signal),
          obtenerMiAuditoria(controller.signal),
        ]);
        setMisFichas(fichasRes.alertas || []);
        setMisAvistamientos(avistRes.avistamientos || []);
        setMiAuditoria(auditRes.registros || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'No se pudo cargar tu historial de reportes.');
        }
      } finally {
        setCargando(false);
      }
    }

    cargarTodo();
    return () => controller.abort();
  }, []);

  return (
    <div className="contenedor">
      <div className="pagina-header">
        <div>
          <h1 className="pagina-header__titulo">Mis Reportes</h1>
          <p className="pagina-header__subtitulo">
            Consulta y gestiona las fichas que creaste, los avistamientos que enviaste y tu
            historial de actividad.
          </p>
        </div>

        <Link to="/alertas/nueva" className="btn btn--rosa">
          + Nueva ficha de búsqueda
        </Link>
      </div>

      {error && (
        <div className="aviso aviso--error" role="alert">
          {error}
        </div>
      )}

      <div className="tabs-barra" role="tablist" aria-label="Categorías de mis reportes">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fichas'}
          className={`tabs-barra__btn ${tab === 'fichas' ? 'tabs-barra__btn--activo' : ''}`}
          onClick={() => setTab('fichas')}
        >
          Mis fichas creadas
          <span className="tabs-barra__contador">{misFichas.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'avistamientos'}
          className={`tabs-barra__btn ${tab === 'avistamientos' ? 'tabs-barra__btn--activo' : ''}`}
          onClick={() => setTab('avistamientos')}
        >
          Mis avistamientos
          <span className="tabs-barra__contador">{misAvistamientos.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'actividad'}
          className={`tabs-barra__btn ${tab === 'actividad' ? 'tabs-barra__btn--activo' : ''}`}
          onClick={() => setTab('actividad')}
        >
          Mi actividad
          <span className="tabs-barra__contador">{miAuditoria.length}</span>
        </button>
      </div>

      {cargando ? (
        <div className="estado-vacio">Cargando tu historial...</div>
      ) : (
        <>
          {tab === 'fichas' &&
            (misFichas.length === 0 ? (
              <div className="estado-vacio">
                <h2 className="estado-vacio__titulo">Aún no has creado fichas de búsqueda</h2>
                <p style={{ margin: '0 0 var(--esp-4)', fontSize: 'var(--tam-sm)' }}>
                  Cuando registres una alerta aparecerá aquí con acceso directo a moderación,
                  SIRDEC y cierre.
                </p>
                <Link to="/alertas/nueva" className="btn btn--primario">
                  Crear mi primera ficha
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-3)' }}>
                {misFichas.map((ficha) => {
                  const foto =
                    ficha.fotografias?.find((f) => f.esPrincipal)?.url ||
                    ficha.fotografias?.[0]?.url ||
                    null;

                  return (
                    <article key={ficha.id} className="reporte-fila">
                      <div className="reporte-fila__info">
                        {foto ? (
                          <img
                            src={foto}
                            alt={ficha.nombreDesaparecido}
                            className="reporte-fila__thumb"
                          />
                        ) : (
                          <div className="reporte-fila__thumb" />
                        )}

                        <div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.2rem' }}>
                            <strong style={{ color: 'var(--color-primario)' }}>
                              {ficha.nombreDesaparecido}
                            </strong>
                            {ficha.esAlertaRosa && (
                              <span className="badge badge--alerta-rosa">Alerta Rosa</span>
                            )}
                            <span
                              className={`badge ${
                                ficha.estado === 'LOCALIZADA'
                                  ? 'badge--aprobado'
                                  : ficha.estado === 'CANCELADA' ||
                                      ficha.estado === 'SUSPENDIDA_SIRDEC'
                                    ? 'badge--descartado'
                                    : 'badge--activa'
                              }`}
                            >
                              {ficha.estado === 'SUSPENDIDA_SIRDEC'
                                ? 'Suspendida SIRDEC'
                                : ficha.estado}
                            </span>
                            {ficha.sirdecCompletado ? (
                              <span className="badge badge--aprobado">SIRDEC completo</span>
                            ) : (
                              <span className="badge badge--pendiente">
                                Temporal · SIRDEC pendiente
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
                            {ficha.edad} años · {ficha.direccionTexto || 'Ubicación en mapa'} ·
                            Creada {formatearFecha(ficha.createdAt)}
                            {!ficha.sirdecCompletado && ficha.sirdecFechaLimite && (
                              <> · Plazo SIRDEC: {formatearFecha(ficha.sirdecFechaLimite)}</>
                            )}
                          </div>
                        </div>
                      </div>

                      <Link
                        to={`/alertas/${ficha.id}`}
                        className={`btn ${
                          !ficha.sirdecCompletado ? 'btn--primario' : 'btn--secundario'
                        } btn--pequeno`}
                      >
                        {ficha.estado === 'SUSPENDIDA_SIRDEC'
                          ? 'Completar SIRDEC y reactivar →'
                          : !ficha.sirdecCompletado
                            ? 'Completar SIRDEC →'
                            : 'Abrir / Gestionar →'}
                      </Link>
                    </article>
                  );
                })}
              </div>
            ))}

          {tab === 'avistamientos' &&
            (misAvistamientos.length === 0 ? (
              <div className="estado-vacio">
                <h2 className="estado-vacio__titulo">No has reportado avistamientos aún</h2>
                <p style={{ margin: 0, fontSize: 'var(--tam-sm)' }}>
                  Los avistamientos que reportes en cualquier alerta aparecerán aquí con su estado
                  de validación.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-3)' }}>
                {misAvistamientos.map((av) => (
                  <article key={av.id} className="reporte-fila">
                    <div style={{ flex: '1 1 300px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.3rem' }}>
                        <span
                          className={`badge ${
                            av.estado === 'APROBADO'
                              ? 'badge--aprobado'
                              : av.estado === 'DESCARTADO'
                                ? 'badge--descartado'
                                : 'badge--pendiente'
                          }`}
                        >
                          {av.estado}
                        </span>
                        <strong style={{ color: 'var(--color-primario)', fontSize: 'var(--tam-sm)' }}>
                          {av.ficha?.nombreDesaparecido || 'Ficha de búsqueda'}
                        </strong>
                        <span style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
                          · {formatearFecha(av.fechaHora)}
                        </span>
                      </div>

                      <p style={{ margin: '0 0 0.25rem', fontSize: 'var(--tam-sm)' }}>
                        {av.descripcion}
                      </p>

                      {av.motivoRechazo && (
                        <p style={{ margin: 0, fontSize: 'var(--tam-xs)', color: 'var(--color-peligro)' }}>
                          Motivo de descarte: {av.motivoRechazo}
                        </p>
                      )}
                    </div>

                    {av.fichaId && (
                      <Link
                        to={`/alertas/${av.fichaId}`}
                        className="btn btn--secundario btn--pequeno"
                      >
                        Ver ficha →
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            ))}

          {tab === 'actividad' && (
            <section className="tarjeta">
              {miAuditoria.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
                  Sin actividad registrada aún.
                </p>
              ) : (
                <div className="tabla-scroll">
                  <table className="tabla-auditoria">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Acción</th>
                        <th>Entidad</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {miAuditoria.map((reg) => (
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
            </section>
          )}
        </>
      )}
    </div>
  );
}
