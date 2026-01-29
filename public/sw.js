const CACHE = 'sicho-radio-v3-jitter';

self.addEventListener('install', (e) => {
  const scope = self.registration.scope;
  const assets = [
    './',
    './index.html',
    './app.js',
    './processors.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png'
  ].map((p) => new URL(p, scope));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(assets)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Stratégie : Network First pour dev, puis Cache
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
