import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AdventureSave } from '../src/adventurePlay';

interface Camp {
  spot: (name: string) => { x: number; y: number } | null;
}

/** Taps a camp canvas control, found through the accessible button that mirrors it. */
const tap = async (page: Page, label: string | RegExp): Promise<void> => {
  const name = await page.getByRole('button', { name: label }).first().getAttribute('data-action');
  const at = await page.evaluate((key) => (window as unknown as { camp: Camp }).camp.spot(key!), name);
  await page.mouse.click(at!.x, at!.y);
};

test('starts a campaign run on its own screen, travels to a fight, and resumes it after reload', async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('#adventureResume')).toBeHidden();
  await page.getByRole('button', { name: 'Start adventure' }).click();
  await expect(page.getByRole('button', { name: 'Herbalist: win a run to unlock' })).toHaveAttribute('aria-disabled', 'true');
  await tap(page, 'Start a run as Scout');
  const readSave = (): Promise<AdventureSave> => page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
  expect((await readSave()).state.character).toBe('scout');
  // Every first-column node is a fight.
  await tap(page, 'Travel to Fight, danger 1');
  await expect(page.getByRole('button', { name: 'Flee' })).toBeAttached();
  await tap(page, /Next puzzle/);
  await expect(page.locator('#game canvas')).toBeVisible();
  // A tap on a strip item toggles readiness; a long press opens its card.
  await page.waitForFunction(() => (window as unknown as { stumped?: { spots: Record<string, unknown> } }).stumped?.spots.slot0);
  const slot = await page.evaluate(() => (window as unknown as { stumped: { spots: Record<string, { x: number; y: number }> } }).stumped.spots.slot0);
  const ready = (await readSave()).state.slots[0].ready;
  await page.mouse.click(slot.x, slot.y);
  await expect.poll(async () => (await readSave()).state.slots[0].ready).toBe(!ready);
  await page.mouse.move(slot.x, slot.y);
  await page.mouse.down();
  await expect(page.locator('#adventureCard')).toBeVisible();
  await page.mouse.up();
  expect((await readSave()).state.slots[0].ready).toBe(!ready);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  expect((await readSave()).state.phase).toBe('round');
});
