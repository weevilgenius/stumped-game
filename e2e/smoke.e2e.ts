import { test, expect } from '@playwright/test';

/**
 * Functional end-to-end smoke tests.
 *
 * These assert behaviour/structure (not pixels), so they are stable across
 * platforms and need no committed baseline images. Each test runs on both a
 * desktop and a mobile viewport (see the projects in playwright.config.ts).
 *
 * For visual inspection (light/dark mode, layout), use `pnpm screenshot`
 * and view the resulting PNG rather than pixel-diff assertions.
 */

test('home page renders its heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
