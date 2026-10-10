import { expect, test } from '@playwright/test';
import type { Game } from '../src/game';
import type { Page } from '@playwright/test';

const open = async (page: Page): Promise<void> => {
  await page.goto('/?code=1D580000048');
  await expect(page.getByRole('gridcell')).toHaveCount(64);
};
const game = (page: Page): Promise<Game> => page.evaluate(() => (
  (window as unknown as { stumped: { model: Game } }).stumped.model));
const control = (page: Page, name: string) => page.locator(`[data-action="${name}"]`);
const activate = async (page: Page, name: string): Promise<void> => {
  const button = control(page, name);
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await button.focus();
  await page.keyboard.press('Enter');
};

test('keyboard grid navigation, marking, revealing, undo and screen focus', async ({ page }) => {
  await open(page);
  const cells = page.getByRole('gridcell');
  await expect(cells.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(cells.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(cells.nth(15)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cells.nth(15)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cells.nth(8)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(cells.nth(8)).toHaveAccessibleName(/: X$/);
  await activate(page, 'undo');
  await expect(cells.nth(8)).toHaveAccessibleName(/: open$/);
  await cells.nth(6).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Reveal stump at row 1, column 7' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(cells.nth(6)).toHaveAccessibleName(/revealed stump/);
  await expect(control(page, 'undo')).toHaveAttribute('aria-disabled', 'true');
  await activate(page, 'back');
  await expect(page.locator('#new')).toBeFocused();
  await page.locator('#thumb').press('Enter');
  await expect(cells.nth(0)).toBeFocused();
});

test('hypothesis state, conflicts, independent undo and replacement focus', async ({ page }) => {
  await open(page);
  const cells = page.getByRole('gridcell');
  await activate(page, 'hypothesis');
  await expect(control(page, 'keep')).toBeFocused();
  await expect(control(page, 'owl')).toHaveAttribute('aria-disabled', 'true');
  await cells.nth(0).focus();
  await page.keyboard.press('Enter');
  await cells.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(cells.nth(0)).toHaveAccessibleName(/tentative stump, rule conflict/);
  await expect(cells.nth(1)).toHaveAccessibleName(/tentative stump, rule conflict/);
  await cells.nth(8).focus();
  await page.keyboard.press('Space');
  await expect(cells.nth(8)).toHaveAccessibleName(/hypothesis X/);
  await activate(page, 'undo');
  await expect(cells.nth(8)).toHaveAccessibleName(/: open$/);
  await activate(page, 'discard');
  await expect(control(page, 'hypothesis')).toBeFocused();
  expect((await game(page)).hypo).toBeNull();
});

test('explanations announce reasoning and block every cell action', async ({ page }) => {
  await open(page);
  const cells = page.getByRole('gridcell');
  await cells.nth(6).focus();
  await page.keyboard.press('Space');
  await activate(page, 'owl');
  await expect(control(page, 'done')).toBeFocused();
  await expect(page.locator('.accessible-puzzle [role="status"]')).toContainText('This X is on a square');
  const before = await game(page);
  await cells.nth(8).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  // Screen readers activate semantic controls through click events.
  await cells.nth(8).dispatchEvent('click');
  expect((await game(page)).marks).toEqual(before.marks);
  await expect(cells.nth(8)).toHaveAttribute('aria-disabled', 'true');
  await activate(page, 'done');
  await expect(control(page, 'hypothesis')).toBeFocused();
  await expect(cells.nth(6)).toHaveAccessibleName(/: open$/);
});

test('wrong reveal feedback blocks keyboard and semantic actions until it finishes', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const cells = page.getByRole('gridcell');
  await cells.nth(6).focus();
  await page.keyboard.press('Enter');
  await cells.nth(7).focus();
  await page.keyboard.press('Enter');
  await expect(cells.nth(7)).toHaveAccessibleName(/wrong reveal, permanent X/);
  await expect(cells.nth(8)).toHaveAttribute('aria-disabled', 'true');
  const before = await game(page);
  await cells.nth(8).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await control(page, 'hypothesis').dispatchEvent('click');
  await control(page, 'woodpecker').dispatchEvent('click');
  const after = await game(page);
  expect(after.marks).toEqual(before.marks);
  expect(after.acorns).toBe(before.acorns);
  expect(after.hypo).toBeNull();
  expect(after.hints).toEqual([]);
  await page.clock.runFor(1200);
  await expect(cells.nth(8)).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Space');
  await expect(cells.nth(8)).toHaveAccessibleName(/: X$/);
});
