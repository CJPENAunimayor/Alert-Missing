/* ============================================================================
   Alert Missing Colombia - Service Worker (PWA)
   Caché de recursos estáticos + Sincronización en segundo plano (IndexedDB)
   ============================================================================ */

const CACHE_ESTATICO = 'alert-missing-static-v1';
const RECURSOS_BASE = ['/', '/index.html', '/manifest.webmanifest'];

const DB_NAME = 'alert-missing-offline-db';
const DB_VERSION = 1;
const STORE_AVISTAMIENTOS = 'avistamientos_pendientes';
const SYNC_TAG = 'sync-avistamientos';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => cache.addAll(RECURSOS_BASE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(
          claves
            .filter((clave) => clave !== CACHE_ESTATICO)
            .map((clave) => caches.delete(clave))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No interceptar llamadas al API ni servicios externos (OSM / Overpass / Supabase)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  // Navegación SPA: network-first con respaldo a index.html cacheado
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((respuesta) => {
          const copia = respuesta.clone();
          caches.open(CACHE_ESTATICO).then((cache) => cache.put(request, copia));
          return respuesta;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Recursos estáticos (JS, CSS, imágenes, fuentes): stale-while-revalidate
  event.respondWith(
    caches.match(request).then((enCache) => {
      const peticionRed = fetch(request)
        .then((respuesta) => {
          if (respuesta && respuesta.status === 200 && respuesta.type === 'basic') {
            const copia = respuesta.clone();
            caches.open(CACHE_ESTATICO).then((cache) => cache.put(request, copia));
          }
          return respuesta;
        })
        .catch(() => enCache);

      return enCache || peticionRed;
    })
  );
});

// ============================================================================
// Sincronización de avistamientos almacenados en IndexedDB al reconectar
// ============================================================================

function abrirIdbEnSw() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sincronizarDesdeSw() {
  const db = await abrirIdbEnSw();

  const pendientes = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readonly');
    const req = tx.objectStore(STORE_AVISTAMIENTOS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  let sincronizados = 0;

  for (const item of pendientes) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (item.authToken) {
      headers.Authorization = `Bearer ${item.authToken}`;
    }

    const res = await fetch(
      `${item.apiBaseUrl}/avistamientos/ficha/${encodeURIComponent(item.fichaId)}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(item.payload),
      }
    );

    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AVISTAMIENTOS, 'readwrite');
        const req = tx.objectStore(STORE_AVISTAMIENTOS).delete(item.localId);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      if (res.ok) sincronizados += 1;
    }
  }

  const restantes = await new Promise((resolve) => {
    const tx = db.transaction(STORE_AVISTAMIENTOS, 'readonly');
    const req = tx.objectStore(STORE_AVISTAMIENTOS).count();
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => resolve(0);
  });

  db.close();

  const clientes = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const cliente of clientes) {
    cliente.postMessage({
      type: 'SYNC_AVISTAMIENTOS_COMPLETADA',
      sincronizados,
      pendientes: restantes,
    });
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(sincronizarDesdeSw());
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SYNC_NOW') {
    event.waitUntil(sincronizarDesdeSw());
  }
});
