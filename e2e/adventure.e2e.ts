import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { newGame } from '../src/game';
import type { Game } from '../src/game';
import type { AdventureSave } from '../src/adventurePlay';
import { generate } from '../src/engine';
import { createCampaign, startRun, step } from '../src/adventure/engine';
import { STARTERS } from '../src/adventure/content/campaign';

/** Wait for the current scene to finish its redraw and navigation double-tap guard. */
const ready = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const scene = (window as unknown as { adventureScene?: { sys: { isActive: () => boolean }; dirty: boolean; blockedUntil: number } }).adventureScene;
    return scene?.sys.isActive() && !scene.dirty && performance.now() >= scene.blockedUntil;
  });
};
const activate = async (page: Page, button: string | RegExp | Locator): Promise<void> => {
  await ready(page);
  const target = typeof button === 'string' || button instanceof RegExp ? page.getByRole('button', { name: button, exact: typeof button === 'string' }) : button;
  await target.focus(); await page.keyboard.press('Enter');
};
const enable = async (page: Page): Promise<void> => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Show adventure mode').check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
};
const readSave = (page: Page): Promise<AdventureSave> => page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.adventure')!) as AdventureSave);
const start = async (page: Page, character = 'Ranger'): Promise<void> => {
  await page.getByRole('button', { name: 'Start adventure', exact: true }).click();
  await activate(page, `Choose ${character}`);
  await activate(page, 'Start campaign');
  await expect(page.getByRole('heading', { name: character, exact: true })).toBeAttached();
};

test('home has only start/resume; Phaser selection preserves the old run until replacement is confirmed', async ({ page }, info) => {
  await enable(page);
  await expect(page.locator('#adventure button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Resume adventure' })).toBeDisabled();
  await page.getByRole('button', { name: 'Start adventure', exact: true }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#game canvas')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Start an adventure' })).toBeAttached();
  await page.screenshot({ path: `screenshots/adventure-select-${info.project.name}.png` });
  await activate(page, 'Choose Sentinel');
  await activate(page, 'Start campaign');
  expect((await readSave(page)).state.character).toBe('sentinel');
  await activate(page, 'Home');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#adventure button')).toHaveCount(2);
  await expect(page.locator('.accessible-adventure')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start adventure', exact: true }).click();
  await activate(page, 'Choose Ranger');
  expect((await readSave(page)).state.character).toBe('sentinel');
  await activate(page, 'Start campaign');
  await page.locator('#confirmation').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await readSave(page)).state.character).toBe('sentinel');
  await activate(page, 'Home');
  await page.getByRole('button', { name: 'Resume adventure' }).click();
  await expect(page.getByRole('heading', { name: 'Sentinel', exact: true })).toBeAttached();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sentinel', exact: true })).toBeAttached();
});

