// Service worker de l'appli téléphone : garde une copie des pages pour l'ouvrir sans réseau.
// Réseau d'abord (une mise à jour est visible tout de suite), copie en secours.
// __BUILD__ est remplacé à chaque construction : l'ancienne copie est alors effacée.
const CACHE = 'immodex-__BUILD__';
const CORE = [
  '/src/popup/popup.html',
  '/src/popup/popup.js',
  '/src/ui/styles.js',
  '/src/ui/components.js',
  '/src/vendor/qrcode/qrcode.js',
  '/platform/chrome-shim.js',
  '/platform/web.css',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Synchro et services publics (ADEME, IGN…) : toujours en direct.
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
