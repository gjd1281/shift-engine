/* The Ultimate Shift Engine — offline cache
   Bump CACHE when you ship a new index.html. */

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // one at a time: a missing file shouldn't kill the whole install
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      // refresh in the background so the next launch is current
      fetch(req).then(r => {
        if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()));
      }).catch(() => {});
      return cached;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && (new URL(req.url).origin === location.origin ||
          req.url.indexOf('fonts.g') > -1)) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      // offline and never cached — fall back to the app itself for page loads
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
