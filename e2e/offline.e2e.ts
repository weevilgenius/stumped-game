import { test, expect, type Page } from '@playwright/test';

/**
 * Offline end-to-end tests. These run against the production build (see the
 * `offline` project in playwright.config.ts): the service worker that makes
 * the app work with no connection is only part of that build.
 */

const SEED = '10580000026';

/** Waits until the production service worker is controlling the page. */
const controlling = async (page: Page): Promise<void> => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
};

test('the installed app plays a seed code and another puzzle with no connection', async ({ page, context }) => {
  test.setTimeout(60_000);
  // Keep generation small so this tests offline caching rather than random difficulty.
  await page.addInitScript(() => localStorage.setItem('stumped-main.settings', JSON.stringify({
    timer: true, silver: false, size: 5, tier: 'easy', sizeMix: 1, shape: 1, freebies: 0,
  })));
  await page.goto('./');
  await controlling(page);
  expect(await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('stumped-main-'));
    const keys = await (await caches.open(name!)).keys();
    return keys.some((key) => key.url.includes('/assets/worker-'));
  })).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.goto(`./?code=${SEED}`);
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stumped-main.save'))).toContain(SEED);

  // The in-progress game would be written back on the way out, so freeze saves first.
  await page.evaluate(() => {
    const raw = localStorage.getItem('stumped-main.save');
    const save = JSON.parse(raw!) as { open: boolean };
    save.open = false;
    localStorage.setItem('stumped-main.save', JSON.stringify(save));
    Storage.prototype.setItem = (): void => {
      throw new DOMException('blocked', 'SecurityError');
    };
  });
  await page.goto('./');
  await expect(page.locator('#menu')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'New puzzle' }).click();
  await expect(page.locator('#game canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#storageNotice')).not.toContainText('could not be generated');
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('stumped-main.save') ?? '';
    return /"code":"([^"]+)"/.exec(raw)?.[1] ?? '';
  })).not.toBe(SEED);
});

test('a cache update drops only main caches and comparison pages stay on the network', async ({ page, context }) => {
  // A second script URL at the same scope is how the browser installs an update.
  // Rewriting sw.js in place does not, because the update check keeps the installed bytes.
  let nextScript = '';
  await context.route('**/sw-next.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: nextScript,
      headers: { 'cache-control': 'no-store' },
    });
  });

  await page.goto('./');
  await controlling(page);
  const version = await page.evaluate(async () => {
    const main = (await caches.keys()).filter((key) => key.startsWith('stumped-main-'));
    if (main.length !== 1 || !/^stumped-main-[0-9a-f]{12}$/.test(main[0])) {
      throw new Error(main.join(',') || 'no main cache');
    }
    return main[0];
  });

  // Mark the cached shell so a comparison response can be told apart from it.
  // The preview server would otherwise answer unknown paths with the same HTML.
  await page.evaluate(async (current) => {
    const cache = await caches.open(current);
    const shell = await cache.match('./');
    if (!shell) {
      throw new Error('missing shell');
    }
    await cache.put('./', new Response(`${await shell.text()}\n<!-- main-shell -->`, {
      headers: shell.headers,
      status: shell.status,
    }));
    await (await caches.open('stumped-main-stale')).put('./stale.txt', new Response('old'));
    await (await caches.open('stumped-grok-keep')).put('./keep.txt', new Response('grok'));
    await (await caches.open('stumped-fable-keep')).put('./keep.txt', new Response('fable'));
    await (await caches.open('stumped-astra-keep')).put('./keep.txt', new Response('astra'));
  }, version);

  expect(await page.evaluate(async () => {
    const home = await (await fetch('./')).text();
    const gemini = await (await fetch('./gemini/')).text();
    const grok = await (await fetch('./grok/assets/index.js')).text();
    return {
      home: home.includes('main-shell'),
      gemini: gemini.includes('main-shell'),
      grok: grok.includes('main-shell'),
    };
  })).toEqual({ home: true, gemini: false, grok: false });

  const hash = version.slice('stumped-main-'.length);
  const script = await page.evaluate(async () => (await fetch('./sw.js')).text());
  expect(script).toContain(`const CACHE = PREFIX + '${hash}'`);
  nextScript = script.replace(`const CACHE = PREFIX + '${hash}'`, `const CACHE = PREFIX + '${hash}b'`);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    void navigator.serviceWorker.register('./sw-next.js').catch(reject);
  }));

  await expect.poll(() => page.evaluate(async () => (await caches.keys()).sort())).toEqual([
    'stumped-astra-keep',
    'stumped-fable-keep',
    'stumped-grok-keep',
    `stumped-main-${hash}b`,
  ]);

  await context.setOffline(true);
  expect(await page.evaluate(async () => (await (await fetch('./')).text()).includes('id="menu"'))).toBe(true);
  const navigation = await page.goto('./gemini/').then(async () => {
    const body = await page.content();
    return body.includes('id="menu"') ? 'shell' : 'other';
  }).catch(() => 'offline');
  expect(navigation).not.toBe('shell');
});
