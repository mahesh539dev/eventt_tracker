const VERSION = 'v8';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/main.js',
  '/js/api.js',
  '/js/state.js',
  '/js/money.js',
  '/js/dates.js',
  '/js/ui.js',
  '/js/views/eventList.js',
  '/js/views/eventForm.js',
  '/js/views/reportView.js',
  '/js/views/globalExpensesView.js',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});
