import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

/**
 * Precaches the complete built application, including the puzzle worker and woodland assets.
 * Caches carry a `stumped-astra-` prefix and only those are touched, so other apps hosted on
 * the same origin keep their offline caches.
 */
export function offlinePlugin(): Plugin {
  return {
    name: 'stumped-offline',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = Object.keys(bundle).filter((name) => !name.endsWith('.map'));
        const version = createHash('sha256').update(JSON.stringify(Object.values(bundle).map((file) => file.type === 'chunk' ? file.code : file.source))).digest('hex').slice(0, 12);
        const assets = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', ...files.map((file) => `./${file}`)];
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const PREFIX = 'stumped-astra-';
const CACHE = PREFIX + '${version}';
const ASSETS = ${JSON.stringify(assets)};
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
` });
      },
    },
  };
}
