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

test('main screen is ready', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'main');
  await expect(page.locator('canvas')).toBeVisible();
});

test('a new puzzle opens the board', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__stumped?.ready);
  await page.evaluate(() => {
    window.__stumped?.setSize(5);
    window.__stumped?.setTier('easy');
  });
  await page.evaluate(() => window.__stumped?.startNew());
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'puzzle');
  await expect(page.locator('#app')).toHaveAttribute('data-stumps', /\d\/5/);
});

test('a seed link reopens that puzzle', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__stumped?.ready);
  await page.evaluate(() => {
    window.__stumped?.setSize(5);
    window.__stumped?.setTier('easy');
  });
  await page.evaluate(() => window.__stumped?.startNew());
  const code = await page.locator('#app').getAttribute('data-code');
  expect(code).toBeTruthy();
  await page.goto(`/?code=${code}`);
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'puzzle');
  await expect(page.locator('#app')).toHaveAttribute('data-code', code ?? '');
});
