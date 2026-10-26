import { expect, test } from '@playwright/test';
import { encodeSeedCode } from '../src/engine';
import type { Result } from '../src/game';
import { newSave } from '../src/save';

const results: Result[] = [5, 6, 8, 10].flatMap((size) => (
  ['easy', 'medium', 'hard'] as const
).flatMap((tier) => Array.from({ length: tier === 'medium' ? 12 : 2 }, (_, index) => ({
  id: `${size}-${tier}-${index}`,
  code: encodeSeedCode({ size, tier, silver: false, sizeMix: 0, shape: 0, freebies: 0 }, index),
  size, tier, silver: false, time: (index + 1) * 30_000, hints: index === 0 ? ['squirrel'] : [], acornsLost: 0, repeat: false,
  date: Date.UTC(2026, 9, index + 1),
}))));
// The latest solve is deliberately well below the best few, in the middle column.
const latest = results.find((result) => result.id === '8-medium-10')!;
const history = [...results.filter((result) => result !== latest), latest];

test('all bands stay aligned and the latest solve opens in view', async ({ page }, testInfo) => {
  await page.addInitScript((save) => localStorage.setItem('stumped-main.save', JSON.stringify(save)), {
    ...newSave(), results: history,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Best times', exact: true }).click();
  await expect(page.locator('#gamesPlayed')).toHaveText('64');
  await expect(page.locator('#perfectSolves')).toHaveText('52');
  const focus = page.locator('#times .times-focus');
  await expect(focus).toContainText('5:30');
  await expect(focus).toContainText('Latest solve');
  await expect(focus).toBeInViewport();
  await expect(page.locator('.times-band li:not(.times-empty)')).toHaveCount(results.length);
  const firstBand = page.locator('.times-band').first();
  await expect(firstBand.locator('li').first()).toContainText('1:00');
  await expect(firstBand.locator('li').last()).toContainText('0:30');
  const layout = await page.locator('#timesViewport').evaluate((viewport) => {
    const rect = viewport.getBoundingClientRect();
    const target = viewport.querySelector('.times-focus')!.getBoundingClientRect();
    return {
      overflow: viewport.scrollWidth > viewport.clientWidth,
      targetInside: target.left >= rect.left && target.right <= rect.right,
      sections: [...viewport.querySelectorAll('.times-size')].map((section) => (
        [...section.querySelectorAll('h3')].map((heading) => heading.getBoundingClientRect().top)
      )),
    };
  });
  expect(layout.targetInside).toBe(true);
  expect(layout.overflow).toBe(testInfo.project.name === 'mobile-chromium');
  for (const tops of layout.sections) {
    expect(new Set(tops).size).toBe(1);
  }
  await page.screenshot({ path: `screenshots/times-${testInfo.project.name}.png` });
  await page.locator('#timesViewport').evaluate((viewport) => {
    viewport.scrollLeft = viewport.scrollWidth;
    viewport.scrollTop = viewport.scrollHeight;
  });
  await expect(page.locator('.times-band').last()).toBeInViewport();
  await expect(page.locator('.times-headings b').last()).toBeInViewport();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#times')).not.toBeVisible();
});

test('an empty history explains where completed games will appear', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Best times', exact: true }).click();
  await expect(page.locator('#timesContext')).toContainText('No times yet');
  await expect(page.locator('#gamesPlayed')).toHaveText('0');
  await expect(page.locator('#perfectSolves')).toHaveText('0');
  await expect(page.locator('.times-headings')).toContainText('easy');
  await expect(page.locator('.times-focus')).toHaveCount(0);
});

test('an unfinished puzzle highlights its band even without previous results', async ({ page }) => {
  await page.goto('/?code=1D580000048');
  await page.waitForFunction(() => localStorage.getItem('stumped-main.save')?.includes('1D580000048'));
  await page.reload();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toHaveAttribute('aria-disabled', 'false');
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Best times', exact: true }).click();
  await expect(page.locator('#times .times-focus')).toContainText('Current puzzle');
  await expect(page.locator('#times .times-focus')).toContainText('8 × 8');
  await expect(page.locator('#times .times-focus')).toBeInViewport();
});
