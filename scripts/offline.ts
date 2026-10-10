import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Cache names start with this. Activate deletes only caches that do. */
export const CACHE_PREFIX = 'stumped-main-';

/** Hex digits kept from the build hash. Long enough to name a cache, short enough to read. */
const VERSION_LENGTH = 12;

/** One emitted file, reduced to the bytes that affect the cache name. */
interface BundleSource {
  /** Whether Vite emitted a JS chunk or a static asset. */
  type: 'chunk' | 'asset';
  /** Chunk source. */
  code?: string;
  /** Asset bytes. */
  source?: string | Uint8Array;
}

/** A file copied from `public/` into the build root. */
interface PublicFile {
  /** File name, relative to the build root. */
  name: string;
  /** File bytes. */
  bytes: Uint8Array;
}

/**
 * Path this service worker may answer, or null when the request is outside the app.
 * Main's worker scope contains the comparison apps, so only precached URLs are served;
 * everything else must fall through to the network.
 * @param scopeHref service worker scope, with a trailing slash
 * @param requestUrl absolute request URL
 * @param files precached paths, `./` for the shell
 * @returns the precached path, or null when the browser should handle the request
 */
export function cachedUrl(scopeHref: string, requestUrl: string, files: readonly string[]): string | null {
  const scope = new URL(scopeHref);
  const url = new URL(requestUrl);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
    return null;
  }
  const relative = url.pathname.slice(scope.pathname.length);
  const path = relative === '' || relative === 'index.html' ? './' : `./${relative}`;
  return files.includes(path) ? path : null;
}

/**
 * Content hash and precache list for one build.
 * Source maps and the worker script itself are omitted; the shell is cached as `./`
 * so a seed-code query is the same page. The hash still covers `index.html`.
 * @param bundle emitted build files
 * @param publicFiles files copied from `public/`
 * @returns the cache version and the URLs to precache
 */
export function offlineManifest(
  bundle: Iterable<[string, BundleSource]>,
  publicFiles: readonly PublicFile[],
): { version: string; files: string[] } {
  const built = [...bundle]
    .filter(([name]) => name !== 'sw.js' && !name.endsWith('.map'))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const hash = createHash('sha256');
  for (const [name, file] of built) {
    hash.update(name);
    hash.update('\0');
    hash.update(file.type === 'chunk' ? file.code ?? '' : file.source ?? '');
  }
  const extras = [...publicFiles].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const file of extras) {
    hash.update(file.name);
    hash.update('\0');
    hash.update(file.bytes);
  }
  const version = hash.digest('hex').slice(0, VERSION_LENGTH);
  const files = [
    './',
    ...built.filter(([name]) => name !== 'index.html').map(([name]) => `./${name}`),
    ...extras.map((file) => `./${file.name}`),
  ];
  return { version, files };
}

/** Reads `public/` from the project root. */
export function readPublicFiles(): PublicFile[] {
  return readdirSync('public', { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join('public', name)) }));
}

/**
 * Service worker source. It opens one named cache, deletes only previous caches
 * with this app's prefix, and answers only the precached URLs.
 * @param version content hash of the build
 * @param files precached URLs, relative to the app root
 * @returns the script
 */
export function serviceWorkerSource(version: string, files: readonly string[]): string {
  return `
const PREFIX = '${CACHE_PREFIX}';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};
${cachedUrl.toString()}

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
`;
}

/** Emits `sw.js` for a production build. */
export function offlinePlugin(): Plugin {
  return {
    name: 'stumped-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const { version, files } = offlineManifest(Object.entries(bundle), readPublicFiles());
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: serviceWorkerSource(version, files),
        });
      },
    },
  };
}
