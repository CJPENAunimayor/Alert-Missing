import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarAlertasActivas } from '../api-client/alertaApi.js';
import { BannerPermisosColaboracion } from '../components/BannerPermisosColaboracion.jsx';

function formatearTiempoRelativo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.max(1, Math.floor(diffMs / 60000));
  if (min < 60) return `Hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `Hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `Hace ${dias} d`;
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(iso));
}

export function AlertasPage() {
  const [alertas, setAlertas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [soloAlertaRosa, setSoloAlertaRosa] = useState(false);
  const [genero, setGenero] = useState('');
  const [fotosConError, setFotosConError] = useState(() => new Set());

  useEffect(() => {
    const controller = new AbortController();

    async function cargar() {
      setCargando(true);
      setError('');
      try {
        const data = await listarAlertasActivas(
          {
            busqueda: busqueda.trim() || undefined,
            esAlertaRosa: soloAlertaRosa ? 'true' : undefined,
            genero: genero || undefined,
          },
          controller.signal
        );
        setAlertas(data.alertas || []);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'No se pudieron cargar las alertas activas.');
        }
      } finally {
        setCargando(false);
      }
    }

    cargar();
    return () => controller.abort();
  }, [busqueda, soloAlertaRosa, genero]);

  // Garantiza que las Alertas Rosa siempre encabecen el listado
  const alertasOrdenadas = useMemo(() => {
    return [...alertas].sort((a, b) => {
      const diffRosa = Number(Boolean(b.esAlertaRosa)) - Number(Boolean(a.esAlertaRosa));
      if (diffRosa !== 0) return diffRosa;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [alertas]);

  return (
    <div className="contenedor">
      <div className="pagina-header">
        <div>
          <h1 className="pagina-header__titulo">
            Alertas Activas {!cargando && `(${alertasOrdenadas.length})`}
          </h1>
          <p className="pagina-header__subtitulo">
            Las fichas con <strong>Alerta Rosa (Ley 2326)</strong> aparecen priorizadas al inicio.
          </p>
        </div>

        <BannerPermisosColaboracion />
      </div>

      {/* Barra unificada de búsqueda y filtros rápidos */}
      <section className="toolbar-alertas" aria-label="Buscar y filtrar alertas">
        <div className="toolbar-alertas__busqueda">
          <input
            id="filtroBusqueda"
            type="search"
            className="campo__input"
            placeholder="Buscar por nombre, barrio, municipio o seña..."
            aria-label="Buscar por nombre, barrio, municipio o seña"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <div className="toolbar-alertas__pills">
          <button
            type="button"
            className={`filtro-pill ${!soloAlertaRosa ? 'filtro-pill--activo' : ''}`}
            onClick={() => setSoloAlertaRosa(false)}
          >
            Todas
          </button>

          <button
            type="button"
            className={`filtro-pill ${soloAlertaRosa ? 'filtro-pill--rosa-activo' : ''}`}
            onClick={() => setSoloAlertaRosa(true)}
          >
            Alerta Rosa
          </button>

          <select
            id="filtroGenero"
            className="campo__select"
            style={{ width: 'auto', padding: '0.38rem 0.7rem', fontSize: 'var(--tam-xs)' }}
            aria-label="Filtrar por género"
            value={genero}
            onChange={(e) => setGenero(e.target.value)}
          >
            <option value="">Género: Todos</option>
            <option value="FEMENINO">Femenino</option>
            <option value="MASCULINO">Masculino</option>
            <option value="NO_BINARIO">No binario</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
      </section>

      {error && (
        <div className="aviso aviso--error" role="alert">
          {error}
        </div>
      )}

      {cargando ? (
        <div className="estado-vacio">Cargando alertas activas...</div>
      ) : alertasOrdenadas.length === 0 ? (
        <div className="estado-vacio">
          <h2 className="estado-vacio__titulo">No hay alertas que coincidan</h2>
          <p style={{ margin: '0 0 var(--esp-4)', fontSize: 'var(--tam-sm)' }}>
            Prueba limpiando los filtros o registra una nueva ficha de búsqueda.
          </p>
          <Link to="/alertas/nueva" className="btn btn--rosa">
            + Reportar desaparición
          </Link>
        </div>
      ) : (
        <div className="grid-alertas">
          {alertasOrdenadas.map((alerta) => {
            const fotoPrincipal =
              alerta.fotografias?.find((f) => f.esPrincipal)?.url ||
              alerta.fotografias?.[0]?.url ||
              null;

            return (
              <Link
                key={alerta.id}
                to={`/alertas/${alerta.id}`}
                className={`alerta-card ${alerta.esAlertaRosa ? 'alerta-card--rosa' : ''}`}
              >
                <div className="alerta-card__media">
                  {fotoPrincipal && !fotosConError.has(alerta.id) ? (
                    <img
                      src={fotoPrincipal}
                      alt={`Fotografía de ${alerta.nombreDesaparecido}`}
                      className="alerta-card__imagen"
                      loading="lazy"
                      onError={() =>
                        setFotosConError((prev) => new Set(prev).add(alerta.id))
                      }
                    />
                  ) : (
                    <div className="alerta-card__sin-foto">Sin fotografía disponible</div>
                  )}

                  {alerta.esAlertaRosa && (
                    <div className="alerta-card__insignias">
                      <span className="badge badge--alerta-rosa">Alerta Rosa</span>
                    </div>
                  )}
                </div>

                <div className="alerta-card__cuerpo">
                  <h2 className="alerta-card__nombre">{alerta.nombreDesaparecido}</h2>
                  <p className="alerta-card__sub">
                    {alerta.edad} años · {alerta.genero}
                  </p>
                  <p className="alerta-card__zona">
                    {alerta.direccionTexto || 'Ubicación georreferenciada'} · Radio{' '}
                    {alerta.radioBusquedaKm} km
                  </p>

                  <div className="alerta-card__pie">
                    <span>{formatearTiempoRelativo(alerta.fechaHoraUltimoContacto)}</span>
                    <span className="alerta-card__ver">Ver ficha →</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
