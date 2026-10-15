
const PREFIX = 'stumped-main-';
const CACHE = PREFIX + '621174d8ea5b';
const FILES = ["./","./assets/acorn_icon@8x-ZX_V0f6L.png","./assets/index-CPyHNs9e.js","./assets/index-DWOPQkPu.css","./assets/logo_menu-_uI0Tqd1.jpg","./assets/owl_icon@8x-Cf1Ia1hl.png","./assets/phaser-D8EC1TLR.js","./assets/silver_acorn_icon@8x-Ba6dPyQL.png","./assets/squirrel_icon@8x-DQYcu3tF.png","./assets/stump_icon-DTmRAc0J.png","./assets/woodpecker_icon@8x-QQ-8aZJq.png","./assets/worker-CxcZoJp5.js","./apple-touch-icon.png","./icon-192.png","./icon-512.png","./manifest.webmanifest"];
function cachedUrl(scopeHref, requestUrl, files) {
	const scope = new URL(scopeHref);
	const url = new URL(requestUrl);
	if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
	const relative = url.pathname.slice(scope.pathname.length);
	const path = relative === "" || relative === "index.html" ? "./" : `./${relative}`;
	return files.includes(path) ? path : null;
}
function isBuiltAsset(scopeHref, requestUrl) {
	const scope = new URL(scopeHref);
	const url = new URL(requestUrl);
	return url.origin === scope.origin && url.pathname.startsWith(`${scope.pathname}assets/`);
}
function previousBuild(keys, current, prefix) {
	return keys.filter((key) => key !== current && key.startsWith(prefix) && key.length === current.length && /^[0-9a-f]+$/.test(key.slice(prefix.length))).at(-1) ?? null;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// Taking over at once means an open page is still running the previous build, which can
// still load its files (such as the puzzle worker) from that build's cache. The page then
// offers a refresh. The deploy removes those files from the server, so the cache is all
// there is. Anything older than that is deleted.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => {
      const previous = previousBuild(keys, CACHE, PREFIX);
      return Promise.all(keys
        .filter((key) => key.startsWith(PREFIX) && key !== CACHE && key !== previous)
        .map((key) => caches.delete(key)));
    })
    .then(() => self.clients.claim()));
});

// Seed-code links are the shell plus a query. ignoreVary covers hosts that vary on Origin.
// Requests for the comparison apps are not in FILES, so they are not answered here.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const path = cachedUrl(self.registration.scope, event.request.url, FILES);
  if (path === null) {
    if (isBuiltAsset(self.registration.scope, event.request.url)) {
      event.respondWith(caches.keys()
        .then((keys) => previousBuild(keys, CACHE, PREFIX))
        .then((previous) => (previous === null ? undefined : caches.open(previous)))
        .then((cache) => cache?.match(event.request, { ignoreSearch: true, ignoreVary: true }))
        .then((hit) => hit ?? fetch(event.request)));
    }
    return;
  }
  const target = path === './' ? new URL('./', self.registration.scope) : event.request;
  event.respondWith(caches.open(CACHE)
    .then((cache) => cache.match(target, { ignoreSearch: true, ignoreVary: true }))
    .then((hit) => hit ?? fetch(event.request)));
});
