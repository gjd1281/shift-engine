/* The Ultimate Shift Engine — service worker

   ⚠️  BUMP VERSION EVERY TIME YOU CHANGE ANY FILE.
   That one line is what forces every phone to pull the new code. Forget it
   and the crew keep running whatever they cached, no matter what you commit.

   Strategy:
     index.html  -> network first, cache as backup.  New code arrives on the
                    next open, and it still works with no signal.
     everything  -> cache first, quietly refreshed in the background.
     else
*/

var VERSION = 'v3-2026-08-26';
var CACHE = 'shift-engine-' + VERSION;

var ASSETS = [
  './',
  './index.html',
  './attachments.js',
  './crib-banter.js',
  './manifest.webmanifest',
  './icon-192.png'
  // add './backup.js' and './leaderboard.js' here when you commit them
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // addAll fails the whole install if one file 404s, so do them singly
        return Promise.all(ASSETS.map(function (url) {
          return c.add(url).catch(function () { /* missing file, skip it */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (n) {
          if (n !== CACHE) return caches.delete(n);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // let anything off-site through untouched (fonts, etc)
  if (url.origin !== location.origin) return;

  var isPage = req.mode === 'navigate' ||
               url.pathname.endsWith('/') ||
               url.pathname.endsWith('index.html');

  if (isPage) {
    // network first — so a new index.html is picked up straight away
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // everything else: cache first, refreshed in the background
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || net;
    })
  );
});
