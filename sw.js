const CACHE = 'attendance-student-1f7aff1543f5';
const SHELL = ['./', './index.html', './style.css', './icon.svg', './apple-touch-icon.png', './manifest.webmanifest', './app.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('attendance-student-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url); if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  // OAuth codes and all API responses remain outside the cache.
  if (url.searchParams.has('code') || url.searchParams.has('error')) return;
  const shellUrls = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (!shellUrls.includes(url.href)) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone())); return response; }).catch(() => caches.match(event.request)));
});
