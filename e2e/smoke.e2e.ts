import { expect, test } from '@playwright/test';

/**
 * Functional end-to-end tests for Stumped.
 *
 * These assert behaviour/structure (not pixels), so they are stable across
 * platforms and need no committed baseline images. Each test runs on both a
 * desktop and a mobile viewport (see the projects in playwright.config.ts).
 */

test('home page renders its heading and main menu controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('new-puzzle-btn')).toBeVisible();
  await expect(page.getByTestId('seed-code-input')).toBeVisible();
  await expect(page.getByTestId('play-code-btn')).toBeVisible();
  await expect(page.getByTestId('best-times-btn')).toBeVisible();
  await expect(page.getByTestId('settings-btn')).toBeVisible();
});

test('starts a puzzle via URL ?code=, supports tap/drag/undo/double-tap, and persists across reload', async ({ page }) => {
  // Generate a known valid seed code from the engine in the browser first
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__STUMPED__?.ready));

  const seedInfo = await page.evaluate(() => {
    const bridge = window.__STUMPED__!;
    const session = bridge.appController.startNewPuzzle();
    const code = session.puzzle.code;
    window.localStorage.clear();
    return {
      code,
      size: session.puzzle.size,
      stumpCell: session.puzzle.solution[0],
    };
  });

  await page.goto(`/?code=${seedInfo.code}`);
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'PuzzleScene');

  await expect(page.getByTestId('back-to-menu-btn')).toBeVisible();
  await expect(page.getByTestId('undo-btn')).toBeDisabled();

  // Single tap on a non-stump cell toggles an X immediately and enables Undo
  const nonStumpCell = await page.evaluate(() => {
    const s = window.__STUMPED__!.getSession()!;
    const sol = new Set(s.puzzle.solution);
    for (let i = 0; i < s.puzzle.size * s.puzzle.size; i++) {
      if (!sol.has(i) && s.getNormalMarks()[i] === 0) {
        return i;
      }
    }
    return 0;
  });

  const center = await page.evaluate((c) => window.__STUMPED__!.getCellCenter(c)!, nonStumpCell);
  await page.mouse.click(center.x, center.y);

  await expect(page.getByTestId('undo-btn')).toBeEnabled();
  const markAfterTap = await page.evaluate((c) => window.__STUMPED__!.getSession()!.getNormalMarks()[c], nonStumpCell);
  expect(markAfterTap).toBe(1); // MARK_X

  // Undo reverts the single-tap X
  await page.getByTestId('undo-btn').click();
  await expect(page.getByTestId('undo-btn')).toBeDisabled();
  const markAfterUndo = await page.evaluate((c) => window.__STUMPED__!.getSession()!.getNormalMarks()[c], nonStumpCell);
  expect(markAfterUndo).toBe(0); // MARK_OPEN

  // Double-tap a solution stump cell to reveal it
  const stumpCenter = await page.evaluate((c) => window.__STUMPED__!.getCellCenter(c)!, seedInfo.stumpCell);
  await page.mouse.dblclick(stumpCenter.x, stumpCenter.y);

  const revealedCount = await page.evaluate(() => window.__STUMPED__!.getSession()!.getRevealedStumpCount());
  expect(revealedCount).toBeGreaterThanOrEqual(1);

  // Reload the page and verify the in-progress puzzle resumes automatically on PuzzleScene
  await page.reload();
  await page.waitForFunction(() => window.__STUMPED__?.ready);
  const activeSceneAfterReload = await page.evaluate(() => window.__STUMPED__!.getActiveSceneKey());
  expect(activeSceneAfterReload).toBe('PuzzleScene');
  const revealedAfterReload = await page.evaluate(() => window.__STUMPED__!.getSession()!.getRevealedStumpCount());
  expect(revealedAfterReload).toBe(revealedCount);
});

