import { useEffect, useState } from 'react';
import {
  buscarDireccionColombia,
  crearFichaBusqueda,
  obtenerDireccionPorCoordenadas,
} from '../api-client/alertaApi.js';
import { comprimirImagen, formatearTamanoBytes } from '../shared/imageCompressor.js';
import { MapaInteractivo } from './MapaInteractivo.jsx';

const DEFAULT_LAT = Number(import.meta.env.VITE_MAP_DEFAULT_LAT) || 4.711;
const DEFAULT_LNG = Number(import.meta.env.VITE_MAP_DEFAULT_LNG) || -74.0721;

const PASOS = [
  { numero: 1, titulo: 'Datos básicos' },
  { numero: 2, titulo: 'Fotos y rasgos' },
  { numero: 3, titulo: 'Ubicación (5 km)' },
];

function obtenerFechaHoraLocalActual() {
  const ahora = new Date();
  const offsetMs = ahora.getTimezoneOffset() * 60000;
  return new Date(ahora.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function FormularioFichaPasos({ onCreada }) {
  const [pasoActual, setPasoActual] = useState(1);

  // Paso 1: Datos básicos y Alerta Rosa (Ley 2326)
  const [nombreDesaparecido, setNombreDesaparecido] = useState('');
  const [edad, setEdad] = useState('');
  const [genero, setGenero] = useState('FEMENINO');
  const [fechaHoraUltimoContacto, setFechaHoraUltimoContacto] = useState(
    obtenerFechaHoraLocalActual
  );
  const [esAlertaRosa, setEsAlertaRosa] = useState(false);

  // Paso 2: Fotografías comprimidas, señas particulares y vestimenta
  const [fotografias, setFotografias] = useState([]);
  const [comprimiendoFoto, setComprimiendoFoto] = useState(false);
  const [senasParticulares, setSenasParticulares] = useState('');
  const [vestimenta, setVestimenta] = useState('');

  // Paso 3: Ubicación, GPS, buscador de direcciones y radio de 5 km
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lng, setLng] = useState(DEFAULT_LNG);
  const [direccionTexto, setDireccionTexto] = useState('');
  const [radioBusquedaKm, setRadioBusquedaKm] = useState(5);
  const [consultaDireccion, setConsultaDireccion] = useState('');
  const [resultadosDireccion, setResultadosDireccion] = useState([]);
  const [buscandoDireccion, setBuscandoDireccion] = useState(false);
  const [obteniendoGps, setObteniendoGps] = useState(false);
  const [ubicacionConfirmada, setUbicacionConfirmada] = useState(false);
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);

  // Estado general de validación y envío
  const [errorPaso, setErrorPaso] = useState('');
  const [enviando, setEnviando] = useState(false);

  const edadNumero = edad === '' ? null : Number(edad);
  const esElegibleAlertaRosa =
    genero === 'FEMENINO' || (edadNumero !== null && !Number.isNaN(edadNumero) && edadNumero < 18);

  // Si deja de cumplir la Ley 2326 (ej. hombre adulto), desactiva Alerta Rosa automáticamente
  useEffect(() => {
    if (!esElegibleAlertaRosa && esAlertaRosa) {
      setEsAlertaRosa(false);
    }
  }, [esElegibleAlertaRosa, esAlertaRosa]);

  const validarPaso1 = () => {
    if (nombreDesaparecido.trim().length < 3) {
      setErrorPaso('Ingrese el nombre completo de la persona desaparecida (mínimo 3 caracteres).');
      return false;
    }
    if (
      edad === '' ||
      !Number.isInteger(Number(edad)) ||
      Number(edad) < 0 ||
      Number(edad) > 130
    ) {
      setErrorPaso('Ingrese una edad válida (número entero entre 0 y 130 años).');
      return false;
    }
    if (!fechaHoraUltimoContacto) {
      setErrorPaso('Indique la fecha y hora aproximada del último contacto.');
      return false;
    }
    setErrorPaso('');
    return true;
  };

  const validarPaso2 = () => {
    if (fotografias.length === 0) {
      setErrorPaso('Es obligatorio adjuntar al menos una fotografía reciente');
      return false;
    }
    setErrorPaso('');
    return true;
  };

  const validarPaso3 = () => {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (
      lat === '' ||
      lng === '' ||
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      setErrorPaso('Seleccione una ubicación válida en el mapa o ingrese latitud y longitud válidas.');
      return false;
    }
    if (!ubicacionConfirmada && direccionTexto.trim().length < 3) {
      setErrorPaso(
        'Por favor selecciona un punto en el mapa, busca o escribe la dirección del último contacto, o confirma el punto marcado antes de continuar.'
      );
      return false;
    }
    setErrorPaso('');
    return true;
  };

  const irSiguientePaso = () => {
    if (pasoActual === 1 && !validarPaso1()) return;
    if (pasoActual === 2 && !validarPaso2()) return;
    setPasoActual((p) => Math.min(3, p + 1));
  };

  const irPasoAnterior = () => {
    setErrorPaso('');
    setPasoActual((p) => Math.max(1, p - 1));
  };

  const manejarSeleccionArchivos = async (event) => {
    const archivos = Array.from(event.target.files || []);
    event.target.value = '';
    if (archivos.length === 0) return;

    const cupoDisponible = Math.max(0, 6 - fotografias.length);
    if (cupoDisponible === 0) {
      setErrorPaso('Puede adjuntar un máximo de 6 fotografías por ficha.');
      return;
    }

    setComprimiendoFoto(true);
    setErrorPaso('');

    try {
      const procesadas = [];
      for (const archivo of archivos.slice(0, cupoDisponible)) {
        const comprimida = await comprimirImagen(archivo, {
          maxWidth: 1200,
          quality: 0.8,
        });
        procesadas.push({
          ...comprimida,
          esPrincipal: false,
        });
      }

      setFotografias((previas) => {
        const combinadas = [...previas, ...procesadas];
        if (!combinadas.some((f) => f.esPrincipal) && combinadas.length > 0) {
          combinadas[0] = { ...combinadas[0], esPrincipal: true };
        }
        return combinadas;
      });
    } catch (err) {
      setErrorPaso(err.message || 'No se pudo procesar la fotografía seleccionada.');
    } finally {
      setComprimiendoFoto(false);
    }
  };

  const marcarComoPrincipal = (indice) => {
    setFotografias((previas) =>
      previas.map((foto, idx) => ({
        ...foto,
        esPrincipal: idx === indice,
      }))
    );
  };

  const eliminarFotografia = (indice) => {
    setFotografias((previas) => {
      const restantes = previas.filter((_, idx) => idx !== indice);
      if (restantes.length > 0 && !restantes.some((f) => f.esPrincipal)) {
        restantes[0] = { ...restantes[0], esPrincipal: true };
      }
      return restantes;
    });
  };

  const actualizarUbicacionDesdeMapa = async ({ lat: nuevaLat, lng: nuevaLng }) => {
    setLat(nuevaLat);
    setLng(nuevaLng);
    setUbicacionConfirmada(true);
    setErrorPaso('');
    try {
      const direccionDetectada = await obtenerDireccionPorCoordenadas(nuevaLat, nuevaLng);
      if (direccionDetectada) {
        setDireccionTexto(direccionDetectada);
      }
    } catch {
      // Conservar texto manual si falla geocodificación inversa
    }
  };

  const usarUbicacionGps = () => {
    if (!navigator.geolocation) {
      setErrorPaso('Tu navegador no soporta geolocalización GPS.');
      return;
    }

    setObteniendoGps(true);
    setErrorPaso('');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nuevaLat = Number(pos.coords.latitude.toFixed(6));
        const nuevaLng = Number(pos.coords.longitude.toFixed(6));
        setLat(nuevaLat);
        setLng(nuevaLng);
        setUbicacionConfirmada(true);
        try {
          const direccionDetectada = await obtenerDireccionPorCoordenadas(nuevaLat, nuevaLng);
          setDireccionTexto(direccionDetectada || 'Ubicación obtenida por GPS actual');
        } catch {
          if (!direccionTexto) {
            setDireccionTexto('Ubicación obtenida por GPS actual');
          }
        }
        setObteniendoGps(false);
      },
      (err) => {
        const mensajes = {
          1: 'Permiso de ubicación denegado. Puedes seleccionar el punto manualmente en el mapa.',
          2: 'No fue posible determinar tu ubicación GPS actual.',
          3: 'La solicitud de GPS expiró. Intenta nuevamente o marca el punto en el mapa.',
        };
        setErrorPaso(mensajes[err.code] || 'No se pudo obtener la ubicación GPS.');
        setObteniendoGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const manejarBusquedaDireccion = async (textoOverride = null) => {
    const consulta = String(textoOverride ?? consultaDireccion).trim();
    if (consulta.length < 3) {
      setErrorPaso('Escribe al menos 3 caracteres para buscar una dirección en Colombia.');
      return;
    }

    setBuscandoDireccion(true);
    setErrorPaso('');
    try {
      const resultados = await buscarDireccionColombia(consulta);
      setResultadosDireccion(resultados);
      if (resultados.length === 0) {
        setErrorPaso(
          'No se encontraron coincidencias exactas en el mapa. Puedes guardar la dirección escrita igualmente y ajustar el pin manualmente.'
        );
      } else if (resultados.length === 1) {
        seleccionarResultadoDireccion(resultados[0]);
      }
    } catch (err) {
      setErrorPaso(err.message);
    } finally {
      setBuscandoDireccion(false);
    }
  };

  const seleccionarResultadoDireccion = (item) => {
    setLat(Number(item.lat.toFixed(6)));
    setLng(Number(item.lng.toFixed(6)));
    setDireccionTexto(item.nombre);
    setConsultaDireccion(item.nombre);
    setUbicacionConfirmada(true);
    setResultadosDireccion([]);
    setErrorPaso('');
  };

  const abrirConfirmacion = () => {
    if (!validarPaso1() || !validarPaso2() || !validarPaso3()) {
      return;
    }
    setMostrarConfirmacion(true);
  };

  const publicarFichaConfirmada = async () => {
    if (!validarPaso1() || !validarPaso2() || !validarPaso3()) {
      setMostrarConfirmacion(false);
      return;
    }

    setEnviando(true);
    setErrorPaso('');

    try {
      const payload = {
        nombreDesaparecido: nombreDesaparecido.trim(),
        edad: Number(edad),
        genero,
        fechaHoraUltimoContacto: new Date(fechaHoraUltimoContacto).toISOString(),
        esAlertaRosa: esElegibleAlertaRosa ? esAlertaRosa : false,
        senasParticulares: senasParticulares.trim() || null,
        vestimenta: vestimenta.trim() || null,
        lat: Number(lat),
        lng: Number(lng),
        direccionTexto: direccionTexto.trim() || null,
        radioBusquedaKm: Number(radioBusquedaKm) || 5,
        fotografias: fotografias.map((f) => ({
          base64: f.base64,
          contentType: f.contentType,
          nombreArchivo: f.nombreArchivo,
          esPrincipal: f.esPrincipal,
        })),
      };

      const respuesta = await crearFichaBusqueda(payload);
      setMostrarConfirmacion(false);
      onCreada?.(respuesta.ficha);
    } catch (err) {
      setMostrarConfirmacion(false);
      setErrorPaso(err.message || 'No fue posible registrar la ficha de búsqueda.');
    } finally {
      setEnviando(false);
    }
  };

  const porcentajeProgreso = (pasoActual / PASOS.length) * 100;

  return (
    <form className="tarjeta" onSubmit={(e) => e.preventDefault()} noValidate>
      {/* Indicador de progreso de 3 pasos en CSS puro */}
      <nav className="stepper" aria-label="Progreso del formulario">
        <div className="stepper__barra" aria-hidden="true">
          <div
            className={`stepper__progreso ${esAlertaRosa ? 'stepper__progreso--rosa' : ''}`}
            style={{ width: `${porcentajeProgreso}%` }}
          />
        </div>
        <ol className="stepper__lista">
          {PASOS.map((paso) => {
            const completado = paso.numero < pasoActual;
            const activo = paso.numero === pasoActual;
            return (
              <li
                key={paso.numero}
                className={`stepper__item ${
                  activo ? 'stepper__item--activo' : completado ? 'stepper__item--completado' : ''
                }`}
                aria-current={activo ? 'step' : undefined}
              >
                <span className="stepper__circulo">{completado ? '✓' : paso.numero}</span>
                <span>{paso.titulo}</span>
              </li>
            );
          })}
        </ol>
      </nav>



      {/*{errorPaso && (
        <div className="aviso aviso--error" role="alert">
          {errorPaso}
        </div>
      )}*/}

        {errorPaso && (
        <div
          className="modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="titulo-modal-error"
          onClick={() => setErrorPaso('')}
        >
          <div className="modal modal--error" onClick={(e) => e.stopPropagation()}>
            <h3 id="titulo-modal-error" className="modal__titulo-error">
              Verifica la información
            </h3>
            <p className="modal__mensaje-error">{errorPaso}</p>
            <div className="modal__acciones">
              <button
                type="button"
                className="btn btn--peligro"
                onClick={() => setErrorPaso('')}
                autoFocus
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PASO 1: Datos básicos y Alerta Rosa */}
      {pasoActual === 1 && (
        <section aria-label="Paso 1: Datos básicos">
          <h2 style={{ marginTop: 0, color: 'var(--color-primario)' }}>
            Paso 1: Datos básicos de la persona desaparecida
          </h2>

          <div className="campo">
            <label htmlFor="nombreDesaparecido" className="campo__label">
              Nombre completo *
            </label>
            <input
              id="nombreDesaparecido"
              type="text"
              className="campo__input"
              placeholder="Ej. María Fernanda Gómez Rodríguez"
              value={nombreDesaparecido}
              onChange={(e) => setNombreDesaparecido(e.target.value)}
              required
            />
          </div>

          <div className="grid-campos">
            <div className="campo">
              <label htmlFor="edad" className="campo__label">
                Edad (años) *
              </label>
              <input
                id="edad"
                type="number"
                min="0"
                max="130"
                step="1"
                className="campo__input"
                placeholder="Ej. 16"
                value={edad}
                onChange={(e) => setEdad(e.target.value)}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="genero" className="campo__label">
                Género *
              </label>
              <select
                id="genero"
                className="campo__select"
                value={genero}
                onChange={(e) => setGenero(e.target.value)}
              >
                <option value="FEMENINO">Femenino (Mujer / Niña)</option>
                <option value="MASCULINO">Masculino (Hombre / Niño)</option>
                <option value="NO_BINARIO">No binario</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
          </div>

          <div className="campo">
            <label htmlFor="fechaHoraUltimoContacto" className="campo__label">
              Fecha y hora del último contacto *
            </label>
            <input
              id="fechaHoraUltimoContacto"
              type="datetime-local"
              className="campo__input"
              value={fechaHoraUltimoContacto}
              max={obtenerFechaHoraLocalActual()}
              onChange={(e) => setFechaHoraUltimoContacto(e.target.value)}
              required
            />
          </div>

          {/* Casilla Alerta Rosa (Ley 2326 de 2023) */}
          <div
            className={`caja-alerta-rosa ${
              !esElegibleAlertaRosa ? 'caja-alerta-rosa--deshabilitada' : ''
            }`}
          >
            <label className="caja-alerta-rosa__check">
              <input
                type="checkbox"
                checked={esAlertaRosa}
                disabled={!esElegibleAlertaRosa}
                onChange={(e) => setEsAlertaRosa(e.target.checked)}
              />
              <div>
                <strong
                  style={{
                    color: esElegibleAlertaRosa ? 'var(--color-rosa)' : 'var(--color-texto-secundario)',
                  }}
                >
                  Activar Alerta Rosa (Ley 2326 de 2023)
                </strong>
                {esElegibleAlertaRosa ? (
                  <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-xs)' }}>
                    Esta ficha cumple los criterios de la Ley 2326 (mujer o menor de 18 años) y se
                    difundirá con prioridad máxima y distintivo visual en la plataforma.
                  </p>
                ) : (
                  <p
                    style={{
                      margin: '0.25rem 0 0',
                      fontSize: 'var(--tam-xs)',
                      color: 'var(--color-texto-secundario)',
                    }}
                  >
                    No disponible para esta ficha: conforme a la <strong>Ley 2326 de 2023</strong>,
                    la Alerta Rosa aplica exclusivamente para mujeres o personas menores de 18 años.
                  </p>
                )}
              </div>
            </label>
          </div>
        </section>
      )}

      {/* PASO 2: Fotografías, señas particulares y vestimenta */}
      {pasoActual === 2 && (
        <section aria-label="Paso 2: Fotografías y descripción física">
          <h2 style={{ marginTop: 0, color: 'var(--color-primario)' }}>
            Paso 2: Fotografías recientes y rasgos físicos
          </h2>

          <div className="campo">
            <label htmlFor="inputFotografias" className="campo__label">
              Fotografías recientes * (mínimo 1, máximo 6)
            </label>
            <input
              id="inputFotografias"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="campo__input"
              onChange={manejarSeleccionArchivos}
              disabled={comprimiendoFoto || fotografias.length >= 6}
            />
            <span className="campo__ayuda">
              Las imágenes se comprimen automáticamente en tu dispositivo (máx. 1200px, calidad 80%)
              para subirlas más rápido en redes móviles.
            </span>
          </div>

          {comprimiendoFoto && (
            <div className="aviso aviso--info">Optimizando fotografía en tu navegador...</div>
          )}

          {fotografias.length > 0 && (
            <div className="grid-fotos">
              {fotografias.map((foto, idx) => (
                <div
                  key={`${foto.nombreArchivo}-${idx}`}
                  className={`foto-preview ${foto.esPrincipal ? 'foto-preview--principal' : ''}`}
                >
                  <img
                    src={foto.base64}
                    alt={`Fotografía ${idx + 1} de la persona desaparecida`}
                    className="foto-preview__img"
                  />
                  <div className="foto-preview__info">
                    <strong>{foto.esPrincipal ? 'Foto principal' : `Foto #${idx + 1}`}</strong>
                    <span>
                      {formatearTamanoBytes(foto.tamanoOriginalBytes)} →{' '}
                      {formatearTamanoBytes(foto.tamanoComprimidoBytes)}
                    </span>
                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {!foto.esPrincipal && (
                        <button
                          type="button"
                          className="btn btn--secundario btn--pequeno"
                          onClick={() => marcarComoPrincipal(idx)}
                        >
                          Principal
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--peligro btn--pequeno"
                        onClick={() => eliminarFotografia(idx)}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="campo" style={{ marginTop: 'var(--esp-4)' }}>
            <label htmlFor="senasParticulares" className="campo__label">
              Señas particulares
            </label>
            <textarea
              id="senasParticulares"
              rows={3}
              className="campo__textarea"
              placeholder="Cicatrices, tatuajes, lunares, estatura aproximada, color de cabello u ojos..."
              value={senasParticulares}
              onChange={(e) => setSenasParticulares(e.target.value)}
            />
          </div>

          <div className="campo">
            <label htmlFor="vestimenta" className="campo__label">
              Vestimenta al momento de la desaparición
            </label>
            <textarea
              id="vestimenta"
              rows={2}
              className="campo__textarea"
              placeholder="Ej. Chaqueta azul oscuro, pantalón jean y tenis blancos..."
              value={vestimenta}
              onChange={(e) => setVestimenta(e.target.value)}
            />
          </div>
        </section>
      )}

      {/* PASO 3: Ubicación, GPS, búsqueda de dirección y radio de 5 km */}
      {pasoActual === 3 && (
        <section aria-label="Paso 3: Ubicación del último contacto">
          <h2 style={{ marginTop: 0, color: 'var(--color-primario)' }}>
            Paso 3: Ubicación del último contacto y radio de búsqueda
          </h2>

          <div
            className={`aviso ${ubicacionConfirmada ? 'aviso--exito' : 'aviso--info'}`}
            style={{ marginBottom: 'var(--esp-3)' }}
          >
            {ubicacionConfirmada ? (
              <span>
                <strong>✓ Ubicación seleccionada:</strong>{' '}
                {direccionTexto || `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`} (
                {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}).
              </span>
            ) : (
              <span>
                <strong>Elige la ubicación del último contacto:</strong> escribe una dirección o
                municipio y presiona <em>Buscar en mapa</em>, haz clic o arrastra el pin en el mapa,
                usa tu GPS o confirma las coordenadas manualmente.
              </span>
            )}
          </div>

          <div className="buscador-direccion">
            <input
              type="text"
              className="campo__input"
              placeholder="Buscar dirección, barrio o municipio en Colombia (ej. Parque Berrío, Medellín)..."
              value={consultaDireccion}
              onChange={(e) => setConsultaDireccion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  manejarBusquedaDireccion();
                }
              }}
            />
            <button
              type="button"
              className="btn btn--primario"
              onClick={() => manejarBusquedaDireccion()}
              disabled={buscandoDireccion}
            >
              {buscandoDireccion ? 'Buscando...' : 'Buscar en mapa'}
            </button>
            <button
              type="button"
              className="btn btn--secundario"
              onClick={usarUbicacionGps}
              disabled={obteniendoGps}
            >
              {obteniendoGps ? 'Obteniendo GPS...' : 'Usar mi GPS actual'}
            </button>
          </div>

          {resultadosDireccion.length > 0 && (
            <ul className="resultados-direccion" aria-label="Resultados de direcciones">
              {resultadosDireccion.map((item) => (
                <li key={item.id} className="resultados-direccion__item">
                  <button type="button" onClick={() => seleccionarResultadoDireccion(item)}>
                    {item.nombre}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid-campos">
            <div className="campo">
              <label htmlFor="direccionTexto" className="campo__label">
                Dirección o referencia por escrito *
              </label>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <input
                  id="direccionTexto"
                  type="text"
                  className="campo__input"
                  placeholder="Ej. Calle 45 # 12-30, Barrio Chapinero, Bogotá"
                  value={direccionTexto}
                  onChange={(e) => {
                    setDireccionTexto(e.target.value);
                    if (e.target.value.trim().length >= 3) {
                      setUbicacionConfirmada(true);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn--secundario btn--pequeno"
                  disabled={buscandoDireccion || direccionTexto.trim().length < 3}
                  onClick={() => manejarBusquedaDireccion(direccionTexto)}
                  title="Centrar el pin del mapa en la dirección escrita"
                >
                  Ubicar pin
                </button>
              </div>
              <span className="campo__ayuda">
                Puedes escribir la dirección libremente y opcionalmente presionar "Ubicar pin" para
                mover el mapa allí.
              </span>
            </div>

            <div className="campo">
              <label htmlFor="radioBusquedaKm" className="campo__label">
                Radio de búsqueda inicial: <strong>{radioBusquedaKm} km</strong>
              </label>
              <input
                id="radioBusquedaKm"
                type="range"
                min="1"
                max="50"
                step="1"
                value={radioBusquedaKm}
                onChange={(e) => setRadioBusquedaKm(Number(e.target.value))}
              />
              <span className="campo__ayuda">
                Estándar recomendado: 5 km alrededor del último contacto.
              </span>
            </div>
          </div>

          <div className="grid-campos">
            <div className="campo">
              <label htmlFor="latManual" className="campo__label">
                Latitud (editable o elige en el mapa) *
              </label>
              <input
                id="latManual"
                type="number"
                step="0.000001"
                min="-90"
                max="90"
                className="campo__input"
                value={lat}
                onChange={(e) => {
                  const val = e.target.value;
                  setLat(val === '' ? '' : Number(val));
                  setUbicacionConfirmada(true);
                }}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="lngManual" className="campo__label">
                Longitud (editable o elige en el mapa) *
              </label>
              <input
                id="lngManual"
                type="number"
                step="0.000001"
                min="-180"
                max="180"
                className="campo__input"
                value={lng}
                onChange={(e) => {
                  const val = e.target.value;
                  setLng(val === '' ? '' : Number(val));
                  setUbicacionConfirmada(true);
                }}
                required
              />
            </div>
          </div>

          {!ubicacionConfirmada && (
            <label
              className="mapa-toggle"
              style={{ marginBottom: 'var(--esp-3)', fontSize: 'var(--tam-sm)' }}
            >
              <input
                type="checkbox"
                checked={ubicacionConfirmada}
                onChange={(e) => setUbicacionConfirmada(e.target.checked)}
              />
              <span>Confirmo que el último contacto ocurrió en el punto actualmente marcado en el mapa</span>
            </label>
          )}

          <MapaInteractivo
            lat={Number(lat) || DEFAULT_LAT}
            lng={Number(lng) || DEFAULT_LNG}
            radioKm={radioBusquedaKm}
            esAlertaRosa={esElegibleAlertaRosa && esAlertaRosa}
            direccionTexto={direccionTexto}
            seleccionable
            onSeleccionarUbicacion={actualizarUbicacionDesdeMapa}
          />
        </section>
      )}

      {/* Botonera de navegación del stepper (con keys distintas y sin submit implícito) */}
      <div className="formulario-acciones">
        <div>
          {pasoActual > 1 && (
            <button
              key="btn-paso-anterior"
              type="button"
              className="btn btn--secundario"
              onClick={irPasoAnterior}
              disabled={enviando}
            >
              ← Anterior
            </button>
          )}
        </div>

        <div>
          {pasoActual < 3 ? (
            <button
              key="btn-siguiente-paso"
              type="button"
              className={`btn ${esAlertaRosa ? 'btn--rosa' : 'btn--primario'}`}
              onClick={irSiguientePaso}
              disabled={comprimiendoFoto}
            >
              Siguiente paso →
            </button>
          ) : (
            <button
              key="btn-revisar-publicar"
              type="button"
              className={`btn ${esAlertaRosa ? 'btn--rosa' : 'btn--primario'}`}
              onClick={abrirConfirmacion}
              disabled={enviando}
            >
              {esAlertaRosa
                ? 'Revisar y confirmar Alerta Rosa'
                : 'Revisar y confirmar publicación'}
            </button>
          )}
        </div>
      </div>

      {/* Modal de confirmación explícita antes de publicar la ficha */}
      {mostrarConfirmacion && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmacion-ficha"
          onClick={() => !enviando && setMostrarConfirmacion(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2
              id="titulo-confirmacion-ficha"
              style={{ marginTop: 0, color: 'var(--color-primario)' }}
            >
              Confirmar publicación de la ficha
            </h2>
            <p style={{ marginTop: 0, fontSize: 'var(--tam-sm)', color: 'var(--color-texto-secundario)' }}>
              Verifica que los datos y la ubicación sean correctos antes de activar la alerta y la
              difusión en el radio de búsqueda:
            </p>

            <dl className="lista-datos" style={{ margin: 'var(--esp-3) 0' }}>
              <div className="lista-datos__item">
                <dt>Persona desaparecida</dt>
                <dd>
                  <strong>{nombreDesaparecido}</strong> ({edad} años · {genero})
                </dd>
              </div>
              <div className="lista-datos__item">
                <dt>Prioridad</dt>
                <dd>
                  {esElegibleAlertaRosa && esAlertaRosa ? (
                    <span className="badge badge--alerta-rosa">Alerta Rosa · Ley 2326</span>
                  ) : (
                    <span className="badge badge--activa">Alerta estándar</span>
                  )}
                </dd>
              </div>
              <div className="lista-datos__item" style={{ gridColumn: '1 / -1' }}>
                <dt>Dirección registrada</dt>
                <dd>{direccionTexto.trim() || 'Sin dirección escrita (solo coordenadas)'}</dd>
              </div>
              <div className="lista-datos__item">
                <dt>Coordenadas</dt>
                <dd>
                  {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
                </dd>
              </div>
              <div className="lista-datos__item">
                <dt>Radio / Fotos</dt>
                <dd>
                  {radioBusquedaKm} km · {fotografias.length} foto(s)
                </dd>
              </div>
            </dl>

            <div className="aviso aviso--advertencia" style={{ margin: 'var(--esp-3) 0' }}>
              <strong>Publicación temporal (1 día hábil):</strong> la alerta se activará de
              inmediato para no perder tiempo de búsqueda, pero permanecerá temporal hasta que
              completes el <strong>formato SIRDEC obligatorio</strong> en un plazo máximo de{' '}
              <strong>1 día hábil</strong> (si vence el plazo, se suspenderá del listado público
              hasta completarlo).
            </div>

            <div className="modal__acciones">
              <button
                type="button"
                className="btn btn--secundario"
                disabled={enviando}
                onClick={() => setMostrarConfirmacion(false)}
              >
                Volver a editar
              </button>
              <button
                type="button"
                className={`btn ${esAlertaRosa ? 'btn--rosa' : 'btn--primario'}`}
                disabled={enviando}
                onClick={publicarFichaConfirmada}
              >
                {enviando ? 'Publicando ficha...' : 'Sí, confirmar y publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
