import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { env } from 'node:process';

// https://vite.dev/config/
export default defineConfig(({ command }) => {

  const plugins: PluginOption[] = [];

  if (command === 'build' && env.ANALYZE === '1') {
    // add the visualizer to see the module break-down
    plugins.push(
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap', // Report type: sunburst, treemap, network, raw-data, list, markdown, flamegraph
        open: true,
        gzipSize: true,
        brotliSize: true,
      }) as PluginOption
    );
  }

  // strip HTML comments from index.html
  plugins.push(
    {
      name: 'strip-html-comments',
      transformIndexHtml(html) {
        return html.replace(/<!--[\s\S]*?-->\n?/g, '');
      },
    },
    {
      name: 'stumped-service-worker',
      apply: 'build',
      generateBundle(_options, bundle) {
        const assets = ['./', './index.html', './manifest.webmanifest', './icon-512.jpg'];
        for (const fileName of Object.keys(bundle)) {
          assets.push(`./${fileName}`);
        }
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: serviceWorker(assets),
        });
      },
    },
  );

  const config: UserConfig = {
    plugins,
    // relative asset URLs so the build works from any subpath (e.g. GitHub Pages)
    base: './',
    build: {
      // browser target
      target: 'baseline-widely-available',
      // build stand-alone source maps
      sourcemap: true,
      // Clean the output directory before each build.
      emptyOutDir: true,
      rolldownOptions: {
        output: {

          // uncomment if you need to break libraries out into separate files for caching
          // codeSplitting: {
          //   groups: [
          //     {
          //       name: (id: string): string | null => {
          //         if (!id.includes('node_modules')) {
          //           return null;
          //         }
          //         if (/node_modules[/\\]mithril/.test(id)) {
          //           return 'mithril';
          //         }
          //         if (/node_modules[/\\]@awesome\.me[/\\]webawesome[/\\]/.test(id)) {
          //           return 'webawesome';
          //         }
          //         if (/node_modules[/\\](lit|@lit|lit-html|lit-element)[/\\]/.test(id)) {
          //           return 'webawesome';
          //         }
          //         if (/node_modules[/\\]@floating-ui[/\\]/.test(id)) {
          //           return 'webawesome';
          //         }
          //         if (/node_modules[/\\]firebase[/\\]/.test(id)) {
          //           return 'firebase';
          //         }
          //         return null;
          //       },
          //       test: /node_modules[/\\]/,
          //     },
          //   ],
          // },

        },
      },
    },
  };

  return config;
});

/**
 * A small offline cache. The built file names are hashed, so the list is
 * written at build time and the old cache is dropped on the next install.
 * Cache names carry a `stumped-grok-` prefix and only those caches are touched,
 * so other apps hosted on the same origin keep their offline caches.
 * @param assets paths to precache
 * @returns the service worker source
 */
function serviceWorker(assets: readonly string[]): string {
  return `const PREFIX = 'stumped-grok-';
const CACHE = PREFIX + '${Date.now()}';
const ASSETS = ${JSON.stringify(assets)};
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
`;
}
