// Офлайн для «Израиль — помощник».
// Оболочка приложения — в своём кэше. Модели (./models/ и Hugging Face) кэширует сам transformers.js
// в 'transformers-cache', поэтому их здесь не трогаем, чтобы не хранить дважды.
// Заголовки COOP/COEP добавляем сами: без них браузер не даст многопоточность, и перевод будет медленнее.
const CACHE = 'israel-v4';
const ASSETS = ['./', './index.html', './app.js', './phrases.js', './models.js', './worker.js',
  './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './vendor/transformers.min.js', './vendor/ort-wasm-simd-threaded.jsep.mjs', './vendor/ort-wasm-simd-threaded.jsep.wasm'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x.startsWith('israel-') && x !== CACHE).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});

function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// GitHub не принимает файлы больше 100 МБ, поэтому крупные модели лежат частями.
// Отдаём их одним файлом, склеивая на лету (дальше transformers.js сам положит его в свой кэш).
const SPLIT = {
  'models/mike249/whisper-small-he-v4/onnx/decoder_model_merged_quantized.onnx': { parts: 2, size: 156599473 },
};
function joined(url, { parts, size }) {
  let i = 0, reader = null;
  const body = new ReadableStream({
    async pull(ctrl) {
      while (true) {
        if (!reader) {
          if (i >= parts) { ctrl.close(); return; }
          const res = await fetch(`${url}.part${i++}`, { cache: 'no-cache' });
          if (!res.ok) { ctrl.error(new Error('part ' + res.status)); return; }
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) { reader = null; continue; }
        ctrl.enqueue(value); return;
      }
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } });
}

const FRESH = /\.(html|js|mjs|json|webmanifest)$|\/$/;   // код: сначала сеть (с таймаутом), потом кэш
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/models/')) {                  // модели кэширует transformers.js
    const key = Object.keys(SPLIT).find(k => url.pathname.endsWith('/' + k));
    if (key) e.respondWith(joined(url.href.split('?')[0], SPLIT[key]));
    return;
  }

  const fromCache = () => caches.match(req, { ignoreSearch: true });
  const fromNet = () => fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  });

  if (!FRESH.test(url.pathname) && req.mode !== 'navigate') {
    e.respondWith(fromCache().then(hit => hit || fromNet()).then(isolate));
    return;
  }
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(isolate(r)); } };
    const timer = setTimeout(() => fromCache().then(finish), 2500);
    fromNet().then(finish, () => fromCache().then(hit => finish(hit || Response.error())))
      .finally(() => clearTimeout(timer));
  }));
});
