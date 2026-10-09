import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Game } from '../src/game';

/**
 * Functional end-to-end tests.
 *
 * These assert behaviour/structure (not pixels), so they are stable across
 * platforms and need no committed baseline images. Each test runs on both a
 * desktop and a mobile viewport (see the projects in playwright.config.ts).
 *
 * The board is a canvas, so the tests find squares and buttons through the
 * puzzle scene, which the dev build exposes as `window.stumped`.
 *
 * For visual inspection (layout, marks, animations), use `pnpm screenshot`
 * and view the resulting PNG rather than pixel-diff assertions.
 */

/** An 8 by 8 medium puzzle with no stump revealed at the start. */
const CODE = '1D580000048';
const SOLUTION = [6, 11, 17, 31, 32, 45, 50, 60];

const X = 1;
const RED = 2;
const STUMP = 3;

/** Longer than the double tap window, so two taps on one square stay two taps. */
const TAP_GAP_MS = 450;
/** Longer than the pause before newly swapped-in buttons accept a press. */
const SWAP_GUARD_MS = 400;
/** Longer than the wrong-reveal animation, which blocks input. */
const WRONG_REVEAL_MS = 1300;

interface Spot {
  x: number;
  y: number;
}

/** The parts of the puzzle scene the tests reach into. */
interface Scene {
  model: Game;
  explanation: object | null;
  spots: Record<string, Spot>;
  cellSpot: (cell: number) => Spot;
  game: { pause: () => void; resume: () => void };
}

/** Waits for the puzzle screen to be up and running a game in progress. */
const puzzleReady = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const running = (window as unknown as { stumped?: Scene & { sys: { isActive: () => boolean } } }).stumped;
    return running?.sys.isActive() && running.model.status === 'playing';
  });
  // The scene restarts a frame after it is asked to, and its buttons take presses a frame after that.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
};

const openPuzzle = async (page: Page, code = CODE): Promise<void> => {
  await page.goto(`/?code=${code}`);
  await puzzleReady(page);
};

const model = (page: Page): Promise<Game> => page.evaluate(() => (
  (window as unknown as { stumped: Scene }).stumped.model));

const marks = async (page: Page, cells: number[]): Promise<number[]> => {
  const all = (await model(page)).marks;
  return cells.map((cell) => all[cell]);
};

/** Drives the browser visibility boundary even when headless Chromium keeps delivering frames. */
const setHidden = (page: Page, hidden: boolean): Promise<void> => page.evaluate((value) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

const cellSpot = (page: Page, cell: number): Promise<Spot> => page.evaluate((target) => (
  (window as unknown as { stumped: Scene }).stumped.cellSpot(target)), cell);

const tap = async (page: Page, cell: number): Promise<void> => {
  const { x, y } = await cellSpot(page, cell);
  await page.mouse.click(x, y);
};

const doubleTap = async (page: Page, cell: number): Promise<void> => {
  const { x, y } = await cellSpot(page, cell);
  await page.mouse.dblclick(x, y);
};

/** Buttons whose press swaps in a different set of buttons, which ignore presses for a moment. */
const SWAPPING = ['hypothesis', 'keep', 'discard', 'owl', 'done'];

const press = async (page: Page, button: string): Promise<void> => {
  const { x, y } = await page.evaluate((name) => (
    (window as unknown as { stumped: Scene }).stumped.spots[name]), button);
  await page.mouse.click(x, y);
  if (SWAPPING.includes(button)) {
    await page.waitForTimeout(SWAP_GUARD_MS);
  }
};

const solve = async (page: Page): Promise<void> => {
  for (const cell of SOLUTION) {
    await doubleTap(page, cell);
    expect(await marks(page, [cell]), `square ${cell}`).toEqual([STUMP]);
  }
};

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      throw new Error(message.text());
    }
  });
});

test('main screen shows the logo and a way to start', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New puzzle' })).toBeVisible();
  await expect(page.locator('#current')).toBeHidden();
});

