/* ========================================================= *\
 *  Screenshot CLI                                           *
 *                                                           *
 *  Captures a screenshot, print PDF, or print PNG of the    *
 *  app for visual validation.                               *
 *                                                           *
 *  If a dev server is already running at the target URL it  *
 *  is reused; otherwise a throwaway Vite dev server is      *
 *  started for the capture and stopped afterwards.          *
 *                                                           *
 *  Usage:                                                   *
 *    pnpm screenshot [options]                              *
 *                                                           *
 *  Options:                                                 *
 *    --path <p>          Route to capture      (default /)  *
 *    --out <file>        Output path   (default screenshots/screenshot.png,
 *                                       screenshots/screenshot.pdf with --print
 *                                       unless --png is set)
 *    --theme <t>         light | dark          (default light)
 *    --device <d>        Playwright device name, e.g. "iPhone 15"
 *    --orientation <o>   portrait | landscape (swaps viewport dimensions)
 *    --width <n>         Viewport width  (default 1280, ignored with --device)
 *    --height <n>        Viewport height (default 800, ignored with --device)
 *    --code <seedCode>   Start a specific puzzle seed code  *
 *    --screen <s>        main | puzzle | settings | times   *
 *    --state <st>        marks | hypothesis | explain | won | lost
 *    --full-page         Capture the full scrollable page   *
 *    --print             Output a print-formatted PDF       *
 *    --png               Output PNG when used with --print  *
 *    --pages <range>     PDF page ranges, e.g. "1-5, 8"     *
 *    --url <base>        Base URL to use; disables auto-start
 *    --wait <sel>        Wait for a CSS selector before capturing
 *    --delay <ms>        Extra settle delay before capturing
\* ========================================================= */

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { chromium, devices } from '@playwright/test';
import { createServer } from 'vite';

/** Default base URL probed for an already-running dev server. */
const DEFAULT_BASE_URL = 'http://localhost:5173';

/** Milliseconds to wait when probing for an existing dev server. */
const PROBE_TIMEOUT_MS = 600;

/** US Letter at 96 CSS pixels per inch. */
const PRINT_PNG_VIEWPORT = { width: 816, height: 1056 };

const { values } = parseArgs({
  options: {
    path: { type: 'string', default: '/' },
    out: { type: 'string' },
    theme: { type: 'string', default: 'light' },
    device: { type: 'string' },
    orientation: { type: 'string' },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
    code: { type: 'string' },
    screen: { type: 'string' },
    state: { type: 'string' },
    'full-page': { type: 'boolean', default: false },
    print: { type: 'boolean', default: false },
    png: { type: 'boolean', default: false },
    pages: { type: 'string' },
    url: { type: 'string' },
    wait: { type: 'string' },
    delay: { type: 'string' },
  },
});

/**
 * Returns true if an HTTP server responds at the given base URL within the
 * probe timeout. Any HTTP response (even an error status) counts as "running".
 */
