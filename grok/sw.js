const PREFIX = 'stumped-grok-';
const CACHE = PREFIX + '1791231795340';
const ASSETS = ["./","./index.html","./manifest.webmanifest","./icon-512.jpg","./assets/index-DxnY1RRj.js","./assets/index-DxnY1RRj.js.map","./assets/acorn_icon-C4zfHb6S.png","./assets/generate-CBj22QHu.js","./assets/index-aiZBrQ6-.css","./assets/logo-v1CSdYf-.jpg","./assets/owl_icon-D1n9BEq9.png","./assets/silver_acorn_icon-BIr-rVeu.png","./assets/squirrel_icon-DbSoH2b6.png","./assets/stump_icon-DTmRAc0J.png","./assets/woodpecker_icon-CE7l122D.png","./assets/generate-CBj22QHu.js.map"];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.open(CACHE).then((cache) =>
    cache.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      void cache.put(event.request, response.clone());
      return response;
    }).catch(() => cache.match('./'))),
  ));
});