test('a link with a seed code opens that puzzle', async ({ page }) => {
  await openPuzzle(page);
  const { puzzle } = await model(page);
  expect(puzzle.code).toBe(CODE);
  expect(puzzle.solution).toEqual(SOLUTION);
  expect(page.url()).not.toContain('code=');
  await expect(page.locator('#menu')).toBeHidden();
});

test('a tap toggles an X at once, and undo steps back', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([X]);
  await page.waitForTimeout(TAP_GAP_MS);
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([0]);
  await press(page, 'undo');
  expect(await marks(page, [0])).toEqual([X]);
  await press(page, 'undo');
  expect(await marks(page, [0])).toEqual([0]);
});

test('a fast drag marks every square it crosses, as one undo step', async ({ page }) => {
  await openPuzzle(page);
  const row = [8, 9, 10, 11, 12, 13, 14, 15];
  await tap(page, 12);
  const from = await cellSpot(page, 8);
  const to = await cellSpot(page, 15);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // One move event for the whole row: the stroke must still fill in between.
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up();
  expect(await marks(page, row)).toEqual(row.map(() => X));

  await press(page, 'undo');
  expect(await marks(page, row)).toEqual(row.map((cell) => (cell === 12 ? X : 0)));

  // A drag that starts on an X erases every X it crosses, and places none.
  const start = await cellSpot(page, 12);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 1 });
  await page.mouse.up();
  expect(await marks(page, row)).toEqual(row.map(() => 0));
});

test('a diagonal drag does not catch the squares beside the corner', async ({ page }) => {
  await openPuzzle(page);
  const from = await cellSpot(page, 0);
  const to = await cellSpot(page, 18);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  expect(await marks(page, [0, 9, 18, 1, 8, 10, 17])).toEqual([X, X, X, 0, 0, 0, 0]);
});

test('a double tap reveals a stump, and a wrong one costs an acorn', async ({ page }) => {
  await openPuzzle(page);
  await doubleTap(page, 6);
  expect(await marks(page, [6])).toEqual([STUMP]);
  expect((await model(page)).acorns).toBe(3);

  // Square 7 shares a row with the stump on 6, so the conflict is shown first and input waits.
  await doubleTap(page, 7);
  const after = await model(page);
  expect([after.marks[7], after.acorns, after.undo.length]).toEqual([RED, 2, 0]);
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([0]);
  await page.waitForTimeout(WRONG_REVEAL_MS);
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([X]);

  // Reveals are permanent: undo only takes back the X.
  await press(page, 'undo');
  await press(page, 'undo');
  expect(await marks(page, [0, 6, 7])).toEqual([0, STUMP, RED]);
});

test('hypothesis mode marks a scratch layer that can be kept or discarded', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  await press(page, 'hypothesis');
  await tap(page, 1);
  await doubleTap(page, 7);
  await tap(page, 0);
  let game = await model(page);
  expect([game.hypo?.[1], game.hypo?.[7], game.hypo?.[0]]).toEqual([X, 2, 0]);
  expect([game.marks[0], game.marks[1], game.marks[7], game.acorns]).toEqual([X, 0, 0, 3]);

  // Undo here steps through hypothesis marks only.
  await press(page, 'undo');
  expect((await model(page)).hypo?.[7]).toBe(0);
  await doubleTap(page, 7);
  await press(page, 'keep');
  game = await model(page);
  expect(game.hypo).toBeNull();
  expect([game.marks[0], game.marks[1], game.marks[7]]).toEqual([X, X, 0]);

  await press(page, 'hypothesis');
  await tap(page, 2);
  await press(page, 'discard');
  game = await model(page);
  expect([game.hypo, game.marks[2]]).toEqual([null, 0]);
});

