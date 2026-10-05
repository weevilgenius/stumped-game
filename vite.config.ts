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
    }
  );

  const config: UserConfig = {
    plugins,
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
