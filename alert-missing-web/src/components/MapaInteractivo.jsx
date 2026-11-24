import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { obtenerPuntosApoyoCercanos } from '../api-client/alertaApi.js';

const DEFAULT_TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function crearIconoDiv(clase, texto, tamano = 30) {
  return L.divIcon({
    className: '',
    html: `<div class="marcador-mapa ${clase}" style="width:${tamano}px;height:${tamano}px;">${texto}</div>`,
    iconSize: [tamano, tamano],
    iconAnchor: [tamano / 2, tamano / 2],
    popupAnchor: [0, -(tamano / 2)],
  });
}

function escaparHtml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function MapaInteractivo({
  lat,
  lng,
  radioKm = 5,
  esAlertaRosa = false,
  direccionTexto = '',
  seleccionable = false,
  onSeleccionarUbicacion = null,
  mostrarControlPuntosApoyo = true,
  puntosApoyoInicial = false,
  tituloMarcador = 'Último punto de contacto',
  avistamientosAprobados = [],
  altura = null,
}) {
  const contenedorRef = useRef(null);
  const mapaRef = useRef(null);
  const marcadorRef = useRef(null);
  const circuloRef = useRef(null);
  const capaPuntosRef = useRef(null);
  const capaAvistamientosRef = useRef(null);
  const onSeleccionRef = useRef(onSeleccionarUbicacion);

  const [capaPuntosActiva, setCapaPuntosActiva] = useState(puntosApoyoInicial);
  const [cargandoPuntos, setCargandoPuntos] = useState(false);
  const [errorPuntos, setErrorPuntos] = useState(null);
  const [infoPuntos, setInfoPuntos] = useState(null);

  const [errorMapa, setErrorMapa] = useState(false);
  const [intentoMapa, setIntentoMapa] = useState(0);

  onSeleccionRef.current = onSeleccionarUbicacion;

  // Inicializar instancia Leaflet y tiles de OpenStreetMap con detección de fallos
  useEffect(() => {
    if (!contenedorRef.current) return undefined;

    setErrorMapa(false);
    let erroresConsecutivos = 0;
    let tilesCargados = 0;

    const map = L.map(contenedorRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: true,
    });

    const tileLayer = L.tileLayer(DEFAULT_TILE_URL, {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });

    tileLayer.on('tileload', () => {
      tilesCargados += 1;
      erroresConsecutivos = 0;
      setErrorMapa(false);
    });

    tileLayer.on('tileerror', () => {
      erroresConsecutivos += 1;
      if (tilesCargados === 0 && erroresConsecutivos >= 2) {
        setErrorMapa(true);
      }
    });

    tileLayer.addTo(map);

    const iconoPrincipal = crearIconoDiv(
      `${esAlertaRosa ? 'marcador-mapa--rosa' : 'marcador-mapa--alerta'}${
        seleccionable ? ' marcador-mapa--arrastrable' : ''
      }`,
      esAlertaRosa ? 'AR' : 'U',
      34
    );

    const marcador = L.marker([lat, lng], {
      draggable: seleccionable,
      autoPan: seleccionable,
      zIndexOffset: 1000,
      icon: iconoPrincipal,
    }).addTo(map);

    if (!seleccionable) {
      marcador.bindPopup(
        `<strong>${escaparHtml(tituloMarcador)}</strong><br/>${
          direccionTexto ? escaparHtml(direccionTexto) : `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        }`
      );
    }

    const colorCirculo = esAlertaRosa ? '#c2185b' : '#1d4ed8';
    const rellenoCirculo = esAlertaRosa ? '#f48fb1' : '#60a5fa';

    const circulo = L.circle([lat, lng], {
      radius: Number(radioKm) * 1000,
      interactive: false,
      color: colorCirculo,
      weight: esAlertaRosa ? 3 : 2,
      dashArray: esAlertaRosa ? '8 4' : null,
      fillColor: rellenoCirculo,
      fillOpacity: esAlertaRosa ? 0.24 : 0.16,
    }).addTo(map);

    const capaPuntos = L.layerGroup().addTo(map);
    const capaAvistamientos = L.layerGroup().addTo(map);

    if (seleccionable) {
      map.on('click', (event) => {
        const { lat: nuevaLat, lng: nuevaLng } = event.latlng;
        marcador.setLatLng([nuevaLat, nuevaLng]);
        circulo.setLatLng([nuevaLat, nuevaLng]);
        onSeleccionRef.current?.({
          lat: Number(nuevaLat.toFixed(6)),
          lng: Number(nuevaLng.toFixed(6)),
        });
      });

      marcador.on('drag', () => {
        const pos = marcador.getLatLng();
        circulo.setLatLng(pos);
      });

      marcador.on('dragend', () => {
        const pos = marcador.getLatLng();
        circulo.setLatLng(pos);
        onSeleccionRef.current?.({
          lat: Number(pos.lat.toFixed(6)),
          lng: Number(pos.lng.toFixed(6)),
        });
      });
    }

    mapaRef.current = map;
    marcadorRef.current = marcador;
    circuloRef.current = circulo;
    capaPuntosRef.current = capaPuntos;
    capaAvistamientosRef.current = capaAvistamientos;

    // Recalcular tamaño cuando el mapa se monta dentro de un paso o modal
    const timerTamano = setTimeout(() => {
      map.invalidateSize();
    }, 120);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMapa(true);
    }

    return () => {
      clearTimeout(timerTamano);
      map.remove();
      mapaRef.current = null;
      marcadorRef.current = null;
      circuloRef.current = null;
      capaPuntosRef.current = null;
      capaAvistamientosRef.current = null;
    };
  }, [intentoMapa, seleccionable]);

  // Dibujar avistamientos aprobados en el mapa
  useEffect(() => {
    const capa = capaAvistamientosRef.current;
    if (!capa) return;

    capa.clearLayers();
    for (const av of avistamientosAprobados || []) {
      const avLat = av?.coordenadas?.lat;
      const avLng = av?.coordenadas?.lng;
      if (avLat === undefined || avLng === undefined) continue;

      const icono = crearIconoDiv('marcador-mapa--avistamiento', 'A', 28);
      const fechaTexto = av.fechaHora
        ? new Date(av.fechaHora).toLocaleString('es-CO')
        : 'Sin fecha';

      const popupHtml = [
        '<strong>Avistamiento confirmado</strong>',
        `<span>${escaparHtml(fechaTexto)}</span>`,
        `<span>${escaparHtml(av.descripcion)}</span>`,
        av.urlEvidencia
          ? `<a href="${escaparHtml(av.urlEvidencia)}" target="_blank" rel="noreferrer">Ver evidencia fotográfica</a>`
          : null,
      ]
        .filter(Boolean)
        .join('<br/>');

      L.marker([avLat, avLng], { icon: icono }).bindPopup(popupHtml).addTo(capa);
    }
  }, [avistamientosAprobados, intentoMapa]);

  // Actualizar posición y radio sin recrear el icono (evita perder el arrastre del pin en Leaflet)
  useEffect(() => {
    const map = mapaRef.current;
    const marcador = marcadorRef.current;
    const circulo = circuloRef.current;
    if (!map || !marcador || !circulo) return;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return;

    const nuevaPos = [latNum, lngNum];
    marcador.setLatLng(nuevaPos);

    if (!seleccionable) {
      marcador.setPopupContent(
        `<strong>${escaparHtml(tituloMarcador)}</strong><br/>${
          direccionTexto
            ? escaparHtml(direccionTexto)
            : `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`
        }`
      );
    }

    const colorCirculo = esAlertaRosa ? '#c2185b' : '#1d4ed8';
    const rellenoCirculo = esAlertaRosa ? '#f48fb1' : '#60a5fa';

    circulo.setLatLng(nuevaPos);
    circulo.setRadius(Number(radioKm) * 1000);
    circulo.setStyle({
      color: colorCirculo,
      weight: esAlertaRosa ? 3 : 2,
      dashArray: esAlertaRosa ? '8 4' : null,
      fillColor: rellenoCirculo,
      fillOpacity: esAlertaRosa ? 0.24 : 0.16,
    });

    map.panTo(nuevaPos, { animate: true });
  }, [lat, lng, radioKm, esAlertaRosa, direccionTexto, tituloMarcador, seleccionable]);

  // Actualizar el icono solo si cambia Alerta Rosa y re-habilitar arrastre si es seleccionable
  useEffect(() => {
    const marcador = marcadorRef.current;
    if (!marcador) return;

    marcador.setIcon(
      crearIconoDiv(
        `${esAlertaRosa ? 'marcador-mapa--rosa' : 'marcador-mapa--alerta'}${
          seleccionable ? ' marcador-mapa--arrastrable' : ''
        }`,
        esAlertaRosa ? 'AR' : 'U',
        34
      )
    );

    if (seleccionable && marcador.dragging) {
      marcador.dragging.enable();
    }
  }, [esAlertaRosa, seleccionable]);

  // Consultar y dibujar Puntos de Apoyo (Policía, CAI, Hospitales) en tiempo real
  const cargarPuntosApoyo = useCallback(
    async (signal) => {
      if (!capaPuntosActiva) {
        capaPuntosRef.current?.clearLayers();
        setInfoPuntos(null);
        setErrorPuntos(null);
        return;
      }

      setCargandoPuntos(true);
      setErrorPuntos(null);

      try {
        const data = await obtenerPuntosApoyoCercanos(
          { lat, lng, radioKm: Number(radioKm) || 5, tipo: 'TODOS' },
          signal
        );

        setInfoPuntos(data);

        const capa = capaPuntosRef.current;
        if (capa) {
          capa.clearLayers();
          for (const punto of data.puntos || []) {
            const esPolicia = punto.tipo === 'POLICIA';
            const icono = crearIconoDiv(
              esPolicia ? 'marcador-mapa--policia' : 'marcador-mapa--salud',
              esPolicia ? 'P' : 'H',
              28
            );

            const detallePopup = [
              `<strong>${escaparHtml(punto.nombre)}</strong>`,
              `<span>${esPolicia ? 'Policía / CAI' : 'Centro de Salud / Hospital'}</span>`,
              punto.distanciaKm !== null ? `<span>Distancia: ${punto.distanciaKm} km</span>` : null,
              punto.direccion ? `<span>${escaparHtml(punto.direccion)}</span>` : null,
              punto.telefono ? `<span>Tel: ${escaparHtml(punto.telefono)}</span>` : null,
            ]
              .filter(Boolean)
              .join('<br/>');

            L.marker([punto.lat, punto.lng], { icon: icono })
              .bindPopup(detallePopup)
              .addTo(capa);
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setErrorPuntos(err.message || 'No se pudieron consultar los puntos de apoyo cercanos.');
        }
      } finally {
        setCargandoPuntos(false);
      }
    },
    [capaPuntosActiva, lat, lng, radioKm]
  );

  useEffect(() => {
    const controller = new AbortController();
    cargarPuntosApoyo(controller.signal);
    return () => controller.abort();
  }, [cargarPuntosApoyo, intentoMapa]);

  const reintentarMapa = () => {
    setErrorMapa(false);
    setIntentoMapa((n) => n + 1);
  };

  return (
    <div className={`mapa-contenedor ${esAlertaRosa ? 'mapa-contenedor--rosa' : ''}`}>
      <div className="mapa-toolbar">
        <div>
          <strong>Radio de búsqueda: {radioKm} km</strong>
          {esAlertaRosa && (
            <span className="badge badge--alerta-rosa" style={{ marginLeft: '0.5rem' }}>
              Alerta Rosa
            </span>
          )}
        </div>

        {mostrarControlPuntosApoyo && (
          <label className="mapa-toggle">
            <input
              type="checkbox"
              checked={capaPuntosActiva}
              onChange={(e) => setCapaPuntosActiva(e.target.checked)}
            />
            <span>Puntos de Apoyo (Policía, CAI y Hospitales)</span>
          </label>
        )}
      </div>

      {cargandoPuntos && (
        <div className="aviso aviso--info" style={{ margin: 0, borderRadius: 0 }}>
          Consultando estaciones de policía, CAI y centros médicos cercanos en tiempo real...
        </div>
      )}

      {errorPuntos && (
        <div className="aviso aviso--advertencia" style={{ margin: 0, borderRadius: 0 }}>
          {errorPuntos}
        </div>
      )}

      {capaPuntosActiva && infoPuntos?.busquedaAmpliadaRural && (
        <div className="aviso aviso--info" style={{ margin: 0, borderRadius: 0 }}>
          Zona con baja densidad: se amplió el radio de búsqueda a{' '}
          <strong>{infoPuntos.radioAplicadoKm} km</strong> para ubicar la estación municipal o
          centro médico más cercano ({infoPuntos.total} puntos encontrados).
        </div>
      )}

      {errorMapa ? (
        <div className="mapa-fallback" role="alert">
          <div>
            <strong>No se pudo cargar el mapa de OpenStreetMap.</strong>
            <p style={{ margin: '0.35rem 0 0', fontSize: 'var(--tam-sm)' }}>
              Dirección registrada:{' '}
              <strong>
                {direccionTexto || 'Sin dirección en texto registrada'}
              </strong>
            </p>
            <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-xs)' }}>
              Coordenadas: {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)} · Radio de búsqueda:{' '}
              {radioKm} km
            </p>
          </div>
          <div>
            <button type="button" className="btn btn--primario" onClick={reintentarMapa}>
              Reintentar cargar mapa
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={contenedorRef}
          className="mapa-canvas"
          style={altura ? { height: altura } : undefined}
          aria-label="Mapa interactivo de ubicación y radio de búsqueda"
        />
      )}

      <div className="mapa-leyenda">
        <span className="mapa-leyenda__item">
          <span
            className="mapa-leyenda__punto"
            style={{ backgroundColor: esAlertaRosa ? 'var(--color-rosa)' : 'var(--color-acento)' }}
          />
          {esAlertaRosa ? 'Último contacto (Alerta Rosa)' : 'Último contacto'}
        </span>
        {avistamientosAprobados.length > 0 && (
          <span className="mapa-leyenda__item">
            <span
              className="mapa-leyenda__punto"
              style={{ backgroundColor: '#d97706' }}
            />
            Avistamientos confirmados ({avistamientosAprobados.length})
          </span>
        )}
        {capaPuntosActiva && (
          <>
            <span className="mapa-leyenda__item">
              <span
                className="mapa-leyenda__punto"
                style={{ backgroundColor: 'var(--color-policia)' }}
              />
              Policía / CAI ({infoPuntos?.policia?.length ?? 0})
            </span>
            <span className="mapa-leyenda__item">
              <span
                className="mapa-leyenda__punto"
                style={{ backgroundColor: 'var(--color-salud)' }}
              />
              Hospitales / Clínicas ({infoPuntos?.salud?.length ?? 0})
            </span>
          </>
        )}
        {seleccionable && (
          <span className="mapa-leyenda__item">
            Haz clic en el mapa o arrastra el marcador para ajustar el punto.
          </span>
        )}
      </div>
    </div>
  );
}
