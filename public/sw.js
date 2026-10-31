// Service worker de l'application mobile : l'interface reste disponible sans réseau.
// Les réponses de l'API (données personnelles) ne sont jamais mises en cache.

const CACHE = 'mcbj-v1';
const COQUILLE = [
  '/',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icones/icone.svg',
  '/icones/icone-192.png',
  '/icones/icone-512.png',
  '/icones/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord, pour toujours servir la dernière version ; le cache prend le relais hors connexion.
  // Toute page de l'application est la même page (routage par le fragment) : on retombe sur « / ».
  const cle = ev.request.mode === 'navigate' ? '/' : ev.request;
  ev.respondWith(fetch(ev.request)
    .then((res) => {
      if (res.ok) {
        const copie = res.clone();
        caches.open(CACHE).then((c) => c.put(cle, copie));
      }
      return res;
    })
    .catch(() => caches.match(cle).then((r) => r ?? Response.error())));
});
