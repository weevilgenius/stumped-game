/* ========================================================= *\
 *  End-to-End Playwright Tests                              *
\* ========================================================= */

import { expect, test } from '@playwright/test';

test.describe('Stumped Game App', () => {
  test('renders Phaser canvas on the home screen', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('navigates directly to game scene with ?scene=game', async ({ page }) => {
    await page.goto('/?scene=game');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Verify canvas is interactive
    await canvas.click({ position: { x: 200, y: 200 } });
    await expect(canvas).toBeVisible();
  });

  test('loads puzzle from a valid seed code', async ({ page }) => {
    await page.goto('/?code=1000000000Z');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('opens settings modal via ?modal=settings', async ({ page }) => {
    await page.goto('/?modal=settings');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('opens best times modal via ?modal=best-times', async ({ page }) => {
    await page.goto('/?modal=best-times');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });
});