test('a double tap on a button does not press the button that replaces it', async ({ page }) => {
  await openPuzzle(page);
  const { x, y } = await page.evaluate(() => (
    (window as unknown as { stumped: Scene }).stumped.spots.hypothesis));
  await page.mouse.dblclick(x, y);
  expect((await model(page)).hypo).not.toBeNull();
});

test('each hint works once', async ({ page }) => {
  await openPuzzle(page);
  await press(page, 'woodpecker');
  let game = await model(page);
  expect(game.marks.filter((mark) => mark === STUMP)).toHaveLength(1);

  await press(page, 'squirrel');
  await press(page, 'squirrel');
  game = await model(page);
  expect(game.marks.filter((mark) => mark === X)).toHaveLength(3);
  expect(SOLUTION.some((cell) => game.marks[cell] === X)).toBe(false);

  // The owl explains first, and makes its mark when the explanation is closed.
  await press(page, 'owl');
  expect(await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.explanation !== null)).toBe(true);
  await tap(page, 40);
  expect((await model(page)).marks).toEqual(game.marks);

  // A relaunch with the explanation open comes back to it, so the hint is not lost.
  await page.reload();
  await puzzleReady(page);
  expect(await page.evaluate(() => Boolean((window as unknown as { stumped: Scene }).stumped.explanation))).toBe(true);
  await press(page, 'done');
  const explained = await model(page);
  expect(explained.marks).not.toEqual(game.marks);
  expect(explained.hints).toEqual(['woodpecker', 'squirrel', 'owl']);
  expect(explained.acorns).toBe(3);
});

test('a pending wrong-X explanation survives reload, applies on Done, and stays applied after undo', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  await tap(page, 6);
  await page.waitForTimeout(TAP_GAP_MS);
  await tap(page, 6);
  await page.waitForTimeout(TAP_GAP_MS);
  await tap(page, 6);
  await press(page, 'owl');
  expect((await model(page)).explaining).toEqual({ type: 'wrongX', cell: 6 });
  expect(await marks(page, [0, 6])).toEqual([X, X]);

  await page.reload();
  await puzzleReady(page);
  expect((await model(page)).explaining).toEqual({ type: 'wrongX', cell: 6 });
  expect((await model(page)).hints).toEqual(['owl']);
  await tap(page, 1);
  expect(await marks(page, [0, 1, 6])).toEqual([X, 0, X]);
  await press(page, 'done');
  await press(page, 'undo');
  expect(await marks(page, [0, 6])).toEqual([0, 0]);
  await page.reload();
  await puzzleReady(page);
  const restored = await model(page);
  expect(restored.explaining).toBeNull();
  expect(restored.hints).toEqual(['owl']);
  expect(await marks(page, [0, 6])).toEqual([0, 0]);
});

test('time advances during play, explanations and feedback, but pauses in the menu and background', async ({ page }) => {
  await page.clock.install();
  await openPuzzle(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const elapsed = async (): Promise<number> => (await model(page)).elapsed;
  const advances = async (): Promise<void> => {
    const before = await elapsed();
    await page.clock.runFor(500);
    const delta = await elapsed() - before;
    expect(delta).toBeGreaterThan(450);
    expect(delta).toBeLessThanOrEqual(520);
  };
  await advances();

  await press(page, 'back');
  await page.clock.runFor(100);
  const paused = await elapsed();
  await page.clock.fastForward(5000);
  expect(await elapsed()).toBe(paused);
  await page.locator('#thumb').click();
  await page.clock.runFor(100);
  await advances();

  for (const duration of [500, 5000]) {
    const before = await elapsed();
    await setHidden(page, true);
    if (duration < 1000) {
      await page.clock.runFor(duration);
    } else {
      await page.clock.fastForward(duration);
    }
    expect(await elapsed()).toBe(before);
    await setHidden(page, false);
    await advances();

    // Suppress scene updates to simulate browsers that suspend frames while hidden.
    const suspended = await elapsed();
    await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.game.pause());
    await setHidden(page, true);
    await page.clock.fastForward(duration);
    expect(await elapsed()).toBe(suspended);
    await setHidden(page, false);
    await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.game.resume());
    await advances();
  }

  await tap(page, 6);
  const owl = await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.spots.owl);
  await page.mouse.click(owl.x, owl.y);
  await page.clock.runFor(SWAP_GUARD_MS);
  expect((await model(page)).explaining).toEqual({ type: 'wrongX', cell: 6 });
  await advances();
  const done = await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.spots.done);
  await page.mouse.click(done.x, done.y);
  await page.clock.runFor(SWAP_GUARD_MS);
  await doubleTap(page, 6);
  await doubleTap(page, 7);
  expect((await model(page)).acorns).toBe(2);
  await advances();
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([0]);
  await page.clock.runFor(WRONG_REVEAL_MS);
  await tap(page, 0);
  expect(await marks(page, [0])).toEqual([X]);
  for (const cell of SOLUTION.filter((cell) => cell !== 6)) {
    await doubleTap(page, cell);
  }
  expect((await model(page)).status).toBe('won');
  const finished = await elapsed();
  await page.clock.runFor(500);
  expect(await elapsed()).toBe(finished);
});

