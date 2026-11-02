import { expect, test } from '@playwright/test';
import type { AdventureSave } from '../src/adventurePlay';
import { LOADOUT_DESCRIPTIONS, LOADOUTS } from '../src/adventure/content/loadouts';

test('selects simulator loadouts, describes them, and preserves each run through reload and replacement', async ({ page }, testInfo) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'New run loadout' });
  await expect(selector.locator('option')).toHaveCount(LOADOUTS.length);
  page.on('dialog', (dialog) => void dialog.accept());
  for (const definition of LOADOUTS) {
    await selector.selectOption(definition.id);
    await expect(page.locator('#adventureLoadoutDescription')).toHaveText(LOADOUT_DESCRIPTIONS[definition.id]);
    if (definition.id === 'specialist') {
      await page.screenshot({ path: `screenshots/adventure-${testInfo.project.name}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'New run', exact: true }).click();
    await expect(page.locator('#game canvas')).toBeVisible();
    const readSave = (): Promise<AdventureSave> => page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
    expect((await readSave()).loadout).toEqual(definition);
    expect((await readSave()).state.slots.map((slot) => slot.item)).toEqual(definition.loadout);
    await page.reload();
    await expect(page.locator('#game canvas')).toBeVisible();
    expect((await readSave()).loadout).toEqual(definition);
    await page.waitForFunction(() => (window as unknown as { stumped?: { spots: { back?: unknown } } }).stumped?.spots.back);
    const { x, y } = await page.evaluate(() => (window as unknown as { stumped: { spots: { back: { x: number; y: number } } } }).stumped.spots.back);
    await page.mouse.click(x, y);
    await expect(page.locator('#adventureInfo')).toContainText(definition.id[0].toUpperCase() + definition.id.slice(1));
    // Selecting the next run's equipment must not change the run being continued.
    await selector.selectOption('wanderer');
    expect((await readSave()).loadout).toEqual(definition);
  }
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventureRuns')!) as AdventureSave[]);
  expect(history.map((run) => run.loadout?.id)).toEqual(LOADOUTS.slice(0, -1).map((loadout) => loadout.id));
});
