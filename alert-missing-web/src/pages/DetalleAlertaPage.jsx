import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { obtenerAlertaPorId } from '../api-client/alertaApi.js';
import { listarAvistamientosPorFicha } from '../api-client/avistamientoApi.js';
import { listarAvistamientosOffline } from '../offline/offlineDb.js';
import { useAuth } from '../state/AuthContext.jsx';
import { MapaInteractivo } from '../components/MapaInteractivo.jsx';
import { ModalReportarAvistamiento } from '../components/ModalReportarAvistamiento.jsx';
import { PanelModeracionAvistamientos } from '../components/PanelModeracionAvistamientos.jsx';
import { ModalSirdec } from '../components/ModalSirdec.jsx';
import { PanelCierreAlerta } from '../components/PanelCierreAlerta.jsx';
import { PanelAuditoria } from '../components/PanelAuditoria.jsx';

function formatearFecha(iso) {
  if (!iso) return 'Sin registro';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatearTiempoRestanteSirdec(fechaLimiteIso) {
  if (!fechaLimiteIso) return null;
  const diffMs = new Date(fechaLimiteIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Plazo vencido';
  const totalMin = Math.floor(diffMs / 60000);
  const dias = Math.floor(totalMin / (60 * 24));
  const horas = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (dias > 0) return `quedan ${dias} d ${horas} h`;
  if (horas > 0) return `quedan ${horas} h ${mins} min`;
  return `quedan ${mins} min`;
}

export function DetalleAlertaPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();

  const [ficha, setFicha] = useState(null);
  const [fotoActiva, setFotoActiva] = useState(null);
  const [fotoActivaFallida, setFotoActivaFallida] = useState(false);
  const [avistamientos, setAvistamientos] = useState([]);
  const [pendientesOffline, setPendientesOffline] = useState([]);
  const [tabActiva, setTabActiva] = useState('mapa');

  const [modalReporteAbierto, setModalReporteAbierto] = useState(false);
  const [modalSirdecAbierto, setModalSirdecAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargarAvistamientos = useCallback(
    async (signal) => {
      try {
        const data = await listarAvistamientosPorFicha(id, {}, signal);
        setAvistamientos(data.avistamientos || []);
      } catch {
        // Mantener estado previo si falla la red
      }

      try {
        const locales = await listarAvistamientosOffline(id);
        setPendientesOffline(locales);
      } catch {
        setPendientesOffline([]);
      }
    },
    [id]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function cargarDetalle() {
      setCargando(true);
      setError('');
      try {
        const data = await obtenerAlertaPorId(id, controller.signal);
        const alerta = data.ficha;
        setFicha(alerta);
        const principal =
          alerta.fotografias?.find((f) => f.esPrincipal)?.url ||
          alerta.fotografias?.[0]?.url ||
          null;
        setFotoActiva(principal);
        setFotoActivaFallida(false);
        await cargarAvistamientos(controller.signal);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'No se pudo cargar el detalle de la alerta.');
        }
      } finally {
        setCargando(false);
      }
    }

    cargarDetalle();
    return () => controller.abort();
  }, [id, cargarAvistamientos]);

  useEffect(() => {
    const onSyncCompletada = () => cargarAvistamientos();
    window.addEventListener('alert-missing:sync-completada', onSyncCompletada);
    return () => window.removeEventListener('alert-missing:sync-completada', onSyncCompletada);
  }, [cargarAvistamientos]);

  const avistamientosAprobados = useMemo(
    () => avistamientos.filter((a) => a.estado === 'APROBADO'),
    [avistamientos]
  );

  const avistamientosPendientes = useMemo(
    () => avistamientos.filter((a) => a.estado === 'PENDIENTE').length,
    [avistamientos]
  );

  const esPropietarioOAdmin = Boolean(
    user &&
      ficha &&
      (user.rol === 'ADMINISTRADOR' || String(user.id) === String(ficha.creadorId))
  );

  if (cargando) {
    return (
      <div className="contenedor">
        <div className="estado-vacio">Cargando ficha de búsqueda...</div>
      </div>
    );
  }

  if (error || !ficha) {
    return (
      <div className="contenedor">
        <div className="aviso aviso--error">{error || 'Ficha de búsqueda no encontrada.'}</div>
        <Link to="/" className="btn btn--secundario">
          ← Volver a alertas
        </Link>
      </div>
    );
  }

  return (
    <div className="contenedor">
      <div style={{ marginBottom: 'var(--esp-3)' }}>
        <Link to="/" style={{ fontSize: 'var(--tam-sm)', fontWeight: 600 }}>
          ← Volver al listado de alertas
        </Link>
      </div>

      {ficha.estado === 'SUSPENDIDA_SIRDEC' ? (
        <div className="banner-sirdec-temporal banner-sirdec-temporal--suspendida" role="alert">
          <div>
            <strong>Alerta suspendida automáticamente (plazo SIRDEC vencido).</strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-sm)' }}>
              Venció el plazo de 1 día hábil sin completar el formato SIRDEC obligatorio, por lo que
              fue retirada temporalmente del listado y mapa público.
            </p>
          </div>
          {esPropietarioOAdmin && (
            <button
              type="button"
              className="btn btn--exito"
              onClick={() => setModalSirdecAbierto(true)}
            >
              Completar SIRDEC para reactivar
            </button>
          )}
        </div>
      ) : ficha.estado !== 'ACTIVA' ? (
        <div
          className={`aviso ${
            ficha.estado === 'LOCALIZADA' ? 'aviso--exito' : 'aviso--advertencia'
          }`}
        >
          <strong>
            {ficha.estado === 'LOCALIZADA'
              ? 'Persona localizada — Alerta cerrada.'
              : 'Alerta cancelada.'}
          </strong>{' '}
          Esta ficha ya fue retirada del listado público activo y su difusión está detenida.
        </div>
      ) : !ficha.sirdecCompletado ? (
        <div className="banner-sirdec-temporal" role="status">
          <div>
            <strong>
              {location.state?.recienCreadaTemporal
                ? '¡Alerta publicada temporalmente! Completa el formato SIRDEC para dejarla definitiva.'
                : 'Alerta temporal — pendiente completar formato SIRDEC obligatorio.'}
            </strong>
            <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-sm)' }}>
              Esta publicación permanecerá activa temporalmente hasta que se diligencie el registro
              completo en formato SIRDEC ({ficha.resumenSirdec?.completadosObligatorios ?? 0}/
              {ficha.resumenSirdec?.totalObligatorios ?? 9} campos obligatorios).
              {ficha.sirdecFechaLimite && (
                <>
                  {' '}
                  <strong>Plazo límite (1 día hábil):</strong>{' '}
                  {formatearFecha(ficha.sirdecFechaLimite)} (
                  {formatearTiempoRestanteSirdec(ficha.sirdecFechaLimite)}).
                </>
              )}
            </p>
          </div>
          {esPropietarioOAdmin && (
            <button
              type="button"
              className="btn btn--primario"
              onClick={() => setModalSirdecAbierto(true)}
            >
              Completar formato SIRDEC ahora
            </button>
          )}
        </div>
      ) : null}

      {pendientesOffline.length > 0 && (
        <div className="aviso aviso--advertencia" role="status">
          Tienes <strong>{pendientesOffline.length}</strong> reporte(s) de avistamiento guardados
          sin conexión para esta ficha. Se enviarán al reconectar.
        </div>
      )}

      {/* Bloque superior limpio: Galería + Información esencial + Acciones */}
      <section className={`detalle-hero ${ficha.esAlertaRosa ? 'detalle-hero--rosa' : ''}`}>
        <div>
          {fotoActiva && !fotoActivaFallida ? (
            <img
              src={fotoActiva}
              alt={`Fotografía de ${ficha.nombreDesaparecido}`}
              className="galeria-principal"
              onError={() => setFotoActivaFallida(true)}
            />
          ) : (
            <div className="alerta-card__sin-foto" style={{ height: '300px', borderRadius: 'var(--radio-md)' }}>
              Fotografía no disponible
            </div>
          )}

          {ficha.fotografias?.length > 1 && (
            <div className="galeria-miniaturas" role="list" aria-label="Miniaturas de fotografías">
              {ficha.fotografias.map((foto) => (
                <button
                  key={foto.id || foto.url}
                  type="button"
                  className={`galeria-miniatura ${
                    fotoActiva === foto.url ? 'galeria-miniatura--activa' : ''
                  }`}
                  onClick={() => {
                    setFotoActiva(foto.url);
                    setFotoActivaFallida(false);
                  }}
                >
                  <img src={foto.url} alt={`Vista de ${ficha.nombreDesaparecido}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.6rem' }}>
            {ficha.esAlertaRosa && (
              <span className="badge badge--alerta-rosa">Alerta Rosa · Ley 2326</span>
            )}
            <span
              className={`badge ${
                ficha.estado === 'LOCALIZADA'
                  ? 'badge--aprobado'
                  : ficha.estado === 'CANCELADA' || ficha.estado === 'SUSPENDIDA_SIRDEC'
                    ? 'badge--descartado'
                    : 'badge--activa'
              }`}
            >
              {ficha.estado === 'SUSPENDIDA_SIRDEC' ? 'Suspendida SIRDEC' : ficha.estado}
            </span>
            {ficha.sirdecCompletado ? (
              <span className="badge badge--aprobado">SIRDEC Completo</span>
            ) : (
              <span className="badge badge--pendiente">Temporal · SIRDEC pendiente</span>
            )}
          </div>

          <h1 className="pagina-header__titulo" style={{ fontSize: '1.65rem' }}>
            {ficha.nombreDesaparecido}
          </h1>

          <dl className="lista-datos">
            <div className="lista-datos__item">
              <dt>Edad y género</dt>
              <dd>
                {ficha.edad} años · {ficha.genero}
              </dd>
            </div>
            <div className="lista-datos__item">
              <dt>Último contacto</dt>
              <dd>{formatearFecha(ficha.fechaHoraUltimoContacto)}</dd>
            </div>
            <div className="lista-datos__item" style={{ gridColumn: '1 / -1' }}>
              <dt>Ubicación registrada</dt>
              <dd>
                {ficha.direccionTexto || 'Ubicación marcada en mapa'} (radio {ficha.radioBusquedaKm}{' '}
                km)
              </dd>
            </div>
            <div className="lista-datos__item" style={{ gridColumn: '1 / -1' }}>
              <dt>Señas particulares</dt>
              <dd>{ficha.senasParticulares || 'No registradas'}</dd>
            </div>
            <div className="lista-datos__item" style={{ gridColumn: '1 / -1' }}>
              <dt>Vestimenta</dt>
              <dd>{ficha.vestimenta || 'No registrada'}</dd>
            </div>
          </dl>

          <div className="detalle-info__acciones">
            {ficha.estado === 'ACTIVA' &&
              (isAuthenticated ? (
                <button
                  type="button"
                  className={`btn ${ficha.esAlertaRosa ? 'btn--rosa' : 'btn--primario'}`}
                  onClick={() => setModalReporteAbierto(true)}
                >
                  + Reportar avistamiento
                </button>
              ) : (
                <Link
                  to="/login"
                  state={{ from: location }}
                  className={`btn ${ficha.esAlertaRosa ? 'btn--rosa' : 'btn--primario'}`}
                >
                  Inicia sesión para reportar avistamiento
                </Link>
              ))}

            <button
              type="button"
              className="btn btn--secundario"
              onClick={() => setModalSirdecAbierto(true)}
            >
              Exportar SIRDEC (PDF / JSON)
            </button>
          </div>
        </div>
      </section>

      {/* Navegación por pestañas para evitar saturación vertical */}
      <div className="tabs-barra" role="tablist" aria-label="Secciones de la ficha">
        <button
          type="button"
          role="tab"
          aria-selected={tabActiva === 'mapa'}
          className={`tabs-barra__btn ${tabActiva === 'mapa' ? 'tabs-barra__btn--activo' : ''}`}
          onClick={() => setTabActiva('mapa')}
        >
          Mapa y Puntos de Apoyo
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tabActiva === 'avistamientos'}
          className={`tabs-barra__btn ${
            tabActiva === 'avistamientos' ? 'tabs-barra__btn--activo' : ''
          }`}
          onClick={() => setTabActiva('avistamientos')}
        >
          Avistamientos
          <span className="tabs-barra__contador">{avistamientosAprobados.length}</span>
        </button>

        {esPropietarioOAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={tabActiva === 'moderacion'}
            className={`tabs-barra__btn ${
              tabActiva === 'moderacion' ? 'tabs-barra__btn--activo' : ''
            }`}
            onClick={() => setTabActiva('moderacion')}
          >
            Moderación
            {avistamientosPendientes > 0 && (
              <span className="tabs-barra__contador tabs-barra__contador--aviso">
                {avistamientosPendientes}
              </span>
            )}
          </button>
        )}

        {esPropietarioOAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={tabActiva === 'gestion'}
            className={`tabs-barra__btn ${tabActiva === 'gestion' ? 'tabs-barra__btn--activo' : ''}`}
            onClick={() => setTabActiva('gestion')}
          >
            Gestionar / Cerrar
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={tabActiva === 'auditoria'}
          className={`tabs-barra__btn ${
            tabActiva === 'auditoria' ? 'tabs-barra__btn--activo' : ''
          }`}
          onClick={() => setTabActiva('auditoria')}
        >
          Historial y Auditoría
        </button>
      </div>

      {/* Contenido de cada pestaña */}
      {tabActiva === 'mapa' && (
        <MapaInteractivo
          lat={ficha.ubicacionUltimoContacto.lat}
          lng={ficha.ubicacionUltimoContacto.lng}
          radioKm={ficha.radioBusquedaKm}
          esAlertaRosa={ficha.esAlertaRosa}
          direccionTexto={ficha.direccionTexto || ''}
          tituloMarcador={`Último contacto: ${ficha.nombreDesaparecido}`}
          avistamientosAprobados={avistamientosAprobados}
          mostrarControlPuntosApoyo
        />
      )}

      {tabActiva === 'avistamientos' && (
        <section className="tarjeta" aria-label="Avistamientos confirmados">
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: 'var(--esp-4)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 'var(--tam-lg)', color: 'var(--color-primario)' }}>
              Avistamientos confirmados ({avistamientosAprobados.length})
            </h2>
            {ficha.estado === 'ACTIVA' &&
              (isAuthenticated ? (
                <button
                  type="button"
                  className="btn btn--primario btn--pequeno"
                  onClick={() => setModalReporteAbierto(true)}
                >
                  + Reportar avistamiento
                </button>
              ) : (
                <Link
                  to="/login"
                  state={{ from: location }}
                  className="btn btn--secundario btn--pequeno"
                >
                  Iniciar sesión para reportar
                </Link>
              ))}
          </div>

          {avistamientosAprobados.length > 0 ? (
            <ul className="avistamiento-lista">
              {avistamientosAprobados.map((av) => (
                <li key={av.id} className="avistamiento-item">
                  <div className="avistamiento-item__cabecera">
                    <span className="badge badge--aprobado">Confirmado</span>
                    <span className="historial-item__fecha">{formatearFecha(av.fechaHora)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 'var(--tam-sm)' }}>{av.descripcion}</p>
                  <span className="historial-item__fecha">
                    Coordenadas: {av.coordenadas.lat.toFixed(5)}, {av.coordenadas.lng.toFixed(5)}
                  </span>
                  {av.urlEvidencia && (
                    <a href={av.urlEvidencia} target="_blank" rel="noreferrer">
                      <img
                        src={av.urlEvidencia}
                        alt="Evidencia de avistamiento confirmado"
                        className="avistamiento-item__evidencia"
                      />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="estado-vacio" style={{ padding: 'var(--esp-6)' }}>
              <p style={{ margin: 0, fontSize: 'var(--tam-sm)' }}>
                Aún no hay avistamientos aprobados para esta ficha.
              </p>
            </div>
          )}
        </section>
      )}

      {tabActiva === 'moderacion' && esPropietarioOAdmin && (
        <PanelModeracionAvistamientos
          ficha={ficha}
          avistamientos={avistamientos}
          onActualizado={() => cargarAvistamientos()}
        />
      )}

      {tabActiva === 'gestion' && esPropietarioOAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-4)' }}>
          <PanelCierreAlerta
            ficha={ficha}
            onEstadoActualizado={(fichaActualizada) => setFicha(fichaActualizada)}
          />

          <section className="tarjeta">
            <h3 style={{ marginTop: 0, color: 'var(--color-primario)' }}>
              Ficha morfológica SIRDEC (Fiscalía / Medicina Legal)
            </h3>
            <p style={{ margin: '0 0 var(--esp-3)', fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
              Completa datos físicos adicionales y descarga el reporte oficial en PDF o JSON.
            </p>
            <button
              type="button"
              className="btn btn--secundario"
              onClick={() => setModalSirdecAbierto(true)}
            >
              Completar y exportar SIRDEC
            </button>
          </section>
        </div>
      )}

      {tabActiva === 'auditoria' && <PanelAuditoria ficha={ficha} />}

      <ModalReportarAvistamiento
        ficha={ficha}
        abierto={modalReporteAbierto}
        onCerrar={() => setModalReporteAbierto(false)}
        onReportado={() => {
          cargarAvistamientos();
          window.dispatchEvent(new CustomEvent('alert-missing:cola-actualizada'));
        }}
      />

      <ModalSirdec
        ficha={ficha}
        abierto={modalSirdecAbierto}
        onCerrar={() => setModalSirdecAbierto(false)}
        onFichaActualizada={(fichaActualizada) => setFicha(fichaActualizada)}
      />
    </div>
  );
}
