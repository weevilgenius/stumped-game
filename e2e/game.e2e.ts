import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Save } from '../src/game/state';

const CODE = '205000002ME';
const state = async (page: Page): Promise<Save> => page.evaluate(() => JSON.parse(localStorage.getItem('stumped.v1')!) as Save);
const start = async (page: Page, code = CODE): Promise<void> => {
  await page.goto(`/?code=${code}`);
  await expect(page.locator('#board canvas[data-ready="true"]')).toBeVisible();
};
const position = async (page: Page, cell: number): Promise<{ x: number; y: number }> => {
  const box = (await page.locator('#board canvas').boundingBox())!;
  const n = (await state(page)).current!.puzzle.size;
  return { x: box.x + ((cell % n) + 0.5) * box.width / n, y: box.y + (Math.floor(cell / n) + 0.5) * box.height / n };
};
const pressCell = async (page: Page, cell: number, key: string): Promise<void> => {
  const button = page.locator(`[data-cell="${cell}"]`);
  await button.focus(); await button.press(key);
};

test('tap is immediate, double tap reveals, strokes skip no cells, undo is per stroke', async ({ page, isMobile }) => {
  await start(page);
  const p = (await state(page)).current!;
  const point = await position(page, 0);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  expect((await state(page)).current!.marks[0]).toBe(1);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await state(page)).current!.marks[0]).toBe(0);
  const end = await position(page, 4);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 }); await page.mouse.up();
  expect((await state(page)).current!.marks.slice(0, 5)).toEqual([1, 1, 1, 1, 1]);
  expect((await state(page)).current!.undo).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await state(page)).current!.marks.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
  const target = await position(page, p.puzzle.solution[0]);
  if (isMobile) {
    await page.touchscreen.tap(target.x, target.y);
    await page.touchscreen.tap(target.x, target.y);
  } else await page.mouse.dblclick(target.x, target.y, { delay: 70 });
  expect((await state(page)).current!.marks[p.puzzle.solution[0]]).toBe(2);
  expect((await state(page)).current!.marks.filter((mark) => mark === 1)).toHaveLength(0);
  await expect(page.locator('#stump-count')).toHaveText('1/5');
});

test('touch drag paints every crossed square and erases in one stroke', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch-specific browser input');
  await start(page);
  const client = await page.context().newCDPSession(page);
  const a = await position(page, 5);
  const b = await position(page, 9);
  const stroke = async (): Promise<void> => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await stroke();
  expect((await state(page)).current!.marks.slice(5, 10)).toEqual([1, 1, 1, 1, 1]);
  await stroke();
  expect((await state(page)).current!.marks.slice(5, 10)).toEqual([0, 0, 0, 0, 0]);
  await page.locator('#undo').click();
  expect((await state(page)).current!.marks.slice(5, 10)).toEqual([1, 1, 1, 1, 1]);
});

test('scratch layer, separate undo, normal marks, and pending explanation survive reload', async ({ page }) => {
  await start(page);
  await pressCell(page, 0, 'Space');
  await page.locator('#hypothesis').click();
  await pressCell(page, 1, 'Enter');
  await pressCell(page, 3, 'Space');
  await page.reload();
  await expect(page.locator('#board canvas[data-ready="true"]')).toBeVisible();
  expect((await state(page)).current!.hypothesis).toBe(true);
  expect((await state(page)).current!.pencil[1]).toBe(2);
  await page.locator('#undo').click();
  expect((await state(page)).current!.pencil[3]).toBe(0);
  expect((await state(page)).current!.marks[0]).toBe(1);
  await pressCell(page, 3, 'Space');
  await page.locator('#keep').click();
  expect((await state(page)).current!.pencil.every((m) => m === 0)).toBe(true);
  expect((await state(page)).current!.marks[3]).toBe(1);
  await page.locator('#undo').click();
  expect((await state(page)).current!.marks[0]).toBe(0);
  const stump = (await state(page)).current!.puzzle.solution[0];
  await pressCell(page, stump, 'Space');
  await page.locator('#hint-explain').click();
  await expect(page.locator('#explanation')).toBeVisible();
  await expect(async () => {
    const canvas = (await page.locator('#board canvas').boundingBox())!;
    const parent = (await page.locator('#board').boundingBox())!;
    expect(Math.abs(canvas.width - parent.width)).toBeLessThan(2);
    expect(Math.abs(canvas.x - parent.x)).toBeLessThan(2);
  }).toPass({ timeout: 3000 });
  await page.reload();
  await expect(page.locator('#explanation')).toBeVisible();
  await page.locator('#explain-close').click();
  expect((await state(page)).current!.marks[stump]).toBe(0);
  await expect(page.locator('#hint-explain')).toBeDisabled();
});