test('route, equipment and an unfinished puzzle resume through separate canvas screens', async ({ page }, info) => {
  await enable(page); await start(page);
  await ready(page);
  const route = page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first();
  const bounds = await route.boundingBox();
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await ready(page);
  await expect(page.getByRole('button', { name: 'Fight', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Next puzzle', exact: true })).toHaveCount(0);
  await page.screenshot({ path: `screenshots/adventure-fight-${info.project.name}.png` });
  await activate(page, page.locator('.accessible-adventure [data-action="play"]'));
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  await page.getByRole('button', { name: /^Shortbow, ready/ }).focus(); await page.keyboard.press('Shift+Enter');
  const card = page.getByRole('dialog', { name: 'Adventure details' });
  await expect(card).toContainText('1–3 squares: 2');
  await card.getByRole('button', { name: 'Unready', exact: true }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.accessible-puzzle')).toHaveCount(0);
  await activate(page, 'Gear');
  await activate(page, page.locator('.accessible-adventure [data-action="inspect-slot-0"]'));
  await expect(page.getByRole('heading', { name: 'Shortbow', exact: true })).toBeAttached();
  await page.screenshot({ path: `screenshots/adventure-gear-${info.project.name}.png` });
  await page.reload();
  await expect(page.locator('.accessible-adventure')).toBeAttached();
  expect((await readSave(page)).state.slots[0].ready).toBe(false);
  expect((await readSave(page)).view).toBe('campaign');
  await activate(page, 'Home');
  await page.getByRole('button', { name: 'Resume adventure' }).click();
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  await expect(page.locator('#game canvas')).toHaveCount(1);
});

test('item and skill taps toggle readiness while holds inspect without toggling', async ({ page }, info) => {
  test.setTimeout(60_000);
  await enable(page); await start(page); await activate(page, 'Gear');
  const touch = info.project.name === 'mobile-chromium' ? await page.context().newCDPSession(page) : null;
  const down = async (target: Locator): Promise<{ x: number; y: number }> => {
    const bounds = await target.boundingBox();
    const spot = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [spot] });
    else { await page.mouse.move(spot.x, spot.y); await page.mouse.down(); }
    return spot;
  };
  const up = async (): Promise<void> => {
    if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
  };
  const gear = page.locator('.accessible-adventure [data-action="ready-0"]');
  await ready(page); await down(gear); await up();
  await expect.poll(async () => (await readSave(page)).state.slots[0].ready).toBe(false);
  await ready(page); await down(gear);
  await expect(page.getByRole('heading', { name: 'Shortbow', exact: true })).toBeAttached();
  await up(); expect((await readSave(page)).state.slots[0].ready).toBe(false);
  await activate(page, 'Back'); await ready(page);
  const spot = await down(gear);
  if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: spot.x + 35, y: spot.y }] });
  else await page.mouse.move(spot.x + 35, spot.y);
  await up(); expect((await readSave(page)).state.slots[0].ready).toBe(false);
  await gear.focus(); await page.keyboard.press('Space');
  await expect.poll(async () => (await readSave(page)).state.slots[0].ready).toBe(true);
  await ready(page); await gear.focus(); await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('heading', { name: 'Shortbow', exact: true })).toBeAttached();
  expect((await readSave(page)).state.slots[0].ready).toBe(true);
  await activate(page, 'Back');
  await page.screenshot({ path: `screenshots/adventure-tap-gear-${info.project.name}.png` });
  await activate(page, 'Map');
  await activate(page, page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first());
  await activate(page, page.locator('.accessible-adventure [data-action="play"]'));
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  const card = page.getByRole('dialog', { name: 'Adventure details' });
  for (const [slot, name] of ['Shortbow', 'Parry'].entries()) {
    const item = page.locator(`.accessible-puzzle [data-action="slot${slot}"]`);
    await down(item); await up();
    await expect.poll(async () => (await readSave(page)).state.slots[slot].ready).toBe(false);
    await expect(card).not.toBeVisible();
    await down(item); await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name, exact: true })).toBeVisible();
    await up(); expect((await readSave(page)).state.slots[slot].ready).toBe(false);
    await card.getByRole('button', { name: 'Back to puzzle', exact: true }).click();
  }
  // Tapping the backdrop over a hint button only dismisses the card.
  await down(page.locator('.accessible-puzzle [data-action="slot0"]')); await expect(card).toBeVisible(); await up();
  const box = (await card.boundingBox())!;
  const hints = await Promise.all(['woodpecker', 'owl', 'squirrel'].map((name) => page.locator(`.accessible-puzzle [data-action="${name}"]`).boundingBox()));
  const hintSpot = hints.map((b) => ({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }))
    .find(({ x, y }) => x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height)!;
  if (touch) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [hintSpot] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.mouse.click(hintSpot.x, hintSpot.y);
  await expect(card).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { stumped: { model: Game } }).stumped.model.hints)).toEqual([]);
});

test('loot and forward travel follow an actual fight, with new preparation screens after each puzzle', async ({ page }) => {
  await enable(page); await start(page);
  await activate(page, page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first());
  for (let puzzle = 0; puzzle < 2; puzzle++) {
    if ((await readSave(page)).state.encounter?.phase === 'active') {
      await expect(page.getByRole('button', { name: puzzle === 0 ? 'Fight' : 'Continue Fight', exact: true })).toBeAttached();
    }
    await activate(page, page.locator('.accessible-adventure [data-action="play"]'));
    await page.waitForFunction(() => {
      const w = window as unknown as { stumped?: { model: Game; sys: { isActive: () => boolean } }; controller: { adventure: { game: Game } } };
      return w.stumped?.sys.isActive() && w.stumped.model.id === w.controller.adventure.game.id && w.stumped.model.status === 'playing';
    });
    const cells = await page.evaluate(() => {
      const { model } = (window as unknown as { stumped: { model: Game } }).stumped;
      return [...model.puzzle.solution].sort((a, b) => model.puzzle.colors[model.puzzle.regions[a]] - model.puzzle.colors[model.puzzle.regions[b]]);
    });
    for (const cell of cells) { await page.getByRole('gridcell').nth(cell).focus(); await page.keyboard.press('Enter'); }
    await expect(page.locator('.accessible-adventure')).toBeAttached({ timeout: 20000 });
    if (!(await readSave(page)).state.encounter) break;
  }
  await activate(page, 'Here');
  await activate(page, page.locator('.accessible-adventure [data-action^="take-"]:enabled').first());
  expect((await readSave(page)).state.slots).toHaveLength(3);
  await activate(page, 'Map');
  await activate(page, page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first());
  expect((await readSave(page)).state.campaign!.loot).toHaveLength(0);
});

