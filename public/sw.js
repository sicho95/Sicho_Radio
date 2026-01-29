const CACHE = 'sicho-radio-v8-channels';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './channels.json', './index.html', './app.js', './processors.js', './manifest.webmanifest', './icons/icon-192.png'])));
  self.skipWaiting();
});
self.addEventListener('fetch', e => {
  if (e.request.url.startsWith(location.origin)) 
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
