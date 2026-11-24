import { useMemo, useState } from 'react';
import { aprobarAvistamiento, descartarAvistamiento } from '../api-client/avistamientoApi.js';
import { useAuth } from '../state/AuthContext.jsx';

function formatearFecha(iso) {
  if (!iso) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PanelModeracionAvistamientos({
  ficha,
  avistamientos = [],
  onActualizado,
}) {
  const { usuario } = useAuth();
  const [filtroEstado, setFiltroEstado] = useState('PENDIENTE');
  const [procesandoId, setProcesandoId] = useState(null);
  const [descarteAbiertoId, setDescarteAbiertoId] = useState(null);
  const [motivoDescarte, setMotivoDescarte] = useState('');
  const [bloquearRemitente, setBloquearRemitente] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const puedeModerar = Boolean(
    usuario &&
      ficha &&
      (usuario.rol === 'ADMINISTRADOR' || String(usuario.id) === String(ficha.creadorId))
  );

  const conteos = useMemo(() => {
    return {
      PENDIENTE: avistamientos.filter((a) => a.estado === 'PENDIENTE').length,
      APROBADO: avistamientos.filter((a) => a.estado === 'APROBADO').length,
      DESCARTADO: avistamientos.filter((a) => a.estado === 'DESCARTADO').length,
      TODOS: avistamientos.length,
    };
  }, [avistamientos]);

  const filtrados = useMemo(() => {
    if (filtroEstado === 'TODOS') return avistamientos;
    return avistamientos.filter((a) => a.estado === filtroEstado);
  }, [avistamientos, filtroEstado]);

  if (!puedeModerar) {
    return null;
  }

  const manejarAprobar = async (avistamientoId) => {
    setProcesandoId(avistamientoId);
    setMensaje(null);
    try {
      await aprobarAvistamiento(avistamientoId);
      setMensaje({
        tipo: 'exito',
        texto: 'Avistamiento aprobado y publicado en el mapa público.',
      });
      await onActualizado?.();
    } catch (err) {
      setMensaje({
        tipo: 'error',
        texto: err.message || 'No se pudo aprobar el avistamiento.',
      });
    } finally {
      setProcesandoId(null);
    }
  };

  const abrirDescarte = (avistamientoId) => {
    setDescarteAbiertoId(avistamientoId);
    setMotivoDescarte('');
    setBloquearRemitente(false);
    setMensaje(null);
  };

  const confirmarDescarte = async (avistamientoId) => {
    setProcesandoId(avistamientoId);
    setMensaje(null);
    try {
      const res = await descartarAvistamiento(avistamientoId, {
        motivo: motivoDescarte,
        bloquearOrigen: bloquearRemitente,
      });

      const detalleBloqueo = res.origenBloqueado?.solicitado
        ? ' Además se aplicó bloqueo/registro al remitente por abuso o spam.'
        : '';

      setMensaje({
        tipo: 'info',
        texto: `Reporte descartado y ocultado del mapa público.${detalleBloqueo}`,
      });
      setDescarteAbiertoId(null);
      setMotivoDescarte('');
      setBloquearRemitente(false);
      await onActualizado?.();
    } catch (err) {
      setMensaje({
        tipo: 'error',
        texto: err.message || 'No se pudo descartar el avistamiento.',
      });
    } finally {
      setProcesandoId(null);
    }
  };

  return (
    <section className="panel-moderacion" aria-label="Panel de moderación de avistamientos">
      <div style={{ marginBottom: 'var(--esp-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--tam-lg)', color: 'var(--color-primario)' }}>
          Panel de Moderación de Avistamientos
        </h2>
        <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
          Visible únicamente para el creador de la ficha y administradores. Valide los reportes
          ciudadanos antes de que aparezcan en el mapa público.
        </p>
      </div>

      {mensaje && (
        <div
          className={`aviso ${
            mensaje.tipo === 'error'
              ? 'aviso--error'
              : mensaje.tipo === 'exito'
                ? 'aviso--exito'
                : 'aviso--info'
          }`}
          role="status"
        >
          {mensaje.texto}
        </div>
      )}

      <div className="tabs-moderacion" role="tablist">
        {[
          { clave: 'PENDIENTE', etiqueta: `Pendientes (${conteos.PENDIENTE})` },
          { clave: 'APROBADO', etiqueta: `Aprobados (${conteos.APROBADO})` },
          { clave: 'DESCARTADO', etiqueta: `Descartados (${conteos.DESCARTADO})` },
          { clave: 'TODOS', etiqueta: `Todos (${conteos.TODOS})` },
        ].map((tab) => (
          <button
            key={tab.clave}
            type="button"
            role="tab"
            aria-selected={filtroEstado === tab.clave}
            className={`tab-btn ${filtroEstado === tab.clave ? 'tab-btn--activo' : ''}`}
            onClick={() => setFiltroEstado(tab.clave)}
          >
            {tab.etiqueta}
          </button>
        ))}
      </div>

      {filtrados.length === 0 ? (
        <p style={{ margin: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
          No hay reportes en esta categoría.
        </p>
      ) : (
        <ul className="avistamiento-lista">
          {filtrados.map((item) => {
            const enProceso = procesandoId === item.id;
            const badgeClase =
              item.estado === 'APROBADO'
                ? 'badge--aprobado'
                : item.estado === 'DESCARTADO'
                  ? 'badge--descartado'
                  : 'badge--pendiente';

            return (
              <li key={item.id} className="avistamiento-item">
                <div className="avistamiento-item__cabecera">
                  <span className={`badge ${badgeClase}`}>{item.estado}</span>
                  <span style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
                    Avistamiento: {formatearFecha(item.fechaHora)}
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: 'var(--tam-sm)' }}>{item.descripcion}</p>

                <div style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
                  Coordenadas: {item.coordenadas.lat.toFixed(5)}, {item.coordenadas.lng.toFixed(5)}
                  {item.ipOrigen ? ` · IP: ${item.ipOrigen}` : ''}
                </div>

                {item.urlEvidencia && (
                  <div>
                    <a href={item.urlEvidencia} target="_blank" rel="noreferrer">
                      <img
                        src={item.urlEvidencia}
                        alt="Evidencia del avistamiento"
                        className="avistamiento-item__evidencia"
                      />
                    </a>
                  </div>
                )}

                {item.motivoRechazo && (
                  <div style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-peligro)' }}>
                    <strong>Motivo de descarte:</strong> {item.motivoRechazo}
                  </div>
                )}

                {item.estado !== 'DESCARTADO' && (
                  <div className="avistamiento-item__acciones">
                    {item.estado === 'PENDIENTE' && (
                      <button
                        type="button"
                        className="btn btn--primario btn--pequeno"
                        disabled={enProceso}
                        onClick={() => manejarAprobar(item.id)}
                      >
                        {enProceso ? 'Procesando...' : 'Aprobar avistamiento'}
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn btn--peligro btn--pequeno"
                      disabled={enProceso}
                      onClick={() =>
                        descarteAbiertoId === item.id
                          ? setDescarteAbiertoId(null)
                          : abrirDescarte(item.id)
                      }
                    >
                      Descartar reporte
                    </button>
                  </div>
                )}

                {descarteAbiertoId === item.id && (
                  <div className="descarte-box">
                    <label
                      htmlFor={`motivo-${item.id}`}
                      className="campo__label"
                      style={{ fontSize: 'var(--tam-xs)' }}
                    >
                      Motivo del descarte (opcional)
                    </label>
                    <input
                      id={`motivo-${item.id}`}
                      type="text"
                      className="campo__input"
                      placeholder="Ej. Reporte duplicado, información falsa o spam..."
                      value={motivoDescarte}
                      onChange={(e) => setMotivoDescarte(e.target.value)}
                    />

                    <label className="mapa-toggle" style={{ fontSize: 'var(--tam-xs)' }}>
                      <input
                        type="checkbox"
                        checked={bloquearRemitente}
                        onChange={(e) => setBloquearRemitente(e.target.checked)}
                      />
                      <span>Bloquear remitente malicioso (cuenta / IP por abuso o spam)</span>
                    </label>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn--peligro btn--pequeno"
                        disabled={enProceso}
                        onClick={() => confirmarDescarte(item.id)}
                      >
                        {enProceso ? 'Descartando...' : 'Confirmar descarte'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--secundario btn--pequeno"
                        disabled={enProceso}
                        onClick={() => setDescarteAbiertoId(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
