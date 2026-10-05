
const PREFIX = 'stumped-fable-';
const CACHE = PREFIX + 'muvp5wns';
const FILES = ["./","assets/index-CUIdITKF.js","assets/acorn_icon@8x-ZX_V0f6L.png","assets/index-B3xtC-JY.css","assets/logo_menu-_uI0Tqd1.jpg","assets/owl_icon@8x-Cf1Ia1hl.png","assets/silver_acorn_icon@8x-Ba6dPyQL.png","assets/squirrel_icon@8x-DQYcu3tF.png","assets/stump_icon-DTmRAc0J.png","assets/woodpecker_icon@8x-QQ-8aZJq.png","assets/worker-SUiBSAhM.js","apple-touch-icon.png","icon-192.png","icon-512.png","manifest.webmanifest"];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// A link with a seed code is the same page with a query, hence ignoreSearch. Hosts that answer
// with "Vary: Origin" would otherwise miss for the script and stylesheet, hence ignoreVary.
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(event.request, { ignoreSearch: true, ignoreVary: true }))
    .then((hit) => hit ?? fetch(event.request)));
});
