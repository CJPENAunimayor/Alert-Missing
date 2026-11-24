import { useEffect, useState } from 'react';

const LINEAS_EMERGENCIA = [
  {
    numero: '123',
    entidad: 'Policía',
    nombreCompleto: 'Policía Nacional',
    cuandoLlamar:
      'Llame de inmediato ante un avistamiento, situación de riesgo o desaparición reciente (reacción 24/7).',
  },
  {
    numero: '122',
    entidad: 'Fiscalía',
    nombreCompleto: 'Fiscalía General de la Nación (MBU)',
    cuandoLlamar:
      'Para radicar la denuncia y activar el Mecanismo de Búsqueda Urgente sin esperar 72 horas.',
  },
  {
    numero: '141',
    entidad: 'ICBF',
    nombreCompleto: 'ICBF — Línea de Protección',
    cuandoLlamar:
      'Atención gratuita y prioritaria cuando la persona desaparecida es menor de 18 años.',
  },
];

function detectarDispositivoMovil() {
  if (typeof window === 'undefined') return false;
  const uaMovil = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
  const punteroTactil = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return uaMovil || (punteroTactil && window.innerWidth < 768);
}

export function ModuloEmergencia() {
  const [esMovil, setEsMovil] = useState(detectarDispositivoMovil);
  const [lineaModal, setLineaModal] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const actualizar = () => setEsMovil(detectarDispositivoMovil());
    window.addEventListener('resize', actualizar);
    return () => window.removeEventListener('resize', actualizar);
  }, []);

  useEffect(() => {
    if (!lineaModal) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLineaModal(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lineaModal]);

  const abrirModalEscritorio = (e, linea) => {
    if (!esMovil) {
      e.preventDefault();
      setCopiado(false);
      setLineaModal(linea);
    }
  };

  const copiarNumero = async (numero) => {
    try {
      await navigator.clipboard.writeText(numero);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="franja-emergencia" role="region" aria-label="Líneas de emergencia en Colombia">
      <div className="franja-emergencia__inner">
        <span className="franja-emergencia__label">
          Emergencias 24/7 (no espere 72 h):
        </span>

        <div className="franja-emergencia__pills">
          {LINEAS_EMERGENCIA.map((linea) => (
            <a
              key={linea.numero}
              href={`tel:${linea.numero}`}
              className="emergencia-pill"
              onClick={(e) => abrirModalEscritorio(e, linea)}
              aria-label={`Llamar a Línea ${linea.numero} - ${linea.nombreCompleto}`}
            >
              <span className="emergencia-pill__num">{linea.numero}</span>
              <span>{linea.entidad}</span>
            </a>
          ))}
        </div>
      </div>

      {lineaModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-emergencia-titulo"
          onClick={() => setLineaModal(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3
              id="modal-emergencia-titulo"
              style={{ marginTop: 0, color: 'var(--color-primario)' }}
            >
              Línea {lineaModal.numero} — {lineaModal.nombreCompleto}
            </h3>

            <div className="modal__numero-destacado">{lineaModal.numero}</div>

            <p style={{ margin: '0 0 0.75rem', fontSize: 'var(--tam-sm)' }}>
              {lineaModal.cuandoLlamar}
            </p>

            <p style={{ margin: 0, fontSize: 'var(--tam-xs)', color: 'var(--color-texto-secundario)' }}>
              Línea gratuita nacional desde cualquier celular o teléfono fijo en Colombia.
            </p>

            <div className="modal__acciones">
              <button
                type="button"
                className="btn btn--secundario"
                onClick={() => copiarNumero(lineaModal.numero)}
              >
                {copiado ? 'Número copiado' : 'Copiar número'}
              </button>
              <a href={`tel:${lineaModal.numero}`} className="btn btn--peligro">
                Abrir app de llamadas
              </a>
              <button
                type="button"
                className="btn btn--primario"
                onClick={() => setLineaModal(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