test('the puzzle is saved: back and resume, and a relaunch, lose nothing', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  await doubleTap(page, 6);
  await press(page, 'back');
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#info')).toContainText('In progress');
  await expect(page.locator('#info')).toContainText(CODE);
  await expect(page.locator('#thumb i')).toHaveCount(64);

  await page.locator('#thumb').click();
  await expect(page.locator('#menu')).toBeHidden();
  await puzzleReady(page);
  await tap(page, 1);
  expect(await marks(page, [0, 1, 6])).toEqual([X, X, STUMP]);

  // A relaunch in the middle of play lands back on the puzzle.
  await page.reload();
  await puzzleReady(page);
  await expect(page.locator('#menu')).toBeHidden();
  expect(await marks(page, [0, 1, 6])).toEqual([X, X, STUMP]);
  await press(page, 'undo');
  expect(await marks(page, [0, 1, 6])).toEqual([X, 0, STUMP]);
});

test('turning the screen lays the board out again and taps still land', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  const before = await cellSpot(page, 63);
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  await page.setViewportSize({ width: height, height: width });
  await expect.poll(() => cellSpot(page, 63)).not.toEqual(before);
  await puzzleReady(page);
  for (const cell of [1, 63]) {
    const { x, y } = await cellSpot(page, cell);
    expect(x).toBeLessThan(height);
    expect(y).toBeLessThan(width);
    await page.mouse.click(x, y);
  }
  expect(await marks(page, [0, 1, 63])).toEqual([X, X, X]);
});

test('resizing a hidden canvas then resuming preserves marks and immediate hit accuracy', async ({ page }) => {
  await openPuzzle(page);
  await tap(page, 0);
  await press(page, 'back');
  await expect(page.locator('#menu')).toBeVisible();
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width: height, height: width });
  await page.locator('#thumb').click();
  await puzzleReady(page);
  await tap(page, 63);
  await doubleTap(page, 6);
  expect(await marks(page, [0, 6, 63])).toEqual([X, STUMP, X]);
});

