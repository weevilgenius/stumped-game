import { expect, test } from '@playwright/test';
import type { Game } from '../src/game';
import type { AdventureSave } from '../src/adventurePlay';
import { LOADOUT_DESCRIPTIONS, LOADOUTS } from '../src/adventure/content/loadouts';

test('selects simulator loadouts, describes them, and preserves each run through reload and replacement', async ({ page }, testInfo) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'New run loadout' });
  await expect(selector.locator('option')).toHaveCount(LOADOUTS.length + 3);
  for (const definition of LOADOUTS) {
    await selector.selectOption(definition.id);
    await expect(page.locator('#adventureLoadoutDescription')).toHaveText(LOADOUT_DESCRIPTIONS[definition.id]);
    if (definition.id === 'specialist') {
      await page.screenshot({ path: `screenshots/adventure-${testInfo.project.name}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'New run', exact: true }).click();
    if (definition !== LOADOUTS[0]) {
      await page.locator('#confirmation').getByRole('button', { name: 'Continue', exact: true }).click();
    }
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

test('campaign route, tactical cards, and free readiness survive reload', async ({ page }, testInfo) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('combobox', { name: 'New run loadout' }).selectOption('ranger');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await expect(page.locator('#campaign')).toContainText("The Warden's trail");
  await expect(page.locator('#adventureContinue')).toBeHidden();
  await expect(page.locator('#campaign .campaign-column')).toHaveCount(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `screenshots/campaign-map-${testInfo.project.name}.png`, fullPage: true });
  await page.locator('#campaign .campaign-map button:enabled').first().click();
  await expect(page.locator('#campaign')).toContainText('Your pulse lands first.');
  await page.getByRole('button', { name: 'Next puzzle', exact: false }).click();
  await expect(page.locator('#game canvas')).toBeVisible();
  const item = page.getByRole('button', { name: /^Shortbow, ready/ });
  await item.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: 'Adventure details' });
  await expect(card).toContainText('1–3 squares: 2');
  await expect(card).toContainText('4–7 squares: 3');
  await card.getByRole('button', { name: 'Unready', exact: true }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: /^Shortbow, not ready/ })).toBeAttached();
  await page.getByRole('button', { name: 'Inspect encounter and consumables' }).focus();
  await page.keyboard.press('Enter');
  await expect(card).toContainText('Harvest colors');
  await expect(card).toContainText('Your pulse lands first');
  await page.screenshot({ path: `screenshots/campaign-card-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
  expect(save.state.campaign?.node).toMatch(/^0-/);
  expect(save.state.slots[0].ready).toBe(false);
  expect(save.puzzles?.[0].settings).toMatchObject({ size: 9, tier: 'medium', freebies: 0 });
  expect(save.puzzles?.[0].code).toBe(save.game?.puzzle.code);
  await page.getByRole('button', { name: 'Menu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Flee/ })).toHaveCount(0);
  await expect(page.locator('#campaign .campaign-map button:enabled')).toHaveCount(0); // Cannot flee mid-puzzle.
  await page.getByRole('button', { name: 'Give up', exact: true }).click();
  await page.locator('#confirmation').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#adventureInfo')).toContainText('You gave up');
});

test('campaign loot, equipment, and forward travel work after an actual fight', async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('combobox', { name: 'New run loadout' }).selectOption('ranger');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.locator('#campaign .campaign-map button:enabled').first().click();
  for (let puzzle = 0; puzzle < 2; puzzle++) {
    await page.locator('#adventureContinue').click();
    await expect(page.getByRole('gridcell')).toHaveCount(81);
    await page.waitForFunction(() => {
      const current = window as unknown as { stumped?: { model: Game }; controller: { adventure: { game: Game } } };
      return current.stumped?.model.id === current.controller.adventure.game.id && current.stumped.model.status === 'playing';
    });
    const cells = await page.evaluate(() => {
      const { model } = (window as unknown as { stumped: { model: Game } }).stumped;
      return [...model.puzzle.solution].sort((a, b) => model.puzzle.colors[model.puzzle.regions[a]] - model.puzzle.colors[model.puzzle.regions[b]]);
    });
    for (const cell of cells) {
      await page.getByRole('gridcell').nth(cell).focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('#game')).toBeHidden({ timeout: 15000 });
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
    if (!save.state.encounter) break;
  }
  await expect(page.locator('#campaign')).toContainText('Loot · take what fits');
  const loot = page.locator('#campaign details').filter({ has: page.getByRole('button', { name: /^Take /, includeHidden: true }) }).first();
  await loot.locator('summary').click();
  await loot.getByRole('button', { name: /^Take / }).click();
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
  expect(save.state.slots).toHaveLength(3);
  expect(save.state.campaign!.gear).toBe(1);
  await page.reload();
  await expect(page.locator('#campaign')).toContainText('1 gear found');
  await page.locator('#campaign .campaign-map button:enabled').first().click();
  await expect(page.locator('#campaign')).not.toContainText('Loot · take what fits');
});
