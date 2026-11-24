import { Link, useNavigate } from 'react-router-dom';
import { FormularioFichaPasos } from '../components/FormularioFichaPasos.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export function CrearAlertaPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="contenedor" style={{ maxWidth: '860px' }}>
      <div className="pagina-header">
        <div>
          <h1 className="pagina-header__titulo">Reportar Persona Desaparecida</h1>
          <p className="pagina-header__subtitulo">
            Completa los 3 pasos para publicar la ficha georreferenciada y activar el radio de
            búsqueda.
          </p>
        </div>

        <Link to="/" className="btn btn--secundario">
          ← Volver
        </Link>
      </div>

      {user && !user.perfilCompleto && (
        <div className="aviso aviso--info">
          Aún no has completado tu documento y teléfono de denunciante. Te recomendamos{' '}
          <Link to="/profile">completar tu perfil</Link> para facilitar el contacto con autoridades.
        </div>
      )}

      <FormularioFichaPasos
        onCreada={(fichaCreada) => {
          navigate(`/alertas/${fichaCreada.id}`, {
            state: { recienCreadaTemporal: !fichaCreada.sirdecCompletado },
          });
        }}
      />
    </div>
  );
}
