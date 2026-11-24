import { useState } from 'react';
import { cancelarAlerta, cerrarAlerta } from '../api-client/alertaApi.js';
import { useAuth } from '../state/AuthContext.jsx';

export function PanelCierreAlerta({ ficha, onEstadoActualizado }) {
  const { user } = useAuth();
  const [accionActiva, setAccionActiva] = useState(null); // 'CERRAR' | 'CANCELAR' | null
  const [texto, setTexto] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  const puedeGestionar = Boolean(
    user &&
      ficha &&
      (user.rol === 'ADMINISTRADOR' || String(user.id) === String(ficha.creadorId))
  );

  if (!ficha) return null;

  // Si la alerta ya fue cerrada o cancelada, mostrar banner informativo a todos
  if (ficha.estado !== 'ACTIVA') {
    return (
      <section className="tarjeta" style={{ marginTop: 'var(--esp-5)' }}>
        <div
          className={`aviso ${ficha.estado === 'LOCALIZADA' ? 'aviso--exito' : 'aviso--advertencia'}`}
          style={{ marginBottom: 0 }}
        >
          <strong>
            {ficha.estado === 'LOCALIZADA'
              ? 'Persona localizada — Alerta cerrada'
              : 'Alerta cancelada'}
          </strong>
          : esta ficha fue retirada del mapa y listados públicos activos y su difusión de
          notificaciones se encuentra detenida.
        </div>
      </section>
    );
  }

  if (!puedeGestionar) {
    return null;
  }

  const abrirFormulario = (tipo) => {
    setAccionActiva(tipo);
    setTexto('');
    setError('');
    setExito('');
  };

  const confirmarAccion = async (event) => {
    event.preventDefault();
    setError('');
    setExito('');

    if (texto.trim().length < 5) {
      setError(
        accionActiva === 'CERRAR'
          ? 'Ingresa un resumen breve de la localización (mínimo 5 caracteres).'
          : 'Ingresa el motivo de cancelación (mínimo 5 caracteres).'
      );
      return;
    }

    setProcesando(true);
    try {
      const res =
        accionActiva === 'CERRAR'
          ? await cerrarAlerta(ficha.id, { resumen: texto.trim() })
          : await cancelarAlerta(ficha.id, { motivo: texto.trim() });

      setExito(res.mensaje);
      setAccionActiva(null);
      setTexto('');
      onEstadoActualizado?.(res.ficha);
    } catch (err) {
      setError(err.message || 'No fue posible actualizar el estado de la alerta.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <section className="panel-cierre" aria-label="Gestión de cierre o cancelación de alerta">
      <div style={{ marginBottom: 'var(--esp-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--tam-lg)', color: 'var(--color-primario)' }}>
          Ciclo de Cierre / Cancelación de la Alerta
        </h2>
        <p style={{ margin: '0.25rem 0 0', fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
          Disponible solo para el creador de la ficha o un administrador. Al cerrar o cancelar la
          alerta se detiene la difusión Push y se retira del mapa público activo, conservando la
          trazabilidad inmutable.
        </p>
      </div>

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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)' }}>
        <button
          type="button"
          className="btn btn--exito"
          disabled={procesando}
          onClick={() => abrirFormulario(accionActiva === 'CERRAR' ? null : 'CERRAR')}
        >
          ✓ Persona localizada
        </button>

        <button
          type="button"
          className="btn btn--peligro"
          disabled={procesando}
          onClick={() => abrirFormulario(accionActiva === 'CANCELAR' ? null : 'CANCELAR')}
        >
          ✕ Cancelar alerta
        </button>
      </div>

      {accionActiva && (
        <form onSubmit={confirmarAccion} className="panel-cierre__form">
          <div className="campo" style={{ marginBottom: 'var(--esp-3)' }}>
            <label htmlFor="textoCierreAlerta" className="campo__label">
              {accionActiva === 'CERRAR'
                ? 'Resumen de localización (quedará registrado en el historial inmutable) *'
                : 'Motivo de cancelación (quedará registrado en el historial inmutable) *'}
            </label>
            <textarea
              id="textoCierreAlerta"
              rows={3}
              className="campo__textarea"
              placeholder={
                accionActiva === 'CERRAR'
                  ? 'Ej. Persona ubicada sana y salva por familiares con apoyo de la Policía Nacional.'
                  : 'Ej. Ficha creada por error / reporte duplicado.'
              }
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              required
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)' }}>
            <button
              type="submit"
              className={`btn ${accionActiva === 'CERRAR' ? 'btn--exito' : 'btn--peligro'}`}
              disabled={procesando}
            >
              {procesando
                ? 'Procesando...'
                : accionActiva === 'CERRAR'
                  ? 'Confirmar: Persona localizada'
                  : 'Confirmar cancelación'}
            </button>
            <button
              type="button"
              className="btn btn--secundario"
              disabled={procesando}
              onClick={() => setAccionActiva(null)}
            >
              Volver
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
