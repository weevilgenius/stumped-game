import { test, expect } from '@playwright/test';

test('history shows all releases and returns focus when dismissed', async ({ page }) => {
  await page.goto('./');
  const history = page.getByRole('button', { name: 'History', exact: true });
  await history.click();
  const dialog = page.getByRole('dialog', { name: 'History', exact: true });
  await expect(dialog.getByRole('heading', { name: '0.10.0', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '0.1.0', exact: true })).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(history).toBeFocused();
});

test('a failed load can be retried by reopening history', async ({ page }) => {
  await page.route('**/CHANGELOG.md', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('./');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('#changelogBody')).toContainText('Release notes could not be loaded');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.unroute('**/CHANGELOG.md');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('#changelogBody h3').first()).toHaveText('0.10.0');
});
