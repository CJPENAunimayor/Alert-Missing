import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext.jsx';

const REGEX_NOMBRE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü' -]{3,120}$/;
const REGEX_DOCUMENTO = /^(?:(?:CC|TI|CE|PA|PPT)[\s-]?)?[A-Za-z0-9]{5,15}$/i;
const REGEX_TELEFONO = /^(?:\+?57)?(?:3\d{9}|60[1-8]\d{7})$|^\+[1-9]\d{7,14}$/;

function validarCampo(nombreCampo, valor) {
  const limpio = String(valor || '').trim();

  if (nombreCampo === 'nombreCompleto') {
    if (limpio.length === 0) return 'El nombre completo es obligatorio.';
    if (!REGEX_NOMBRE.test(limpio)) {
      return 'Debe tener entre 3 y 120 caracteres y contener solo letras y espacios.';
    }
    return '';
  }

  if (nombreCampo === 'documento') {
    if (limpio.length === 0) return 'El documento de identidad es obligatorio.';
    const sinEspacios = limpio.replace(/\s+/g, '');
    if (!REGEX_DOCUMENTO.test(sinEspacios)) {
      return 'Formato inválido. Usa entre 5 y 15 caracteres (ej. 1020304050 o CC-1020304050).';
    }
    return '';
  }

  if (nombreCampo === 'telefono') {
    if (limpio.length === 0) return 'El teléfono de contacto es obligatorio.';
    const sinSeparadores = limpio.replace(/[\s\-()]/g, '');
    if (!REGEX_TELEFONO.test(sinSeparadores)) {
      return 'Ingresa un celular colombiano (ej. 3001234567 o +573001234567) o fijo (6012345678).';
    }
    return '';
  }

  return '';
}

