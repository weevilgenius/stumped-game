import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type Phaser from 'phaser';

interface AudioScene {
  sound: Phaser.Sound.WebAudioSoundManager;
  cache: Phaser.Cache.CacheManager;
}

const cues = (page: Page): Promise<string[]> => page.evaluate(() => (
  (window as unknown as { playedCues: string[] }).playedCues));

const reveal = async (page: Page, cell: number): Promise<void> => {
  await page.getByRole('gridcell').nth(cell).focus();
  await page.keyboard.press('Enter');
};

test.beforeEach(async ({ page }) => {
  await page.goto('/?code=1D580000048');
  await page.getByRole('gridcell').first().waitFor();
  await page.evaluate(() => {
    const scene = (window as unknown as { stumped: AudioScene }).stumped;
    const played: string[] = [];
    Object.assign(window, { playedCues: played });
    const add = scene.sound.add.bind(scene.sound);
    scene.sound.add = (key, config) => {
      const sound = add(key, config);
      sound.on('play', () => played.push(key));
      return sound;
    };
  });
});

test('marks, correct guesses and a win play once; erasing stays silent', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect.poll(() => cues(page)).toEqual(['sfx-mark']);
  await page.keyboard.press('Space');
  expect(await cues(page)).toEqual(['sfx-mark']);
  for (const cell of [6, 11, 17, 31, 32, 45, 50, 60]) {
    await reveal(page, cell);
  }
  await expect.poll(() => cues(page)).toEqual(['sfx-mark', ...Array<string>(8).fill('sfx-correct'), 'sfx-win']);
});

test('wrong guesses and a loss play once', async ({ page }) => {
  for (const cell of [0, 1, 2]) {
    await reveal(page, cell);
    await expect.poll(async () => (await cues(page)).filter((cue) => cue === 'sfx-wrong').length).toBe(cell + 1);
    if (cell < 2) {
      await expect(page.getByRole('gridcell').nth(cell + 1)).toHaveAttribute('aria-disabled', 'false');
    }
  }
  await expect.poll(() => cues(page)).toEqual(['sfx-wrong', 'sfx-wrong', 'sfx-wrong', 'sfx-lose']);
});

for (const hint of ['owl', 'squirrel', 'woodpecker']) {
  test(`${hint} has its own cue`, async ({ page }) => {
    const button = page.locator(`.accessible-puzzle [data-action="${hint}"]`);
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => cues(page)).toEqual([`sfx-${hint}`]);
  });
}
