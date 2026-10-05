import { test, expect } from '@playwright/test';

/**
 * Offline end-to-end test. Runs against the production build (see the
 * `offline` project in playwright.config.ts): the service worker that makes
 * the app work with no connection is only part of that build.
 */

test('the installed app starts and plays with no connection', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#game canvas')).toBeVisible();

  // A link with a seed code is the same cached page with a query.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.goto('./?code=10580000026');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stumped.game'))).toContain('10580000026');
});
