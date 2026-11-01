import { expect, test } from '@playwright/test';

test('a muted puzzle never opens an audio context, including after returning to the app', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    localStorage.setItem('stumped-main.settings', JSON.stringify({ timer: true, silver: 'sometimes', muted: true }));
    const contexts: AudioContext[] = [];
    Object.assign(window, { audioContexts: contexts });
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args) {
        const context = new target(...args as ConstructorParameters<typeof AudioContext>);
        contexts.push(context);
        return context;
      },
    });
  });
  await page.goto('/?code=1D580000048');
  await expect(page.locator('#game canvas')).toBeVisible();
  const interact = async (): Promise<void> => {
    if (isMobile) {
      await page.locator('#game canvas').tap();
    } else {
      await page.locator('#game canvas').click();
    }
  };
  await interact();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await interact();
  expect(await page.evaluate(() => (window as unknown as { audioContexts: AudioContext[] }).audioContexts.length)).toBe(0);
});
