const CACHE = 'sicho-radio-worklet-v2';

self.addEventListener('install', (e) => {
  const scope = self.registration.scope;
  const assets = [
    './',
    './index.html',
    './app.js',
    './capture-worklet-processor.js',
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
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
