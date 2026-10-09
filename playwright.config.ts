import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for end-to-end / visual tests.
 *
 * Tests live in `e2e/` (kept separate from the Vitest unit tests in `tests/`).
 * The dev server is started automatically and reused if already running.
 *
 * https://playwright.dev/docs/test-configuration
 */
/** Dev server address. Set PORT when 5173 belongs to another project. */
const BASE_URL = `http://localhost:${process.env.PORT ?? 5173}`;

/** Where the production build is served for the offline test. Set PREVIEW_PORT to move it. */
const PREVIEW_PORT = process.env.PREVIEW_PORT ?? 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

/** The offline test needs the service worker, which only the production build has. */
const OFFLINE_TEST = '**/offline.e2e.ts';

export default defineConfig({
  testDir: './e2e',
  // Use a distinct suffix so these never collide with the Vitest unit tests.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  reporter: 'list',

  use: {
    baseURL: BASE_URL,
    // Capture a trace on first retry to aid debugging failures.
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: OFFLINE_TEST,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testIgnore: OFFLINE_TEST,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'offline',
      testMatch: OFFLINE_TEST,
      use: { ...devices['Pixel 7'], baseURL: PREVIEW_URL },
    },
  ],

  webServer: [
    // Start the Vite dev server for tests, reusing one if already running.
    {
      command: 'pnpm dev',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    // Build and serve the production app for the offline test. Never reused, so the build is current.
    {
      command: `pnpm build && pnpm preview --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
