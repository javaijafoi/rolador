// Cache offline: o app abre sem internet depois da primeira visita.
const CACHE = 'rolador-v3';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/fonts/press-start-2p.woff2', '/fonts/vt323.woff2'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const okHost = url.origin === self.location.origin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!okHost) return;
  if (url.pathname === '/version.json') return; // sempre da rede
  if (url.pathname.endsWith('.apk')) return; // download direto, sem cache

  // Página: tenta a rede (pega versão nova) e cai para o cache sem internet.
  if (req.mode === 'navigate') {
    if (url.pathname !== '/') return; // só a página inicial usa o cache de navegação
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Resto (JS/CSS com hash, fontes, ícones): cache primeiro, atualiza em segundo plano.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
