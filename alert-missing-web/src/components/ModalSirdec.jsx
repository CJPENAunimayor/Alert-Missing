import { useEffect, useMemo, useState } from 'react';
import { actualizarDatosSirdec, descargarReporteSirdec } from '../api-client/alertaApi.js';
import { useAuth } from '../state/AuthContext.jsx';

const CAMPOS_SIRDEC_OBLIGATORIOS = [
  {
    clave: 'tipoDocumento',
    etiqueta: 'Tipo de documento',
    tipo: 'select',
    opciones: ['', 'CC', 'TI', 'RC', 'CE', 'PA', 'PPT'],
  },
  { clave: 'numeroDocumento', etiqueta: 'Número de documento', tipo: 'text', placeholder: 'Ej. 1020304050' },
  { clave: 'estaturaCm', etiqueta: 'Estatura aproximada (cm)', tipo: 'number', placeholder: 'Ej. 165' },
  {
    clave: 'contextura',
    etiqueta: 'Contextura corporal',
    tipo: 'select',
    opciones: ['', 'Delgada', 'Mediana', 'Robusta', 'Atlética'],
  },
  { clave: 'colorPiel', etiqueta: 'Color de piel', tipo: 'text', placeholder: 'Ej. Trigueña, clara, morena...' },
  { clave: 'colorCabello', etiqueta: 'Color de cabello', tipo: 'text', placeholder: 'Ej. Negro, castaño...' },
  { clave: 'colorOjos', etiqueta: 'Color de ojos', tipo: 'text', placeholder: 'Ej. Café oscuro' },
  { clave: 'departamentoDesaparicion', etiqueta: 'Departamento de desaparición', tipo: 'text', placeholder: 'Ej. Cundinamarca' },
  { clave: 'municipioDesaparicion', etiqueta: 'Municipio de desaparición', tipo: 'text', placeholder: 'Ej. Bogotá D.C.' },
];

const CAMPOS_SIRDEC_OPCIONALES = [
  { clave: 'pesoKg', etiqueta: 'Peso aproximado (kg)', tipo: 'number', placeholder: 'Ej. 60' },
  { clave: 'tipoCabello', etiqueta: 'Tipo / longitud de cabello', tipo: 'text', placeholder: 'Ej. Lacio largo, ondulado corto...' },
  { clave: 'tipoDentadura', etiqueta: 'Características dentales', tipo: 'text', placeholder: 'Ej. Brackets, ausencia dental...' },
  { clave: 'cicatrices', etiqueta: 'Cicatrices o marcas quirúrgicas', tipo: 'text', placeholder: 'Ubicación y tamaño aproximado' },
  { clave: 'tatuajes', etiqueta: 'Tatuajes', tipo: 'text', placeholder: 'Diseño y ubicación corporal' },
];

