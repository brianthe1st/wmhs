// Static-asset cache only. API responses are NEVER cached (shared school computers: one
// student must not be able to read another's cached data) and non-GET requests are ignored.
const CACHE_NAME = 'wmhs-portal-v8';
const ASSETS = ['/manifest.json', '/logo-512.png?v=6'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

// The page asks us to wipe everything on logout.
self.addEventListener('message', (event) => {
  if (event.data === 'clear-caches') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;                 // always straight to the network

  // Pages: network first so a new deploy is picked up immediately; cached copy only when offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html').then((r) => r || Response.error())));
    return;
  }
  // Hashed build assets (/static/...) never change → cache first.
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(request, copy)); }
        return res;
      }))
    );
  }
});
