import { apiRequest } from './httpClient.js';

export async function sincronizarLoginGoogle({ accessToken, supabaseUser = null, aceptoHabeasData = false }) {
  return apiRequest('/auth/google', {
    method: 'POST',
    body: {
      accessToken,
      supabaseUser,
      aceptoHabeasData,
    },
  });
}

export async function obtenerPerfilActual(token = null) {
  return apiRequest('/auth/me', {
    method: 'GET',
    token,
  });
}

export async function actualizarPerfilDenunciante(datos) {
  return apiRequest('/auth/profile', {
    method: 'PUT',
    body: datos,
  });
}

export async function cerrarSesionApi() {
  return apiRequest('/auth/logout', {
    method: 'POST',
  });
}
