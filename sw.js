
const PREFIX = 'stumped-main-';
const CACHE = PREFIX + 'fe2b91f5c234';
const FILES = ["./","./assets/acorn_icon@8x-ZX_V0f6L.png","./assets/index-CAAf_v5U.css","./assets/index-I6VUqJsk.js","./assets/logo_menu-_uI0Tqd1.jpg","./assets/owl_icon@8x-Cf1Ia1hl.png","./assets/phaser-D8EC1TLR.js","./assets/silver_acorn_icon@8x-Ba6dPyQL.png","./assets/squirrel_icon@8x-DQYcu3tF.png","./assets/stump_icon-DTmRAc0J.png","./assets/woodpecker_icon@8x-QQ-8aZJq.png","./assets/worker-B-8sNOIl.js","./apple-touch-icon.png","./icon-192.png","./icon-512.png","./manifest.webmanifest"];
function cachedUrl(scopeHref, requestUrl, files) {
	const scope = new URL(scopeHref);
	const url = new URL(requestUrl);
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
	const relative = url.pathname.slice(scope.pathname.length);
	const path = relative === "" || relative === "index.html" ? "./" : `./${relative}`;
	return files.includes(path) ? path : null;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Seed-code links are the shell plus a query. ignoreVary covers hosts that vary on Origin.
// Requests for the comparison apps are not in FILES, so they are not answered here.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const path = cachedUrl(self.registration.scope, event.request.url, FILES);
  if (path === null) return;
  const target = path === './' ? new URL('./', self.registration.scope) : event.request;
  event.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(target, { ignoreSearch: true, ignoreVary: true }))
    .then((hit) => hit ?? fetch(event.request)));
});
