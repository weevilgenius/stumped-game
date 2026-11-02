import { test, expect } from '@playwright/test';

test('full screen covers the menu and puzzle, and follows browser exits', async ({ page, isMobile }) => {
  // Mobile emulation cannot reproduce Android's system bars or edge gestures.
  test.skip(isMobile, 'Exercise the real Fullscreen API in desktop Chromium.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const enter = page.getByRole('button', { name: 'Enter full screen', exact: true });
  const exit = page.getByRole('button', { name: 'Exit full screen', exact: true });
  await enter.click();
  await expect(exit).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await exit.click();
  await expect(enter).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await enter.click();
  await expect(exit).toBeEnabled();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('textbox', { name: 'Seed code', exact: true }).fill('1D580000048');
  await page.getByRole('button', { name: 'Play code', exact: true }).click();
  await expect(page.locator('#game canvas')).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  // Browser/system exits must update the control even while Settings is closed.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator('#fullscreenButton')).toHaveText('Enter full screen');
  await expect(page.locator('#game canvas')).toBeVisible();
});

test('devices without full screen keep the control hidden', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#fullscreenControls')).toBeHidden();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#settings')).toBeHidden();
});

test('a denied full-screen request reports failure and allows retry', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { get: () => true });
    Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Denied'));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const enter = page.getByRole('button', { name: 'Enter full screen', exact: true });
  await enter.click();
  await expect(page.locator('#fullscreenStatus')).toHaveText('Could not enter full screen.');
  await expect(enter).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement });
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
  await enter.click();
  await expect(page.getByRole('button', { name: 'Exit full screen', exact: true })).toBeEnabled();
  await expect(page.locator('#fullscreenStatus')).toBeEmpty();
});