test('wrong reveals lock input, preserve red Xs, lose acorns, and return home', async ({ page }) => {
  await start(page);
  const p = (await state(page)).current!;
  const empty = p.marks.flatMap((_, c) => p.puzzle.solution.includes(c) ? [] : [c]);
  for (const cell of empty.slice(0, 3)) {
    await pressCell(page, cell, 'Enter');
    await expect(page.locator('#hypothesis')).toBeDisabled();
    expect((await state(page)).current!.marks[cell]).toBe(3);
    if ((await state(page)).current!.lives > 0) await expect(page.locator('#hypothesis')).toBeEnabled();
  }
  await expect(page.locator('#home')).toBeVisible();
  expect((await state(page)).results).toEqual([]);
  await expect(page.locator('#current-card')).toContainText('STUMPED.');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect((await state(page)).current!.marks.every((m) => m === 0)).toBe(true);
  expect((await state(page)).current!.repeat).toBe(true);
});

test('win records qualifications once, retries are repeats, and best times are browsable', async ({ page }) => {
  await start(page);
  const p = (await state(page)).current!;
  // Mark the forest completely to exercise the special finish message.
  for (let cell = 0; cell < p.marks.length; cell++) if (!p.puzzle.solution.includes(cell)) await pressCell(page, cell, 'Space');
  for (const cell of p.puzzle.solution) await pressCell(page, cell, 'Enter');
  await expect(page.locator('#end-message')).toHaveText('Perfectly Marked');
  await expect(page.locator('#home')).toBeVisible();
  const result = (await state(page)).results[0];
  expect(result.clean).toBe(true);
  expect(result.hints).toEqual([]);
  await page.reload();
  expect((await state(page)).results).toHaveLength(1);
  await page.getByRole('button', { name: 'Best times', exact: true }).click();
  await expect(page.locator('#times-list')).toContainText(CODE);
  await expect(page.getByRole('dialog').getByLabel('Clean solve')).toBeVisible();
  await page.getByLabel('Close dialog').click();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.locator('#hint-reveal').click();
  for (const cell of p.puzzle.solution) await pressCell(page, cell, 'Enter');
  await expect(page.locator('#home')).toBeVisible();
  expect((await state(page)).results).toHaveLength(2);
  expect((await state(page)).results[1]).toMatchObject({ repeat: true, clean: false, hints: ['reveal'] });
});

test('back pauses time, replacement needs confirmation, settings and seed validation work', async ({ page }) => {
  await start(page);
  await page.locator('#back').click();
  const elapsed = (await state(page)).current!.elapsed;
  await page.waitForTimeout(1150);
  expect((await state(page)).current!.elapsed).toBe(elapsed);
  await page.getByRole('button', { name: 'New puzzle', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep playing', exact: true }).click();
  expect((await state(page)).current!.puzzle.code).toBe(CODE);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Show timer').uncheck();
  await page.getByLabel('Board size').selectOption('5');
  await page.getByLabel('Difficulty', { exact: true }).selectOption('easy');
  await page.getByLabel('Silver acorn mode').check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await page.getByLabel('HAVE A PUZZLE CODE?').fill('no-such-code');
  await page.getByRole('button', { name: 'Play seed code' }).click();
  await expect(page.locator('#seed-error')).toContainText('not recognized');
  await page.getByRole('button', { name: 'New puzzle', exact: true }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('#puzzle-screen')).toBeVisible();
  expect((await state(page)).current!.puzzle.silver).toBe(true);
  expect((await state(page)).current!.lives).toBe(1);
  await expect(page.locator('#timer')).toBeHidden();
});

test('board and controls fit portrait and landscape, with no page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect(async () => {
      const canvas = (await page.locator('#board canvas').boundingBox())!;
      expect(canvas.width).toBeGreaterThan(200);
      expect(Math.abs(canvas.width - canvas.height)).toBeLessThan(2);
      expect(canvas.x).toBeGreaterThanOrEqual(0);
      expect(canvas.x + canvas.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }).toPass({ timeout: 3000 });
  }
  expect(errors).toEqual([]);
});

test('production installation reloads and generates puzzles fully offline', async ({ page, context }) => {
  await page.goto(`http://127.0.0.1:4178/?code=${CODE}`);
  await expect(page.locator('#board canvas[data-ready="true"]')).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await pressCell(page, 0, 'Space');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#board canvas[data-ready="true"]')).toBeVisible();
  expect((await state(page)).current!.marks[0]).toBe(1);
  await page.locator('#back').click();
  await page.locator('#seed').fill(CODE);
  await page.getByRole('button', { name: 'Play seed code' }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await expect(page.locator('#puzzle-screen')).toBeVisible();
  expect((await state(page)).current!.puzzle.code).toBe(CODE);
  expect((await state(page)).current!.repeat).toBe(true);
  expect((await state(page)).current!.marks[0]).toBe(0);
  await context.setOffline(false);
});
