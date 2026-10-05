import { defineConfig, devices } from '@playwright/test';

/** Override when another Vite app already has 5173. */
const port = process.env.STUMPED_PORT ?? '5173';
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Playwright configuration for end-to-end / visual tests.
 *
 * Tests live in `e2e/` (kept separate from the Vitest unit tests in `tests/`).
 * The dev server is started automatically and reused if already running.
 *
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  // Use a distinct suffix so these never collide with the Vitest unit tests.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  reporter: 'list',

  use: {
    baseURL,
    // Capture a trace on first retry to aid debugging failures.
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // Start the Vite dev server for tests, reusing one if already running.
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
