import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const openPuzzle = async (page: Page): Promise<void> => {
  await page.goto('/?code=1D580000048');
  await expect(page.locator('[data-action="help"]')).toBeVisible();
};

/** Tap the canvas at its semantic control's bounds, exercising Phaser's pointer handling. */
const tapControl = async (page: Page, name: string, touch = false): Promise<void> => {
  const bounds = (await page.locator('[data-action="' + name + '"]').boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  if (touch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
};

test('puzzle full screen toggles beside help and follows browser exits', async ({ page, isMobile }) => {
  // Mobile emulation cannot reproduce Android's system bars or edge gestures.
  test.skip(isMobile, 'Exercise the real Fullscreen API in desktop Chromium.');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter full screen', exact: true })).toHaveCount(0);
  await openPuzzle(page);
  const enter = page.getByRole('button', { name: 'Enter full screen', exact: true });
  const exit = page.getByRole('button', { name: 'Exit full screen', exact: true });
  const fullscreenBounds = (await enter.boundingBox())!;
  const helpBounds = (await page.locator('[data-action="help"]').boundingBox())!;
  expect(fullscreenBounds.y).toBe(helpBounds.y);
  expect(fullscreenBounds.x + fullscreenBounds.width).toBeLessThan(helpBounds.x);
  await tapControl(page, 'fullscreen');
  await expect(exit).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await tapControl(page, 'fullscreen');
  await expect(enter).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  // Keyboard access uses the same action as the visible canvas button.
  await enter.press('Enter');
  await expect(exit).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect(enter).toBeVisible();
  await expect(page.locator('#game canvas')).toBeVisible();
});

test('devices without full screen omit the puzzle control', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
  });
  await openPuzzle(page);
  await expect(page.locator('[data-action="fullscreen"]')).toHaveCount(0);
  await expect(page.locator('[data-action="help"]')).toBeVisible();
});

test('a denied puzzle full-screen request reports failure and allows retry', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Denied'));
  });
  await openPuzzle(page);
  const enter = page.getByRole('button', { name: 'Enter full screen', exact: true });
  await tapControl(page, 'fullscreen', isMobile);
  await expect(page.locator('#fullscreenStatus')).toHaveText('Could not enter full screen.');
  await expect(enter).toHaveAttribute('aria-disabled', 'false');
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement });
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
  await tapControl(page, 'fullscreen', isMobile);
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeVisible();
  await expect(page.locator('#fullscreenStatus')).toBeEmpty();
});
