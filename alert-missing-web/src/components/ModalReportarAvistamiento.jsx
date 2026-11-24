import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { reportarAvistamiento } from '../api-client/avistamientoApi.js';
import { comprimirImagen, formatearTamanoBytes } from '../shared/imageCompressor.js';
import { useAuth } from '../state/AuthContext.jsx';
import { MapaInteractivo } from './MapaInteractivo.jsx';

function obtenerFechaHoraActualInput() {
  const ahora = new Date();
  const offsetMs = ahora.getTimezoneOffset() * 60000;
  return new Date(ahora.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function ModalReportarAvistamiento({
  ficha,
  abierto,
  onCerrar,
  onReportado,
}) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [lat, setLat] = useState(ficha?.ubicacionUltimoContacto?.lat ?? 4.711);
  const [lng, setLng] = useState(ficha?.ubicacionUltimoContacto?.lng ?? -74.0721);
  const [fechaHora, setFechaHora] = useState(obtenerFechaHoraActualInput);
  const [descripcion, setDescripcion] = useState('');
  const [evidencia, setEvidencia] = useState(null);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [obteniendoGps, setObteniendoGps] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [avisoResultado, setAvisoResultado] = useState(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !enviando) onCerrar?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto, enviando, onCerrar]);

  if (!abierto || !ficha) return null;

  const obtenerGps = () => {
    if (!navigator.geolocation) {
      setError('Tu navegador no soporta geolocalización GPS. Ingresa las coordenadas o marca el punto en el mapa.');
      return;
    }

    setObteniendoGps(true);
    setError('');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(6)));
        setLng(Number(pos.coords.longitude.toFixed(6)));
        setObteniendoGps(false);
      },
      () => {
        setError(
          'No se pudo obtener el GPS automáticamente. Puedes ajustar el punto en el mapa o escribir las coordenadas manualmente.'
        );
        setObteniendoGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const manejarEvidencia = async (event) => {
    const archivo = event.target.files?.[0];
    event.target.value = '';
    if (!archivo) return;

    setComprimiendo(true);
    setError('');
    try {
      const comprimida = await comprimirImagen(archivo, {
        maxWidth: 1200,
        quality: 0.8,
      });
      setEvidencia(comprimida);
    } catch (err) {
      setError(err.message || 'No se pudo procesar la fotografía de evidencia.');
    } finally {
      setComprimiendo(false);
    }
  };

  const manejarEnvio = async (event) => {
    event.preventDefault();
    setError('');

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setError('Ingrese una latitud válida entre -90 y 90.');
      return;
    }
    if (!Number.isFinite(lngNum) || lngNum < -180 || lngNum > 180) {
      setError('Ingrese una longitud válida entre -180 y 180.');
      return;
    }
    if (!fechaHora) {
      setError('Indique la fecha y hora aproximada del avistamiento.');
      return;
    }
    if (descripcion.trim().length < 5) {
      setError('Describa brevemente lo observado (mínimo 5 caracteres).');
      return;
    }

    setEnviando(true);
    try {
      const payload = {
        lat: latNum,
        lng: lngNum,
        fechaHora: new Date(fechaHora).toISOString(),
        descripcion: descripcion.trim(),
        evidenciaBase64: evidencia?.base64 || null,
        evidenciaContentType: evidencia?.contentType || null,
        evidenciaNombre: evidencia?.nombreArchivo || null,
      };

      const resultado = await reportarAvistamiento(ficha.id, payload);

      setAvisoResultado({
        offline: Boolean(resultado.offline),
        texto: resultado.mensaje,
      });

      onReportado?.(resultado);
    } catch (err) {
      setError(err.message || 'No fue posible registrar el avistamiento.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-modal-avistamiento"
      onClick={() => !enviando && onCerrar?.()}
    >
      <div className="modal modal--grande" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: 'var(--esp-3)',
          }}
        >
          <h2 id="titulo-modal-avistamiento" style={{ margin: 0, color: 'var(--color-primario)' }}>
            Reportar avistamiento
          </h2>
          <button
            type="button"
            className="btn btn--secundario btn--pequeno"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cerrar
          </button>
        </div>

        <p style={{ marginTop: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
          Ficha: <strong>{ficha.nombreDesaparecido}</strong>. Tu reporte quedará en estado{' '}
          <strong>PENDIENTE</strong> hasta que el creador de la ficha o un administrador lo valide.
        </p>

        {typeof navigator !== 'undefined' && navigator.onLine === false && (
          <div className="aviso aviso--advertencia">
            Actualmente estás sin conexión. Puedes llenar y enviar el reporte: se guardará
            localmente en tu dispositivo y se enviará automáticamente al recuperar internet.
          </div>
        )}

        {error && (
          <div className="aviso aviso--error" role="alert">
            {error}
          </div>
        )}

        {!isAuthenticated ? (
          <div>
            <div className="aviso aviso--advertencia" role="alert">
              Debes iniciar sesión con tu cuenta antes de reportar un avistamiento (protección
              contra reportes falsos y trazabilidad).
            </div>
            <div className="modal__acciones">
              <button type="button" className="btn btn--secundario" onClick={onCerrar}>
                Cancelar
              </button>
              <Link to="/login" state={{ from: location }} className="btn btn--primario">
                Iniciar sesión
              </Link>
            </div>
          </div>
        ) : avisoResultado ? (
          <div>
            <div
              className={`aviso ${
                avisoResultado.offline ? 'aviso--advertencia' : 'aviso--exito'
              }`}
              role="status"
            >
              {avisoResultado.texto}
            </div>
            <div className="modal__acciones">
              <button type="button" className="btn btn--primario" onClick={onCerrar}>
                Entendido
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={manejarEnvio} noValidate>
            <div style={{ marginBottom: 'var(--esp-3)' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: 'var(--esp-2)',
                }}
              >
                <span className="campo__label">Ubicación del avistamiento (GPS o manual) *</span>
                <button
                  type="button"
                  className="btn btn--secundario btn--pequeno"
                  onClick={obtenerGps}
                  disabled={obteniendoGps}
                >
                  {obteniendoGps ? 'Obteniendo GPS...' : 'Usar mi GPS actual'}
                </button>
              </div>

              <div className="grid-campos">
                <div className="campo" style={{ marginBottom: 'var(--esp-2)' }}>
                  <label htmlFor="avistamientoLat" className="campo__label">
                    Latitud
                  </label>
                  <input
                    id="avistamientoLat"
                    type="number"
                    step="0.000001"
                    className="campo__input"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    required
                  />
                </div>
                <div className="campo" style={{ marginBottom: 'var(--esp-2)' }}>
                  <label htmlFor="avistamientoLng" className="campo__label">
                    Longitud
                  </label>
                  <input
                    id="avistamientoLng"
                    type="number"
                    step="0.000001"
                    className="campo__input"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    required
                  />
                </div>
              </div>

              <MapaInteractivo
                lat={Number(lat) || 4.711}
                lng={Number(lng) || -74.0721}
                radioKm={1}
                esAlertaRosa={ficha.esAlertaRosa}
                seleccionable
                mostrarControlPuntosApoyo={false}
                altura="220px"
                tituloMarcador="Punto del avistamiento"
                onSeleccionarUbicacion={({ lat: nLat, lng: nLng }) => {
                  setLat(nLat);
                  setLng(nLng);
                }}
              />
            </div>

            <div className="campo">
              <label htmlFor="avistamientoFechaHora" className="campo__label">
                Fecha y hora del avistamiento *
              </label>
              <input
                id="avistamientoFechaHora"
                type="datetime-local"
                className="campo__input"
                value={fechaHora}
                max={obtenerFechaHoraActualInput()}
                onChange={(e) => setFechaHora(e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="avistamientoDescripcion" className="campo__label">
                Descripción detallada *
              </label>
              <textarea
                id="avistamientoDescripcion"
                rows={3}
                className="campo__textarea"
                placeholder="Indica qué vestimenta llevaba, hacia dónde se dirigía, acompañantes o puntos de referencia..."
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="avistamientoFoto" className="campo__label">
                Fotografía de evidencia (opcional)
              </label>
              <input
                id="avistamientoFoto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="campo__input"
                onChange={manejarEvidencia}
                disabled={comprimiendo}
              />
              <span className="campo__ayuda">
                Se comprime automáticamente en tu navegador (máx. 1200px) para envíos rápidos y
                soporte offline.
              </span>

              {comprimiendo && (
                <div className="aviso aviso--info" style={{ marginTop: 'var(--esp-2)' }}>
                  Comprimiendo imagen...
                </div>
              )}

              {evidencia && (
                <div
                  style={{
                    marginTop: 'var(--esp-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--esp-3)',
                  }}
                >
                  <img
                    src={evidencia.base64}
                    alt="Vista previa de evidencia"
                    className="avistamiento-item__evidencia"
                  />
                  <div style={{ fontSize: 'var(--tam-xs)' }}>
                    <div>
                      {formatearTamanoBytes(evidencia.tamanoOriginalBytes)} →{' '}
                      {formatearTamanoBytes(evidencia.tamanoComprimidoBytes)}
                    </div>
                    <button
                      type="button"
                      className="btn btn--peligro btn--pequeno"
                      style={{ marginTop: '0.4rem' }}
                      onClick={() => setEvidencia(null)}
                    >
                      Quitar foto
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="modal__acciones">
              <button
                type="button"
                className="btn btn--secundario"
                onClick={onCerrar}
                disabled={enviando}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn--primario"
                disabled={enviando || comprimiendo}
              >
                {enviando ? 'Enviando reporte...' : 'Enviar avistamiento'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
