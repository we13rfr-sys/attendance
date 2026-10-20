const CACHE = 'attendance-student-ca1a4f143ca9';
const SHELL = ['./', './index.html', './style.css', './icon.svg', './apple-touch-icon.png?v=0.2.1', './app-icon-192.png', './app-icon-512.png', './manifest.webmanifest',  './app.js?v=ca1a4f143ca9'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('attendance-student-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url); if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  // OAuth codes and all API responses remain outside the cache.
  if (url.searchParams.has('code') || url.searchParams.has('error')) return;
  const shellUrls = SHELL.map(path => new URL(path, self.registration.scope).href);
  if (!shellUrls.includes(url.href)) return;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then(response => { if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); } return response; }).catch(() => caches.match(event.request)));
});
