import { runInNewContext } from 'node:vm';
import { cachedUrl, offlineManifest, readPublicFiles, serviceWorkerSource } from './offline';

const SCOPE = 'https://weevilgenius.github.io/stumped-game/';
const FILES = ['./', './assets/index.js', './assets/worker-abc.js', './manifest.webmanifest', './icon-192.png'];

const bundle = {
  'index.html': { type: 'asset' as const, source: '<html>shell</html>' },
  'assets/index.js': { type: 'chunk' as const, code: 'app' },
  'assets/worker-abc.js': { type: 'chunk' as const, code: 'worker' },
  'assets/index.js.map': { type: 'asset' as const, source: 'map' },
  'sw.js': { type: 'asset' as const, source: 'old worker' },
};
const icons = [{ name: 'icon-192.png', bytes: new Uint8Array([1, 2, 3]) }];

describe('offline manifest', () => {
  it('precaches the shell, built files, and public files under a content hash', () => {
    const manifest = offlineManifest(Object.entries(bundle), icons);
    expect(manifest.version).toMatch(/^[0-9a-f]{12}$/);
    expect(manifest.files).toEqual([
      './',
      './assets/index.js',
      './assets/worker-abc.js',
      './icon-192.png',
    ]);
  });

  it('keeps the same version for the same bytes and changes it when they change', () => {
    const first = offlineManifest(Object.entries(bundle), icons);
    expect(offlineManifest(Object.entries(bundle), icons).version).toBe(first.version);
    const changedHtml = offlineManifest(Object.entries({
      ...bundle,
      'index.html': { type: 'asset' as const, source: '<html>edited</html>' },
    }), icons);
    const changedWorker = offlineManifest(Object.entries({
      ...bundle,
      'assets/worker-abc.js': { type: 'chunk' as const, code: 'worker-2' },
    }), icons);
    const changedIcon = offlineManifest(Object.entries(bundle), [{ name: 'icon-192.png', bytes: new Uint8Array([9]) }]);
    expect(new Set([first.version, changedHtml.version, changedWorker.version, changedIcon.version]).size).toBe(4);
  });

  it('includes the real public icons and manifest', () => {
    expect(readPublicFiles().map((file) => file.name)).toEqual([
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'manifest.webmanifest',
    ]);
  });
});

describe('cached app URLs', () => {
  const address = (path: string): string => new URL(path, SCOPE).href;

  it('serves the shell and the app assets, including a seed-code query', () => {
    expect(cachedUrl(SCOPE, address('?code=10580000026'), FILES)).toBe('./');
    expect(cachedUrl(SCOPE, address('index.html'), FILES)).toBe('./');
    expect(cachedUrl(SCOPE, address('assets/worker-abc.js'), FILES)).toBe('./assets/worker-abc.js');
    expect(cachedUrl(SCOPE, address('icon-192.png?v=1'), FILES)).toBe('./icon-192.png');
  });

  it('leaves comparison apps and other origins to the network', () => {
    expect(cachedUrl(SCOPE, address('gemini/'), FILES)).toBeNull();
    expect(cachedUrl(SCOPE, address('gemini/index.html'), FILES)).toBeNull();
    expect(cachedUrl(SCOPE, address('grok/assets/index.js'), FILES)).toBeNull();
    expect(cachedUrl(SCOPE, address('fable/'), FILES)).toBeNull();
    expect(cachedUrl(SCOPE, address('astra/'), FILES)).toBeNull();
    expect(cachedUrl(SCOPE, 'https://weevilgenius.github.io/favicon.ico', FILES)).toBeNull();
    expect(cachedUrl(SCOPE, 'https://example.com/stumped-game/', FILES)).toBeNull();
    expect(cachedUrl('http://localhost:4173/', 'http://localhost:4173/gemini/', FILES)).toBeNull();
  });
});

describe('generated service worker', () => {
  const source = serviceWorkerSource('abc123abc123', FILES);

  const load = (): {
    fire: (type: 'install' | 'activate' | 'fetch', event: object) => Promise<unknown>;
    opened: string[];
    deleted: string[];
    matched: string[];
  } => {
    const opened: string[] = [];
    const deleted: string[] = [];
    const matched: string[] = [];
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const sandbox = {
      URL,
      Response,
      Promise,
      self: {
        registration: { scope: SCOPE },
        skipWaiting: (): Promise<void> => Promise.resolve(),
        clients: { claim: (): Promise<void> => Promise.resolve() },
        addEventListener: (type: string, listener: (event: Record<string, unknown>) => void): void => {
          listeners.set(type, listener);
        },
      },
      caches: {
        open: (name: string): Promise<object> => {
          opened.push(name);
          return Promise.resolve({
            addAll: (): Promise<void> => Promise.resolve(),
            match: (target: URL | { url: string }): Promise<Response> => {
              matched.push(target instanceof URL ? target.href : target.url);
              return Promise.resolve(new Response('cached'));
            },
          });
        },
        keys: (): Promise<string[]> => Promise.resolve([
          'stumped-main-old',
          'stumped-main-abc123abc123',
          'stumped-grok-keep',
          'stumped-fable-keep',
          'stumped-astra-keep',
          'other-app',
        ]),
        delete: (name: string): Promise<boolean> => {
          deleted.push(name);
          return Promise.resolve(true);
        },
      },
      fetch: (): Promise<Response> => Promise.reject(new Error('network')),
    };
    runInNewContext(source, sandbox);
    return {
      opened,
      deleted,
      matched,
      fire: (type, event) => new Promise((resolve, reject) => {
        const listener = listeners.get(type);
        if (!listener) {
          reject(new Error(`no ${type} listener`));
          return;
        }
        let settled = false;
        listener({
          ...event,
          waitUntil: (work: Promise<unknown>) => {
            work.then(resolve, reject);
            settled = true;
          },
          respondWith: (work: Promise<unknown>) => {
            work.then(resolve, reject);
            settled = true;
          },
        });
        if (!settled) {
          resolve(undefined);
        }
      }),
    };
  };

  it('opens only its named cache and deletes only its own previous caches', async () => {
    expect(source).not.toContain('caches.match');
    const worker = load();
    await worker.fire('install', {});
    await worker.fire('activate', {});
    expect(worker.opened).toEqual(['stumped-main-abc123abc123']);
    expect(worker.deleted).toEqual(['stumped-main-old']);
  });

  it('answers the shell and app assets, and does not answer comparison pages', async () => {
    const worker = load();
    const request = (url: string, method = 'GET'): { method: string; url: string } => ({ method, url });
    await worker.fire('fetch', { request: request(`${SCOPE}?code=10580000026`) });
    await worker.fire('fetch', { request: request(`${SCOPE}assets/worker-abc.js`) });
    await worker.fire('fetch', { request: request(`${SCOPE}gemini/`) });
    await worker.fire('fetch', { request: request(`${SCOPE}astra/index.html`) });
    await worker.fire('fetch', { request: request(`${SCOPE}grok/assets/index.js`) });
    await worker.fire('fetch', { request: request(SCOPE, 'POST') });
    expect(worker.opened).toEqual(['stumped-main-abc123abc123', 'stumped-main-abc123abc123']);
    expect(worker.matched).toEqual([SCOPE, `${SCOPE}assets/worker-abc.js`]);
  });
});
