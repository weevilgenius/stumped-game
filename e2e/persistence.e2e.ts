import { expect, test } from '@playwright/test';
import type { Save } from '../src/save';

const CODE = '1D580000048';

test('legacy migration restores an explanation and leaves comparison apps untouched', async ({ page }) => {
  await page.goto(`/?code=${CODE}`);
  await page.waitForFunction(() => localStorage.getItem('stumped-main.save')?.includes('1D580000048'));
  const originalId = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('stumped-main.save')!) as Save;
    const game = data.game!;
    const cell = game.puzzle.solution[0];
    game.marks[cell] = 1;
    game.undo = [[[cell, 0]]];
    game.hints = ['owl'];
    game.explaining = { type: 'wrongX', cell };
    const { id, ...legacyGame } = game;
    localStorage.setItem('stumped-main.game', JSON.stringify(legacyGame));
    localStorage.setItem('stumped-main.settings', JSON.stringify(data.settings));
    localStorage.setItem('stumped-main.results', JSON.stringify(data.results));
    localStorage.setItem('stumped-main.played', JSON.stringify(data.played));
    localStorage.setItem('stumped-main.open', 'true');
    localStorage.setItem('stumped.v1', 'astra sentinel');
    localStorage.setItem('stumped-game-other-site', 'other site sentinel');
    localStorage.removeItem('stumped-main.save');
    return id;
  });
  // Navigation saves on pagehide/visibilitychange; freeze writes until the new page starts.
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
  });
  await page.reload();
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { stumped?: { explanation: unknown } }).stumped?.explanation);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('stumped-main.save')!) as Save);
  expect(data.game?.explaining?.type).toBe('wrongX');
  expect(data.game?.id).not.toBe(originalId);
  await page.reload();
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('stumped-main.save')!) as Save).game?.id)).toBe(data.game?.id);
  expect(await page.evaluate(() => [
    localStorage.getItem('stumped.v1'), localStorage.getItem('stumped-game-other-site'),
    localStorage.getItem('stumped-main.game'),
  ])).toEqual(['astra sentinel', 'other site sentinel', expect.stringContaining('"explaining":{"type":"wrongX"')]);
});

test('a rejected save is backed up and a recovery notice remains visible while playing', async ({ page }) => {
  await page.addInitScript(() => {
    // These saves cannot carry settings, so a fixed random source keeps the new puzzle small and quick.
    Math.random = () => 0;
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('stumped-main.save', '{"version":99}');
      localStorage.setItem('stumped.v1', 'astra sentinel');
      sessionStorage.setItem('seeded', 'yes');
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the Storage receiver below.
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value): void {
        if (key.startsWith('stumped-main.recovery.')) {
          sessionStorage.setItem('recovery-key', key);
        }
        original.call(this, key, value);
      };
    }
  });
  await page.goto('/');
  await expect(page.locator('#storageNotice')).toContainText('recovery copy was kept');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(sessionStorage.getItem('recovery-key')!)!) as unknown))
    .toMatchObject({ entries: { save: '{"version":99}' } });
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#storageNotice')).toBeVisible();
  const notice = await page.locator('#storageNotice').boundingBox();
  const game = await page.locator('#game').boundingBox();
  expect(game!.y).toBeGreaterThanOrEqual(notice!.y + notice!.height);
  expect(await page.evaluate(() => localStorage.getItem('stumped.v1'))).toBe('astra sentinel');
  await page.reload();
  await expect(page.locator('#storageNotice')).toBeHidden();
});

test('a quota failure reports unsaved progress and clears after a successful retry', async ({ page }) => {
  await page.goto(`/?code=${CODE}`);
  await page.waitForFunction(() => localStorage.getItem('stumped-main.save')?.includes('1D580000048'));
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the Storage receiver below.
    const original = Storage.prototype.setItem;
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value): void {
      if (key === 'stumped-main.save') {
        throw new DOMException('full', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#storageNotice')).toContainText('could not be saved');
  await page.evaluate(() => {
    (window as unknown as { restoreStorage: () => void }).restoreStorage();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#storageNotice')).toBeHidden();
});

test('blocked reads keep the original save untouched and allow an unsaved game', async ({ page }) => {
  await page.addInitScript(() => {
    // These saves cannot carry settings, so a fixed random source keeps the new puzzle small and quick.
    Math.random = () => 0;
    localStorage.setItem('stumped-main.save', '{"version":99}');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the Storage receiver below.
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key): string | null {
      if (key.startsWith('stumped-main.')) {
        throw new DOMException('blocked', 'SecurityError');
      }
      return original.call(this, key);
    };
    (window as unknown as { readOriginal: () => string | null }).readOriginal = () => original.call(localStorage, 'stumped-main.save');
  });
  await page.goto('/');
  await expect(page.locator('#storageNotice')).toContainText('storage is unavailable');
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await expect(page.locator('#game canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { readOriginal: () => string | null }).readOriginal()))
    .toBe('{"version":99}');
});
