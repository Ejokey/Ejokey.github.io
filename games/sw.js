// Offline cache for Игротека.
// Online: pages and scripts come fresh from the network (so an update shows up on the next open),
// with a short timeout so a bad connection falls back to the cache. Offline (plane): straight from the cache.
const CACHE = 'igra-v10';
const ASSETS = ['./', './index.html', './common.css', './common.js', './hockey.html', './penalty.html', './basket.html', './rhythm.html', './words.html', './emoji.html', './geo.html', './geo.json', './words5.json', './beatmap.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './fonts/rubik-cyr.woff2', './fonts/rubik-lat.woff2'];
// cache: 'reload' skips the browser's HTTP cache, otherwise GitHub Pages may hand back the previous version for ~10 min
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const FRESH = /\.(html|js|css|json|webmanifest)$|\/$/;   // fonts and icons never change: cache-first is fine
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const fromCache = () => caches.match(req, { ignoreSearch: true });
  const fromNet = () => fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });
  if (!FRESH.test(url.pathname) && req.mode !== 'navigate') {
    e.respondWith(fromCache().then(hit => hit || fromNet()));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then(finish), 2500);
    fromNet().then(finish, () => fromCache().then(hit => finish(hit || Response.error())))
      .finally(() => clearTimeout(timer));
    // if the cache answered on timeout but there's no cached copy, still wait for the network
  }));
});
