const CACHE = 'cryptopilot-shell-v2';
const SHELL = ['./', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.includes('/api/')) return;
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';
  if (isNavigation) {
    event.respondWith(fetch(request).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    const copy = response.clone();
    if (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/icon.svg')) {
      void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request)));
});