test('solving records once through repeated input, banner resize, reloads and a retry', async ({ page }) => {
  await page.clock.install();
  await openPuzzle(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await solve(page);
  expect((await model(page)).status).toBe('won');
  const finished = (await model(page)).elapsed;
  await doubleTap(page, SOLUTION.at(-1)!);
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width: height, height: width });
  await page.clock.runFor(500);
  expect((await model(page)).status).toBe('won');
  expect((await model(page)).elapsed).toBe(finished);
  await expect(page.locator('#menu')).toBeHidden();
  // Reload while the win banner is still up, before its delayed exit.
  await page.clock.resume();
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#info')).toContainText('Solved in');
  await expect(page.locator('#info .star')).toBeVisible();
  await expect(page.locator('#thumb')).toBeDisabled();

  await page.getByRole('button', { name: 'Best times' }).click();
  await expect(page.locator('#timesList li')).toHaveCount(1);
  await expect(page.locator('#timesList .star')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Best times' }).click();
  await expect(page.locator('#timesList li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close' }).click();

  // A retry is a repeat play: it is recorded too, but cannot be clean.
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#menu')).toBeHidden();
  await puzzleReady(page);
  const retry = await model(page);
  expect([retry.repeat, retry.marks.every((mark) => mark === 0)]).toEqual([true, true]);
  await solve(page);
  await page.clock.runFor(3000);
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await page.getByRole('button', { name: 'Best times' }).click();
  await expect(page.locator('#timesList li')).toHaveCount(2);
  await expect(page.locator('#timesList .star')).toHaveCount(1);
});

test('losing the last acorn ends the puzzle without giving it away', async ({ page }) => {
  await openPuzzle(page);
  for (const cell of [0, 1, 2]) {
    await doubleTap(page, cell);
    await page.waitForTimeout(WRONG_REVEAL_MS);
  }
  await expect(page.locator('#menu')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#info')).toContainText('Stumped.');
  await expect(page.locator('#thumb i[style*="background-image"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Best times' }).click();
  await expect(page.locator('#timesList')).toContainText('No times yet.');
});

test('new puzzles follow the size and difficulty settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.locator('#settings');
  await settings.locator('[name=size]').selectOption('5');
  await settings.locator('[name=tier]').selectOption('easy');
  await settings.getByLabel('Show timer').uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await puzzleReady(page);
  const first = await model(page);
  expect([first.puzzle.size, first.puzzle.tier, first.puzzle.silver]).toEqual([5, 'easy', false]);

  // Starting another while one is in progress asks first.
  await press(page, 'back');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await page.waitForFunction((code) => (
    (window as unknown as { stumped: Scene }).stumped.model.puzzle.code !== code), first.puzzle.code);
  expect((await model(page)).puzzle.size).toBe(5);
});

test('a bad seed code is refused and a good one plays', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Seed code').fill('NOT-A-CODE');
  await page.getByRole('button', { name: 'Play code' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.getByLabel('Seed code').evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);

  await page.getByLabel('Seed code').fill('1d58-0000-048');
  await page.getByRole('button', { name: 'Play code' }).click();
  await puzzleReady(page);
  expect((await model(page)).puzzle.code).toBe(CODE);
});

test('touch taps mark squares', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'needs a touch screen');
  await openPuzzle(page);
  const { x, y } = await cellSpot(page, 0);
  await page.touchscreen.tap(x, y);
  expect(await marks(page, [0])).toEqual([X]);
  const stump = await cellSpot(page, 6);
  await page.touchscreen.tap(stump.x, stump.y);
  await page.touchscreen.tap(stump.x, stump.y);
  expect(await marks(page, [0, 6])).toEqual([X, STUMP]);
});

test('touch drags fill sparse crossings and spare diagonal neighbors', async ({ page, hasTouch }) => {
  test.skip(!hasTouch, 'needs a touch screen');
  await openPuzzle(page);
  const touch = await page.context().newCDPSession(page);
  const drag = async (from: number, to: number): Promise<void> => {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ ...await cellSpot(page, from), id: 1 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...await cellSpot(page, to), id: 1 }],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(8, 15);
  expect(await marks(page, [8, 9, 10, 11, 12, 13, 14, 15])).toEqual(Array(8).fill(X));
  await press(page, 'undo');
  expect(await marks(page, [8, 9, 10, 11, 12, 13, 14, 15])).toEqual(Array(8).fill(0));
  await drag(0, 18);
  expect(await marks(page, [0, 9, 18, 1, 8, 10, 17])).toEqual([X, X, X, 0, 0, 0, 0]);
  await touch.detach();
});