test('finishing postcombat scavenging opens loot and keeps the next puzzle playable without reloading', async ({ page }) => {
  await enable(page);
  const start = startRun(STARTERS[0]); start.campaign = createCampaign(7);
  let state = step(start, { type: 'travel', node: '0-0' }).state;
  // Make the first reveal win a real fight so the remaining reveals scavenge.
  if (state.encounter?.type !== 'enemy') throw new Error('Expected a fight');
  state.encounter.health = 1;
  state.slots[0] = { ...state.slots[0], item: { ...state.slots[0].item, colors: [0, 1, 2, 3, 4, 5, 6, 7, 8] } };
  const puzzle = generate({ size: 9, tier: 'medium', silver: false, freebies: 0, sizeMix: 0, shape: 0 }, 7);
  const game = newGame(puzzle, false, 'scavenging-completion', true);
  state = step(state, { type: 'begin-round', round: { id: game.id, size: puzzle.size, givenColors: [],
    collections: puzzle.colors.map((color, region) => ({ color, amount: puzzle.regions.filter((value) => value === region).length })) } }).state;
  const save: AdventureSave = { version: 2, loadout: STARTERS[0], start, state, log: [], game, played: 0, open: true, view: 'adventure' };
  await page.evaluate((value) => localStorage.setItem('stumped-main.adventure', JSON.stringify(value)), save);
  await page.reload();
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  for (const [index, cell] of puzzle.solution.entries()) {
    await page.getByRole('gridcell').nth(cell).focus(); await page.keyboard.press('Enter');
    if (index === 0) expect((await readSave(page)).state.encounter?.phase).toBe('scavenge');
  }
  expect((await readSave(page)).game?.status).toBe('won');
  await expect(page.getByRole('heading', { name: 'Fight', exact: true })).toBeAttached({ timeout: 20000 });
  await activate(page, page.locator('.accessible-adventure [data-action^="take-"]:enabled').first());
  expect((await readSave(page)).state.slots).toHaveLength(3);
  await activate(page, 'Map');
  await activate(page, page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first());
  await activate(page, page.locator('.accessible-adventure [data-action="play"]'));
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  const first = await page.evaluate(() => (window as unknown as { stumped: { model: Game } }).stumped.model.puzzle.solution[0]);
  await page.getByRole('gridcell').nth(first).focus(); await page.keyboard.press('Enter');
  expect((await readSave(page)).game?.marks[first]).toBe(3);
});

test('quiet locations, shops and reserves use Phaser controls and survive reload', async ({ page }, info) => {
  await enable(page);
  const state = startRun(STARTERS[0]); state.campaign = createCampaign(7); state.campaign.node = '2-0'; state.resources.supplies = 100; state.health = 10;
  const moved = step(state, { type: 'travel', node: '3-0' }).state;
  const save: AdventureSave = { version: 2, loadout: STARTERS[0], start: state, state: moved, log: [{ type: 'travel', node: '3-0' }], times: [0], game: null, played: 0, open: true, view: 'campaign' };
  await page.evaluate((value) => localStorage.setItem('stumped-main.adventure', JSON.stringify(value)), save);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Shop', exact: true })).toBeAttached();
  await activate(page, 'Heal · 2 per health');
  expect((await readSave(page)).state.health).toBe(24);
  await activate(page, page.locator('.accessible-adventure [data-action^="take-"]:enabled').first());
  expect((await readSave(page)).state.slots).toHaveLength(3);
  await page.screenshot({ path: `screenshots/adventure-shop-${info.project.name}.png` });
  await page.reload();
  expect((await readSave(page)).state.slots).toHaveLength(3);
  await activate(page, 'Leave shop');
  await activate(page, 'Map');
  await ready(page);
  await expect(page.locator('.accessible-adventure [data-action^="travel-"]:enabled').first()).toBeAttached();
});

test('legacy sandbox selection still starts its exact loadout and returns to its own screen', async ({ page }) => {
  await enable(page);
  await page.getByRole('button', { name: 'Start adventure', exact: true }).click();
  await activate(page, 'Sandbox');
  await activate(page, 'Choose Wanderer');
  await activate(page, 'Start sandbox');
  await expect(page.getByRole('gridcell')).toHaveCount(81);
  expect((await readSave(page)).state.character).toBe('wanderer');
  await page.getByRole('button', { name: 'Menu', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Wanderer', exact: true })).toBeAttached();
  await activate(page, 'Give up');
  await page.locator('#confirmation').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run summary', exact: true })).toBeAttached();
});

test('scrolling keeps all shop offers reachable and map bounds follow the saved route', async ({ page }) => {
  await enable(page);
  const state = startRun(STARTERS[0]); state.campaign = createCampaign(7); state.campaign.node = '2-0'; state.resources.supplies = 100;
  const moved = step(state, { type: 'travel', node: '3-0' }).state;
  const last = moved.campaign!.stock.at(-1)!;
  const save: AdventureSave = { version: 2, start: state, state: moved, log: [], game: null, played: 0, open: true, view: 'campaign' };
  await page.evaluate((value) => localStorage.setItem('stumped-main.adventure', JSON.stringify(value)), save);
  await page.reload();
  const target = page.locator(`.accessible-adventure [data-action="take-${last.id}"]`);
  for (let guard = 0; guard < 12 && !await target.count(); guard++) await activate(page, 'Scroll down');
  await activate(page, target);
  expect((await readSave(page)).state.campaign!.potions).toHaveLength(1);
  await activate(page, 'Map');
  for (let guard = 0; guard < 12; guard++) {
    const ahead = page.getByRole('button', { name: 'Ahead', exact: true });
    if (await ahead.isDisabled()) break;
    await activate(page, ahead);
  }
  const boss = moved.campaign!.map.find((node) => node.kind === 'boss')!;
  await expect(page.locator(`.accessible-adventure [data-action="travel-${boss.id}"]`)).toBeAttached();
});
