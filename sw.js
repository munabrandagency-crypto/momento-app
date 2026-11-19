/* Momento Scanner — service worker : l'application fonctionne sans internet */
const VERSION = 'momento-v3';
const FILES = [
  './',
  'admin.html',
  'css/admin.css',
  'js/admin.js',
  'assets/demo-fond.jpg',
  'assets/demo-logo-mariage.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/momento-logo.png',
  'config.js',
  'css/app.css',
  'fonts/cormorant-garamond-latin-400-normal.woff2',
  'fonts/cormorant-garamond-latin-600-normal.woff2',
  'fonts/greatvibes.woff2',
  'fonts/montserrat-latin-400-normal.woff2',
  'fonts/montserrat-latin-500-normal.woff2',
  'fonts/montserrat-latin-600-normal.woff2',
  'fonts/montserrat-latin-700-normal.woff2',
  'fonts/playfair-display-latin-400-normal.woff2',
  'fonts/playfair-display-latin-600-normal.woff2',
  'index.html',
  'js/app.js',
  'js/core.js',
  'lib/jsQR.js',
  'manifest.webmanifest',
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // l'API Google n'est jamais mise en cache ici
  e.respondWith(
    caches.open(VERSION).then(function (cache) {
      return cache.match(e.request, { ignoreSearch: true }).then(function (hit) {
        const net = fetch(e.request).then(function (res) {
          if (res && res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    })
  );
});