test('supports Hypothesis mode (What if?, Discard, Keep) and all three hints', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__STUMPED__?.ready));

  await page.getByTestId('new-puzzle-btn').click();
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'PuzzleScene');

  // Enter Hypothesis mode
  await page.getByTestId('what-if-btn').click();
  await expect(page.getByTestId('discard-hypothesis-btn')).toBeVisible();
  await expect(page.getByTestId('keep-hypothesis-btn')).toBeVisible();

  const openNonStump = await page.evaluate(() => {
    const s = window.__STUMPED__!.getSession()!;
    const sol = new Set(s.puzzle.solution);
    const list: number[] = [];
    for (let i = 0; i < s.puzzle.size * s.puzzle.size; i++) {
      if (!sol.has(i) && s.getNormalMarks()[i] === 0) {
        list.push(i);
      }
    }
    return list;
  });

  // Tap an open cell in hypothesis mode -> places a hypothesis X
  await page.evaluate((c) => window.__STUMPED__!.tapCell(c), openNonStump[0]);
  const hypMark = await page.evaluate((c) => window.__STUMPED__!.getSession()!.getHypothesisMarks()[c], openNonStump[0]);
  expect(hypMark).toBe(1); // HYP_X

  // Discard hypothesis mode -> removes hypothesis marks
  await page.getByTestId('discard-hypothesis-btn').click();
  await expect(page.getByTestId('what-if-btn')).toBeVisible();
  const normalAfterDiscard = await page.evaluate(
    (c) => window.__STUMPED__!.getSession()!.getNormalMarks()[c],
    openNonStump[0],
  );
  expect(normalAfterDiscard).toBe(0);

  // Enter Hypothesis mode again, place a hypothesis X, and Keep it
  await page.getByTestId('what-if-btn').click();
  await page.evaluate((c) => window.__STUMPED__!.tapCell(c), openNonStump[0]);
  await page.getByTestId('keep-hypothesis-btn').click();
  const normalAfterKeep = await page.evaluate(
    (c) => window.__STUMPED__!.getSession()!.getNormalMarks()[c],
    openNonStump[0],
  );
  expect(normalAfterKeep).toBe(1); // Promoted to normal MARK_X

  // Use Eliminate (Squirrel) hint
  await page.getByTestId('hint-eliminate-btn').click();
  await expect(page.getByTestId('hint-eliminate-btn')).toBeDisabled();

  // Use Explain (Owl) hint and close it with Apply & Done
  await page.getByTestId('hint-explain-btn').click();
  await expect(page.getByTestId('explain-done-btn')).toBeVisible();
  await page.getByTestId('explain-done-btn').click();
  await expect(page.getByTestId('hint-explain-btn')).toBeDisabled();

  // Use Reveal (Woodpecker) hint
  const beforeReveal = await page.evaluate(() => window.__STUMPED__!.getSession()!.getRevealedStumpCount());
  await page.getByTestId('hint-reveal-btn').click();
  await expect(page.getByTestId('hint-reveal-btn')).toBeDisabled();
  const afterReveal = await page.evaluate(() => window.__STUMPED__!.getSession()!.getRevealedStumpCount());
  expect(afterReveal).toBe(beforeReveal + 1);
});

test('asks confirmation before replacing an in-progress puzzle and records solved puzzles in Best Times', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__STUMPED__?.ready));

  // Configure 5x5 Easy in Settings
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('setting-size-5').click();
  await page.getByTestId('setting-difficulty-easy').click();
  await page.getByTestId('settings-close-btn').click();

  // Start a new 5x5 Easy puzzle
  await page.getByTestId('new-puzzle-btn').click();
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'PuzzleScene');

  // Return to main menu while puzzle is in progress
  await page.getByTestId('back-to-menu-btn').click();
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'MainScene');
  await expect(page.getByTestId('continue-puzzle-btn')).toBeVisible();

  // Clicking New Puzzle while a puzzle is in progress opens the confirmation modal
  await page.getByTestId('new-puzzle-btn').click();
  await expect(page.getByTestId('confirm-cancel-btn')).toBeVisible();
  await page.getByTestId('confirm-cancel-btn').click();

  // Resume puzzle and solve it cleanly
  await page.getByTestId('continue-puzzle-btn').click();
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'PuzzleScene');

  await page.evaluate(() => {
    const bridge = window.__STUMPED__!;
    const session = bridge.getSession()!;
    const solSet = new Set(session.puzzle.solution);
    for (let c = 0; c < session.puzzle.size * session.puzzle.size; c++) {
      if (!solSet.has(c)) {
        bridge.tapCell(c);
      }
    }
    for (const s of session.puzzle.solution) {
      if (session.getNormalMarks()[s] !== 2) {
        bridge.doubleTapCell(s);
      }
    }
  });

  // Wait for win animation to return to MainScene
  await page.waitForFunction(() => window.__STUMPED__?.getActiveSceneKey() === 'MainScene', { timeout: 5000 });

  // Open Best Times and verify the 5x5 Easy clean solve is listed
  await page.getByTestId('best-times-btn').click();
  await expect(page.locator('.best-time-row')).toHaveCount(1);
  await expect(page.locator('.best-time-star.clean')).toBeVisible();
  await page.getByTestId('best-times-close-btn').click();
});
