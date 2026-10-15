import { defineConfig, type PluginOption, type UserConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { env } from 'node:process';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { offlinePlugin } from './scripts/offline.js';

// https://vite.dev/config/
export default defineConfig(async ({ command }) => {

  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short=7', 'HEAD'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
  });
  const commit = stdout.trim();

  const plugins: PluginOption[] = [];

  plugins.push({
    name: 'app-build-info',
    transformIndexHtml(html) {
      return html.replace('%APP_VERSION%', version).replace('%APP_COMMIT%', commit);
    },
  });

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

  // Precache the build, including the puzzle worker, under a content-hashed cache.
  plugins.push(offlinePlugin());

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

          // break libraries out into separate files for caching
          codeSplitting: {
            groups: [
              {
                name: (id: string): string | null => {
                  if (!id.includes('node_modules')) {
                    return null;
                  }
                  if (/node_modules[/\\]phaser/.test(id)) {
                    return 'phaser';
                  }
                  return null;
                },
                test: /node_modules[/\\]/,
              },
            ],
          },

        },
      },
    },
  };

  return config;
});
