import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { readdirSync } from 'node:fs';
import { env } from 'node:process';

/**
 * Service worker source. It precaches every built file and answers from the
 * cache first, so the installed app starts and plays with no connection. Each
 * build gets its own cache, which replaces the previous one. Caches carry a
 * `stumped-fable-` prefix and only those are touched, so other apps hosted on
 * the same origin keep their offline caches.
 * @param version unique per build
 * @param files every file to cache, relative to the app root
 * @returns the script
 */
const serviceWorkerSource = (version: string, files: string[]): string => `
const PREFIX = 'stumped-fable-';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};

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
`;

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
    }
  );

  // emit the service worker that makes the app work offline
  plugins.push(
    {
      name: 'service-worker',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const built = Object.keys(bundle).filter((file) => !file.endsWith('.map') && file !== 'index.html');
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: serviceWorkerSource(Date.now().toString(36), ['./', ...built, ...readdirSync('public')]),
        });
      },
    }
  );

  const config: UserConfig = {
    plugins,
    // relative asset URLs, so the app can be hosted at any path
    base: './',
    server: {
      // Set PORT to run beside another project's dev server. Strict, so the
      // e2e tests and the screenshot tool never end up talking to the wrong app.
      port: Number(env.PORT ?? 5173),
      strictPort: true,
    },
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
