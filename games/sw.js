// Offline cache for Игротека: everything is local, serve cache-first and refresh in the background.
const CACHE = 'igra-v9';
const ASSETS = ['./', './index.html', './common.css', './common.js', './hockey.html', './penalty.html', './basket.html', './rhythm.html', './words.html', './emoji.html', './geo.html', './geo.json', './words5.json', './beatmap.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './fonts/rubik-cyr.woff2', './fonts/rubik-lat.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(res => { if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