function formatearFechaLimite(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ModalSirdec({ ficha, abierto, onCerrar, onFichaActualizada }) {
  const { user } = useAuth();
  const [valores, setValores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [descargando, setDescargando] = useState('');
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const puedeEditar = Boolean(
    user &&
      ficha &&
      (user.rol === 'ADMINISTRADOR' || String(user.id) === String(ficha.creadorId))
  );

  useEffect(() => {
    if (abierto && ficha) {
      setValores(ficha.datosSirdec || {});
      setError('');
      setExito('');
    }
  }, [abierto, ficha]);

  useEffect(() => {
    if (!abierto) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !guardando && !descargando) onCerrar?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto, guardando, descargando, onCerrar]);

  const progresoObligatorios = useMemo(() => {
    const faltantes = CAMPOS_SIRDEC_OBLIGATORIOS.filter((c) => {
      const v = valores[c.clave];
      return v === undefined || v === null || String(v).trim() === '';
    });
    const completados = CAMPOS_SIRDEC_OBLIGATORIOS.length - faltantes.length;
    return {
      total: CAMPOS_SIRDEC_OBLIGATORIOS.length,
      completados,
      faltantes,
      porcentaje: Math.round((completados / CAMPOS_SIRDEC_OBLIGATORIOS.length) * 100),
      completo: faltantes.length === 0,
    };
  }, [valores]);

  if (!abierto || !ficha) return null;

  const manejarCambio = (clave, valor) => {
    setValores((prev) => ({ ...prev, [clave]: valor }));
  };

  const guardarCampos = async (event) => {
    event?.preventDefault();
    if (!puedeEditar) return;

    setGuardando(true);
    setError('');
    setExito('');

    try {
      const res = await actualizarDatosSirdec(ficha.id, valores);
      onFichaActualizada?.(res.ficha);
      setExito(
        res.mensaje ||
          'Campos morfológicos SIRDEC guardados. Ya puedes descargar el reporte actualizado.'
      );
    } catch (err) {
      setError(err.message || 'No fue posible guardar los datos morfológicos.');
    } finally {
      setGuardando(false);
    }
  };

  const manejarDescarga = async (formato) => {
    setDescargando(formato);
    setError('');
    try {
      await descargarReporteSirdec(ficha.id, formato);
      setExito(`Reporte SIRDEC descargado en formato ${formato.toUpperCase()}.`);
    } catch (err) {
      setError(err.message || `No se pudo descargar el reporte SIRDEC (${formato.toUpperCase()}).`);
    } finally {
      setDescargando('');
    }
  };

  const renderCampo = (campo, obligatorio) => {
    const valor = valores[campo.clave] ?? '';
    const vacio = String(valor).trim() === '';

    return (
      <div key={campo.clave} className="campo" style={{ marginBottom: 'var(--esp-2)' }}>
        <label htmlFor={`sirdec-${campo.clave}`} className="campo__label">
          {campo.etiqueta} {obligatorio && <span style={{ color: 'var(--color-peligro)' }}>*</span>}
        </label>

        {campo.tipo === 'select' ? (
          <select
            id={`sirdec-${campo.clave}`}
            className={`campo__select ${obligatorio && vacio && puedeEditar ? 'campo__input--pendiente' : ''}`}
            value={valor}
            disabled={!puedeEditar}
            onChange={(e) => manejarCambio(campo.clave, e.target.value)}
          >
            {campo.opciones.map((opt) => (
              <option key={opt || 'vacio'} value={opt}>
                {opt || '— Seleccionar —'}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`sirdec-${campo.clave}`}
            type={campo.tipo}
            className={`campo__input ${obligatorio && vacio && puedeEditar ? 'campo__input--pendiente' : ''}`}
            placeholder={campo.placeholder}
            value={valor}
            disabled={!puedeEditar}
            onChange={(e) => manejarCambio(campo.clave, e.target.value)}
          />
        )}
      </div>
    );
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-modal-sirdec"
      onClick={() => !guardando && !descargando && onCerrar?.()}
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
          <div>
            <h2 id="titulo-modal-sirdec" style={{ margin: 0, color: 'var(--color-primario)' }}>
              Formato SIRDEC Obligatorio (Fiscalía / Medicina Legal)
            </h2>
            <p style={{ margin: '0.2rem 0 0', fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
              {ficha.nombreDesaparecido}
              {!ficha.sirdecCompletado && ficha.sirdecFechaLimite
                ? ` · Plazo límite: ${formatearFechaLimite(ficha.sirdecFechaLimite)}`
                : ' · Registro SIRDEC definitivo'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--secundario btn--pequeno"
            onClick={onCerrar}
            disabled={guardando || Boolean(descargando)}
          >
            Cerrar
          </button>
        </div>

        {/* Barra de progreso de los 9 campos obligatorios */}
        <div className="sirdec-progreso">
          <div className="sirdec-progreso__cabecera">
            <span>
              Campos obligatorios SIRDEC:{' '}
              <strong>
                {progresoObligatorios.completados}/{progresoObligatorios.total}
              </strong>
            </span>
            <strong>{progresoObligatorios.porcentaje}%</strong>
          </div>
          <div className="sirdec-progreso__barra">
            <div
              className={`sirdec-progreso__relleno ${
                progresoObligatorios.completo ? 'sirdec-progreso__relleno--completo' : ''
              }`}
              style={{ width: `${progresoObligatorios.porcentaje}%` }}
            />
          </div>
        </div>

        {!ficha.sirdecCompletado && (
          <div className="aviso aviso--advertencia">
            {ficha.estado === 'SUSPENDIDA_SIRDEC' ? (
              <span>
                <strong>Alerta suspendida por plazo vencido:</strong> completa los{' '}
                <strong>{progresoObligatorios.faltantes.length} campo(s) obligatorios</strong>{' '}
                restantes y guarda para reactivar automáticamente esta alerta en el mapa público.
              </span>
            ) : (
              <span>
                Esta ficha está publicada de forma <strong>temporal</strong>. Completa los{' '}
                <strong>9 campos obligatorios (*)</strong> antes de que venza el plazo de 1 día
                hábil para confirmar su publicación definitiva.
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="aviso aviso--error" role="alert">
            {error}
          </div>
        )}

        {exito && (
          <div className="aviso aviso--exito" role="status">
            {exito}
          </div>
        )}

        <form onSubmit={guardarCampos}>
          <h3 className="sirdec-seccion-titulo">
            1. Campos morfológicos obligatorios ({progresoObligatorios.completados}/
            {progresoObligatorios.total})
          </h3>
          <div className="grid-campos">
            {CAMPOS_SIRDEC_OBLIGATORIOS.map((campo) => renderCampo(campo, true))}
          </div>

          <h3 className="sirdec-seccion-titulo" style={{ marginTop: 'var(--esp-4)' }}>
            2. Campos complementarios (opcionales)
          </h3>
          <div className="grid-campos">
            {CAMPOS_SIRDEC_OPCIONALES.map((campo) => renderCampo(campo, false))}
          </div>

          {!puedeEditar && (
            <p style={{ fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)', margin: '0.5rem 0 0' }}>
              Solo el creador de la ficha o un administrador puede editar campos morfológicos, pero
              puedes descargar la ficha SIRDEC en PDF o JSON.
            </p>
          )}

          <div
            className="modal__acciones"
            style={{ borderTop: '1px solid var(--color-borde)', paddingTop: 'var(--esp-3)' }}
          >
            {puedeEditar && (
              <button
                type="submit"
                className={`btn ${progresoObligatorios.completo ? 'btn--exito' : 'btn--primario'}`}
                disabled={guardando || Boolean(descargando)}
              >
                {guardando
                  ? 'Guardando...'
                  : ficha.estado === 'SUSPENDIDA_SIRDEC' && progresoObligatorios.completo
                    ? 'Guardar SIRDEC y reactivar alerta'
                    : progresoObligatorios.completo
                      ? 'Guardar y confirmar registro SIRDEC'
                      : 'Guardar avance SIRDEC'}
              </button>
            )}

            <button
              type="button"
              className="btn btn--secundario"
              disabled={guardando || Boolean(descargando)}
              onClick={() => manejarDescarga('json')}
            >
              {descargando === 'json' ? 'Generando JSON...' : 'Descargar JSON'}
            </button>

            <button
              type="button"
              className="btn btn--secundario"
              disabled={guardando || Boolean(descargando)}
              onClick={() => manejarDescarga('pdf')}
            >
              {descargando === 'pdf' ? 'Generando PDF...' : 'Descargar PDF'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