const isServerRunning = async (baseUrl: string): Promise<boolean> => {
  try {
    await fetch(baseUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
};

const theme = values.theme === 'dark' ? 'dark' : 'light';
const fullPage = values['full-page'];
const print = values.print;
const printPng = print && values.png;
const pageRanges = values.pages?.trim();
const outPath = resolve(values.out ?? (print && !printPng ? 'screenshots/screenshot.pdf' : 'screenshots/screenshot.png'));

if (values.pages !== undefined && !print) {
  console.error('--pages can only be used with --print.');
  process.exit(1);
}
if (values.pages !== undefined && printPng) {
  console.error('--pages can only be used with print PDF output.');
  process.exit(1);
}
if (values.pages !== undefined && pageRanges === '') {
  console.error('--pages must not be empty.');
  process.exit(1);
}

// Resolve the device descriptor up front so a bad name fails fast.
const deviceName = values.device;
const deviceDescriptor = deviceName ? devices[deviceName] : undefined;
if (deviceName && !deviceDescriptor) {
  const available = Object.keys(devices).slice(0, 12).join(', ');
  console.error(`Unknown device "${deviceName}". Examples: ${available}, ...`);
  process.exit(1);
}

// Compute effective viewport dimensions, applying --orientation if specified
let baseViewport = printPng
  ? PRINT_PNG_VIEWPORT
  : (deviceDescriptor?.viewport ?? { width: Number(values.width), height: Number(values.height) });

if (values.orientation === 'landscape' && baseViewport.width < baseViewport.height) {
  baseViewport = { width: baseViewport.height, height: baseViewport.width };
} else if (values.orientation === 'portrait' && baseViewport.width > baseViewport.height) {
  baseViewport = { width: baseViewport.height, height: baseViewport.width };
}

// Decide whether to reuse an existing server or start our own.
const explicitUrl = values.url;
const baseUrl = explicitUrl ?? DEFAULT_BASE_URL;
const reuseExisting = explicitUrl !== undefined || (await isServerRunning(baseUrl));

let server: Awaited<ReturnType<typeof createServer>> | undefined;
let targetBaseUrl = baseUrl;

if (!reuseExisting) {
  console.log('No dev server detected; starting a temporary Vite server...');
  server = await createServer({ server: { port: 5173 } });
  await server.listen();
  targetBaseUrl = server.resolvedUrls?.local[0] ?? baseUrl;
} else {
  console.log(`Using existing server at ${baseUrl}`);
}

const targetUrl = new URL(values.path, targetBaseUrl).toString();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    colorScheme: theme,
    ...(printPng ? {} : deviceDescriptor),
    viewport: baseViewport,
  });
  const page = await context.newPage();

  if (printPng) {
    await page.emulateMedia({ media: 'print' });
  }

  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  // Wait for Phaser and Stumped automation bridge to finish booting
  await page.waitForFunction(
    () => Boolean((window as unknown as { __STUMPED__?: { ready?: boolean } }).__STUMPED__?.ready),
    { timeout: 10_000 },
  ).catch(() => undefined);

  // Apply optional --code, --state, and --screen orchestration
  if (values.code || values.state || values.screen) {
    await page.evaluate(
      ({ code, state, screen }) => {
        const bridge = window.__STUMPED__;
        if (!bridge) {
          return;
        }
        if (code) {
          bridge.playSeed(code);
        } else if ((screen === 'puzzle' || state) && bridge.getActiveSceneKey() !== 'PuzzleScene') {
          bridge.appController.startNewPuzzle();
          bridge.game.scene.stop('MainScene');
          bridge.game.scene.start('PuzzleScene');
        }

        const session = bridge.getSession();
        if (session && state) {
          const { size, solution } = session.puzzle;
          if (state === 'marks') {
            bridge.doubleTapCell(solution[0]);
            for (let c = 0; c < Math.min(4, size); c++) {
              if (c !== solution[0]) {
                bridge.tapCell(c);
              }
            }
          } else if (state === 'hypothesis') {
            bridge.doubleTapCell(solution[0]);
            const whatIfBtn = document.querySelector<HTMLButtonElement>('[data-testid="what-if-btn"]');
            whatIfBtn?.click();
            const openCells: number[] = [];
            for (let c = 0; c < size * size; c++) {
              if (c !== solution[0]) {
                openCells.push(c);
              }
            }
            if (openCells.length >= 4) {
              bridge.tapCell(openCells[0]);
              bridge.tapCell(openCells[1]);
              // Place two tentative stumps in the same row or touching to trigger conflict line
              bridge.doubleTapCell(openCells[2]);
              bridge.doubleTapCell(openCells[3]);
            }
          } else if (state === 'explain') {
            const explainBtn = document.querySelector<HTMLButtonElement>('[data-testid="hint-explain-btn"]');
            explainBtn?.click();
          } else if (state === 'won') {
            const solSet = new Set(solution);
            for (let c = 0; c < size * size; c++) {
              if (!solSet.has(c)) {
                bridge.tapCell(c);
              }
            }
            for (const s of solution) {
              bridge.doubleTapCell(s);
            }
          } else if (state === 'lost') {
            const solSet = new Set(solution);
            for (let c = 0; c < size * size && session.getStatus() === 'in_progress'; c++) {
              if (!solSet.has(c)) {
                session.revealCell(c);
              }
            }
            bridge.appController.persistSession();
          }
        }

        if (screen === 'main') {
          bridge.goToMain();
        } else if (screen === 'settings') {
          bridge.openSettings();
        } else if (screen === 'times') {
          bridge.openBestTimes();
        }
      },
      { code: values.code, state: values.state, screen: values.screen },
    );
  }

  // Wait two animation frames for Phaser canvas to settle
  await page.evaluate(
    () => new Promise<void>((r) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          r();
        });
      });
    }),
  );

  if (values.wait) {
    await page.waitForSelector(values.wait);
  }
  if (values.delay) {
    await page.waitForTimeout(Number(values.delay));
  }

  await mkdir(dirname(outPath), { recursive: true });
  if (printPng) {
    await page.screenshot({ path: outPath });
  } else if (print) {
    await page.pdf({
      path: outPath,
      format: 'Letter',
      printBackground: true,
      pageRanges,
    });
  } else {
    await page.screenshot({ path: outPath, fullPage });
  }

  console.log(`Captured ${targetUrl} (${theme}${deviceName ? `, ${deviceName}` : ''}${values.orientation ? `, ${values.orientation}` : ''}${print ? ', print' : ''}${printPng ? ' PNG' : ''}) -> ${outPath}`);
} finally {
  await browser.close();
  if (server) {
    await server.close();
  }
}