export function ProfilePage() {
  const { user, updateProfile, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [nombreCompleto, setNombreCompleto] = useState(user?.nombreCompleto || '');
  const [documento, setDocumento] = useState(user?.documento || '');
  const [telefono, setTelefono] = useState(user?.telefono || '');
  const [aceptoHabeasData, setAceptoHabeasData] = useState(Boolean(user?.aceptoHabeasData));

  const [tocado, setTocado] = useState({
    nombreCompleto: false,
    documento: false,
    telefono: false,
  });

  const [guardando, setGuardando] = useState(false);
  const [errorServidor, setErrorServidor] = useState('');
  const [exito, setExito] = useState('');

  useEffect(() => {
    if (user) {
      setNombreCompleto(user.nombreCompleto || '');
      setDocumento(user.documento || '');
      setTelefono(user.telefono || '');
      setAceptoHabeasData(Boolean(user.aceptoHabeasData));
    }
  }, [user]);

  const errores = {
    nombreCompleto: validarCampo('nombreCompleto', nombreCompleto),
    documento: validarCampo('documento', documento),
    telefono: validarCampo('telefono', telefono),
    habeasData: !aceptoHabeasData
      ? 'Debe aceptar la política de tratamiento de datos personales (Ley 1581 de 2012).'
      : '',
  };

  const formularioValido =
    !errores.nombreCompleto &&
    !errores.documento &&
    !errores.telefono &&
    !errores.habeasData;

  const manejarGuardar = async (event) => {
    event.preventDefault();
    setTocado({ nombreCompleto: true, documento: true, telefono: true });
    setErrorServidor('');
    setExito('');

    if (!formularioValido) {
      return;
    }

    setGuardando(true);
    try {
      await updateProfile({
        nombreCompleto: nombreCompleto.trim(),
        documento: documento.trim().toUpperCase(),
        telefono: telefono.trim().replace(/[\s\-()]/g, ''),
        aceptoHabeasData: true,
      });

      setExito('Tus datos de contacto y autorización de Hábeas Data fueron guardados correctamente.');

      const siguienteRuta = location.state?.siguienteRuta;
      if (siguienteRuta && siguienteRuta !== '/profile') {
        setTimeout(() => navigate(siguienteRuta, { replace: true }), 900);
      }
    } catch (err) {
      setErrorServidor(err.message || 'No se pudo actualizar tu perfil.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="contenedor">
      <div className="perfil-contenedor">
        <div className="pagina-header">
          <div>
            <h1 className="pagina-header__titulo">Mi Perfil de Denunciante</h1>
            <p className="pagina-header__subtitulo">
              Completa o actualiza tus datos de contacto para publicar fichas de búsqueda y recibir
              notificaciones de avistamientos (RF-01).
            </p>
          </div>
          <Link to="/" className="btn btn--secundario">
            ← Ir a alertas
          </Link>
        </div>

        <section className="tarjeta">
          <div className="perfil-resumen">
            <div>
              <span className="campo__ayuda" style={{ display: 'block' }}>
                Correo verificado ({user?.proveedorAuth || 'GOOGLE'})
              </span>
              <p className="perfil-correo">{user?.correo}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              <span className="badge badge--activa">Rol: {user?.rol}</span>
              <span
                className={`badge ${user?.perfilCompleto ? 'badge--aprobado' : 'badge--pendiente'}`}
              >
                {user?.perfilCompleto ? 'Perfil completo' : 'Datos pendientes'}
              </span>
            </div>
          </div>

          {!user?.perfilCompleto && (
            <div className="aviso aviso--info">
              Para agilizar la coordinación con autoridades y la validación de alertas, completa tu{' '}
              <strong>documento de identidad</strong>, <strong>teléfono</strong> y acepta la{' '}
              <strong>Ley 1581 de 2012 (Hábeas Data)</strong>.
            </div>
          )}

          {errorServidor && (
            <div className="aviso aviso--error" role="alert">
              {errorServidor}
            </div>
          )}

          {exito && (
            <div className="aviso aviso--exito" role="status">
              {exito}
            </div>
          )}

          <form onSubmit={manejarGuardar} noValidate>
            <div className="campo">
              <label htmlFor="perfilNombre" className="campo__label">
                Nombre completo *
              </label>
              <input
                id="perfilNombre"
                type="text"
                className={`campo__input ${
                  tocado.nombreCompleto
                    ? errores.nombreCompleto
                      ? 'campo__input--error'
                      : 'campo__input--valido'
                    : ''
                }`}
                value={nombreCompleto}
                onChange={(e) => {
                  setNombreCompleto(e.target.value);
                  setTocado((t) => ({ ...t, nombreCompleto: true }));
                }}
                placeholder="Ej. Carolina Martínez López"
                required
              />
              {tocado.nombreCompleto && errores.nombreCompleto && (
                <span className="campo__error">{errores.nombreCompleto}</span>
              )}
            </div>

            <div className="grid-campos">
              <div className="campo">
                <label htmlFor="perfilDocumento" className="campo__label">
                  Documento de identidad (CC / TI / CE / PA / PPT) *
                </label>
                <input
                  id="perfilDocumento"
                  type="text"
                  className={`campo__input ${
                    tocado.documento
                      ? errores.documento
                        ? 'campo__input--error'
                        : 'campo__input--valido'
                      : ''
                  }`}
                  value={documento}
                  onChange={(e) => {
                    setDocumento(e.target.value);
                    setTocado((t) => ({ ...t, documento: true }));
                  }}
                  placeholder="Ej. 1020304050"
                  required
                />
                {tocado.documento && errores.documento ? (
                  <span className="campo__error">{errores.documento}</span>
                ) : (
                  <span className="campo__ayuda">5 a 15 caracteres alfanuméricos sin puntos.</span>
                )}
              </div>

              <div className="campo">
                <label htmlFor="perfilTelefono" className="campo__label">
                  Teléfono de contacto (Colombia) *
                </label>
                <input
                  id="perfilTelefono"
                  type="tel"
                  className={`campo__input ${
                    tocado.telefono
                      ? errores.telefono
                        ? 'campo__input--error'
                        : 'campo__input--valido'
                      : ''
                  }`}
                  value={telefono}
                  onChange={(e) => {
                    setTelefono(e.target.value);
                    setTocado((t) => ({ ...t, telefono: true }));
                  }}
                  placeholder="Ej. 3001234567 o +573001234567"
                  required
                />
                {tocado.telefono && errores.telefono ? (
                  <span className="campo__error">{errores.telefono}</span>
                ) : (
                  <span className="campo__ayuda">
                    Solo se usará para coordinación de búsqueda y verificación.
                  </span>
                )}
              </div>
            </div>

            <div className="caja-habeas-data">
              <label className="caja-habeas-data__label">
                <input
                  type="checkbox"
                  checked={aceptoHabeasData}
                  onChange={(e) => setAceptoHabeasData(e.target.checked)}
                />
                <span>
                  Autorizo de manera libre, previa, expresa e informada el tratamiento de mis datos
                  personales por parte de <strong>Alert Missing</strong> exclusivamente para la
                  gestión de alertas, verificación de reportes y contacto de emergencia, de
                  conformidad con la <strong>Ley 1581 de 2012 (Hábeas Data — Colombia)</strong>.
                  {user?.fechaAceptacionHabeasData && (
                    <span className="campo__ayuda" style={{ display: 'block', marginTop: '0.25rem' }}>
                      Aceptado el{' '}
                      {new Date(user.fechaAceptacionHabeasData).toLocaleString('es-CO')}.
                    </span>
                  )}
                </span>
              </label>
              {!aceptoHabeasData && (
                <span className="campo__error" style={{ display: 'block', marginTop: '0.4rem' }}>
                  {errores.habeasData}
                </span>
              )}
            </div>

            <div className="formulario-acciones">
              <button
                type="button"
                className="btn btn--secundario"
                onClick={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
              >
                Cerrar sesión
              </button>

              <button
                type="submit"
                className="btn btn--primario"
                disabled={guardando || !formularioValido}
              >
                {guardando ? 'Guardando cambios...' : 'Guardar perfil de denunciante'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
