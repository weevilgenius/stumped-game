import { expect, test } from '@playwright/test';
import type { AdventureSave } from '../src/adventurePlay';
import { STARTERS } from '../src/adventure/content/campaign';

test('starts a campaign run on the map, travels to a fight, and resumes it after reload', async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'New run character' });
  await expect(selector.locator('option')).toHaveCount(STARTERS.length);
  await selector.selectOption('herbalist');
  await expect(page.getByRole('button', { name: 'New run', exact: true })).toBeDisabled();
  await selector.selectOption('scout');
  await expect(page.locator('#adventureLoadoutDescription')).toHaveText(STARTERS[1].description);
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const readSave = (): Promise<AdventureSave> => page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
  expect((await readSave()).state.character).toBe('scout');
  // Every first-column node is a fight.
  await page.getByRole('button', { name: /^Fight, danger 1, travel here/ }).first().click();
  await expect(page.locator('#adventurePanel')).toContainText('Flee');
  await page.getByRole('button', { name: /Next puzzle/ }).click();
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  expect((await readSave()).state.phase).toBe('round');
});
