import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT ?? '5188';
const baseURL = `http://localhost:${port}`;

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
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
