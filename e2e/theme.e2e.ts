import { expect, test } from '@playwright/test';
import type { Game } from '../src/game';
import type { Save } from '../src/save';

interface Scene {
  model: Game;
  theme: { id: string };
  textures: { exists: (key: string) => boolean };
}

const CODE = '1D580000048';

test('Vallarta applies to home, help, and an existing puzzle, persists, and switches back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/?code=${CODE}`);
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('gridcell').first().press('Space');
  const before = await page.evaluate(() => {
    const { model } = (window as unknown as { stumped: Scene }).stumped;
    return { id: model.id, puzzle: model.puzzle, marks: model.marks, acorns: model.acorns, hints: model.hints };
  });
  await page.getByRole('button', { name: 'Menu', exact: true }).press('Enter');
  await expect(page.locator('h1')).toContainText('in the woods.');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: 'Puerto Vallarta theme' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'vallarta');
  await expect(page.locator('h1')).toContainText('in Vallarta.');
  await expect(page.locator('.art > img')).toHaveAttribute('src', /vallarta\/home.svg/);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.locator('#helpBody')).toContainText('Parrot');
  await expect(page.locator('#helpBody')).toContainText('Calavera');
  await expect(page.locator('#helpBody')).toContainText('margarita');
  await expect(page.locator('#help .mini-board .stump').first()).toHaveCSS('background-image', /data:image\/svg\+xml/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Resume →', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { stumped: Scene }).stumped.theme.id === 'vallarta');
  await expect(page.getByRole('button', { name: 'Calavera: explain a deduction' })).toBeVisible();
  expect(await page.evaluate(() => {
    const scene = (window as unknown as { stumped: Scene }).stumped;
    const { model } = scene;
    return { id: model.id, puzzle: model.puzzle, marks: model.marks, acorns: model.acorns, hints: model.hints };
  })).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.textures.exists('raw-vallarta-stump'))).toBe(true);
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Parrot: reveal a parrot' })).toBeVisible();
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('stumped-main.save')!) as Save).settings.vallarta)).toBe(true);
  await page.getByRole('button', { name: 'Menu', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('h1')).toContainText('in the woods.');
  await page.getByRole('button', { name: 'Resume →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Woodpecker: reveal a stump' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { stumped: Scene }).stumped.model.marks)).toEqual(before.marks);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Woodpecker: reveal a stump' })).toBeVisible();
  expect(errors).toEqual([]);
});
