const DB_NAME = 'alert-missing-offline-db';
const DB_VERSION = 1;
const STORE_AVISTAMIENTOS = 'avistamientos_pendientes';
const SYNC_TAG = 'sync-avistamientos';

function abrirBaseDatos() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_AVISTAMIENTOS)) {
        const store = db.createObjectStore(STORE_AVISTAMIENTOS, {
          keyPath: 'localId',
          autoIncrement: true,
        });
        store.createIndex('by_fichaId', 'fichaId', { unique: false });
        store.createIndex('by_creadoEn', 'creadoEn', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('No se pudo abrir la base de datos local IndexedDB.'));
  });
}

async function registrarBackgroundSync() {
  try {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(SYNC_TAG);
    }
  } catch {
    // Fallback automático mediante el evento window "online"
  }
}

/**
 * Almacena un reporte de avistamiento en IndexedDB cuando no hay conexión o falla la red.
 */
export async function guardarAvistamientoOffline({
  fichaId,
  payload,
  apiBaseUrl,
  authToken = null,
}) {
  const db = await abrirBaseDatos();

  const registro = {
    fichaId,
    payload,
    apiBaseUrl,
    authToken,
    creadoEn: new Date().toISOString(),
    intentos: 0,
    ultimoError: null,
  };

  const localId = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readwrite');
    const store = tx.objectStore(STORE_AVISTAMIENTOS);
    const req = store.add(registro);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  db.close();
  await registrarBackgroundSync();

  return { ...registro, localId };
}

/**
 * Lista los avistamientos pendientes guardados localmente en IndexedDB.
 */
export async function listarAvistamientosOffline(fichaId = null) {
  const db = await abrirBaseDatos();

  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readonly');
    const store = tx.objectStore(STORE_AVISTAMIENTOS);
    const req = fichaId
      ? store.index('by_fichaId').getAll(IDBKeyRange.only(fichaId))
      : store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return items;
}

/**
 * Elimina un avistamiento sincronizado de IndexedDB.
 */
export async function eliminarAvistamientoOffline(localId) {
  const db = await abrirBaseDatos();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readwrite');
    const store = tx.objectStore(STORE_AVISTAMIENTOS);
    const req = store.delete(localId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  db.close();
}

/**
 * Actualiza metadatos de reintento si un elemento falla al sincronizar.
 */
async function actualizarErrorElemento(item, mensajeError) {
  const db = await abrirBaseDatos();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readwrite');
    const store = tx.objectStore(STORE_AVISTAMIENTOS);
    const req = store.put({
      ...item,
      intentos: (item.intentos || 0) + 1,
      ultimoError: mensajeError,
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  db.close();
}

/**
 * Envía automáticamente todos los avistamientos encolados en IndexedDB cuando hay conectividad.
 */
export async function sincronizarAvistamientosOffline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const pendientes = await listarAvistamientosOffline();
    return { sincronizados: 0, descartadosPorError: 0, pendientes: pendientes.length };
  }

  const pendientes = await listarAvistamientosOffline();
  if (pendientes.length === 0) {
    return { sincronizados: 0, descartadosPorError: 0, pendientes: 0 };
  }

  let sincronizados = 0;
  let descartadosPorError = 0;

  for (const item of pendientes) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (item.authToken) {
      headers.Authorization = `Bearer ${item.authToken}`;
    }

    try {
      const response = await fetch(
        `${item.apiBaseUrl}/avistamientos/ficha/${encodeURIComponent(item.fichaId)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(item.payload),
        }
      );

      if (response.ok) {
        await eliminarAvistamientoOffline(item.localId);
        sincronizados += 1;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        // Error permanente de negocio/validación (ej. ficha ya localizada): retirar de la cola
        await eliminarAvistamientoOffline(item.localId);
        descartadosPorError += 1;
      } else {
        await actualizarErrorElemento(item, `HTTP ${response.status}`);
      }
    } catch (err) {
      // Fallo de red: mantener en IndexedDB para el próximo reconecte
      await actualizarErrorElemento(item, err.message || 'Sin conexión');
      break;
    }
  }

  const restantes = await listarAvistamientosOffline();
  return {
    sincronizados,
    descartadosPorError,
    pendientes: restantes.length,
  };
}

/**
 * Suscribe listeners globales para sincronizar automáticamente al recuperar conectividad
 * o cuando el Service Worker complete un Background Sync.
 */
export function suscribirSincronizacionAutomatica(onResultado) {
  if (typeof window === 'undefined') return () => {};

  const ejecutarSync = async () => {
    try {
      const resultado = await sincronizarAvistamientosOffline();
      if (resultado.sincronizados > 0 || resultado.descartadosPorError > 0) {
        onResultado?.(resultado);
      }
    } catch {
      // Ignorar fallo silencioso hasta el próximo intento
    }
  };

  const manejarMensajeSw = (event) => {
    if (event.data?.type === 'SYNC_AVISTAMIENTOS_COMPLETADA') {
      onResultado?.({
        sincronizados: event.data.sincronizados || 0,
        descartadosPorError: 0,
        pendientes: event.data.pendientes ?? 0,
      });
    }
  };

  window.addEventListener('online', ejecutarSync);
  navigator.serviceWorker?.addEventListener('message', manejarMensajeSw);

  // Intento inicial si ya hay conexión y quedaron reportes guardados
  if (navigator.onLine) {
    ejecutarSync();
  }

  return () => {
    window.removeEventListener('online', ejecutarSync);
    navigator.serviceWorker?.removeEventListener('message', manejarMensajeSw);
  };
}
