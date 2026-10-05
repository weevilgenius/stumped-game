
const PREFIX = 'stumped-astra-';
const CACHE = PREFIX + '5266e6cdd9b9';
const ASSETS = ["./","./manifest.webmanifest","./icon-192.png","./icon-512.png","./assets/index-b4FzEmB2.js","./assets/acorn_icon@2x-CcWZjhM5.png","./assets/generate.worker-DGpsxsJb.js","./assets/index-WUgLQ4tD.css","./assets/logo-web-DaoLh1MR.jpg","./assets/owl_icon@2x-Baw6rWMi.png","./assets/silver_acorn_icon@2x-1cPPlpZ8.png","./assets/squirrel_icon@2x-DCfCL7jG.png","./assets/stump_icon@2x-Cvb_NfMl.png","./assets/stump_icon@4x-D74sxkdN.png","./assets/woodpecker_icon@2x-Btx1ZOvy.png","./index.html"];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    if (event.request.mode === 'navigate') return (await cache.match('./')) || fetch(event.request);
    return (await cache.match(event.request, { ignoreVary: true })) || fetch(event.request);
  }));
});
