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
 *    --path <p>      Route to capture          (default /)  *
 *    --out <file>    Output path       (default screenshots/screenshot.png,
 *                                      screenshots/screenshot.pdf with --print
 *                                      unless --png is set)
 *    --theme <t>     light | dark              (default light)
 *    --device <d>    Playwright device name, e.g. "iPhone 15"
 *    --width <n>     Viewport width  (default 1280, ignored with --device)
 *    --height <n>    Viewport height (default 800, ignored with --device)
 *    --full-page     Capture the full scrollable page         *
 *    --print         Output a print-formatted PDF             *
 *    --png           Output PNG when used with --print        *
 *    --pages <range> PDF page ranges, e.g. "1-5, 8"           *
 *    --url <base>    Base URL to use; disables auto-start      *
 *    --wait <sel>    Wait for a CSS selector before capturing  *
 *    --delay <ms>    Extra settle delay before capturing       *
 *    --code <code>  Open a reproducible puzzle                 *
 *    --click <sel>  Click a selector (repeat for a sequence)    *
 *    --storage <f>  Load a saved stumped.v1 JSON fixture        *
 *    --landscape    Use the landscape device/viewport shape    *
\* ========================================================= */

import { parseArgs } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { chromium, devices } from '@playwright/test';
import { createServer } from 'vite';

/** Default base URL probed for an already-running dev server. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:5178';

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
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '800' },
    'full-page': { type: 'boolean', default: false },
    print: { type: 'boolean', default: false },
    png: { type: 'boolean', default: false },
    pages: { type: 'string' },
    url: { type: 'string' },
    wait: { type: 'string' },
    delay: { type: 'string' },
    code: { type: 'string' },
    click: { type: 'string', multiple: true },
    storage: { type: 'string' },
    landscape: { type: 'boolean', default: false },
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

// Decide whether to reuse an existing server or start our own.
const explicitUrl = values.url;
const baseUrl = explicitUrl ?? DEFAULT_BASE_URL;
const reuseExisting = explicitUrl !== undefined || (await isServerRunning(baseUrl));

let server: Awaited<ReturnType<typeof createServer>> | undefined;
let targetBaseUrl = baseUrl;

if (!reuseExisting) {
  console.log('No dev server detected; starting a temporary Vite server...');
  server = await createServer({ server: { host: '127.0.0.1', port: 5178, strictPort: true } });
  await server.listen();
  targetBaseUrl = server.resolvedUrls?.local[0] ?? baseUrl;
} else {
  console.log(`Using existing server at ${baseUrl}`);
}

const target = new URL(values.path, targetBaseUrl);
if (values.code) target.searchParams.set('code', values.code);
const targetUrl = target.toString();

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    colorScheme: theme,
    ...(printPng ? {} : deviceDescriptor),
    // An explicit --width/--height overrides the device viewport.
    ...(printPng
      ? { viewport: PRINT_PNG_VIEWPORT }
      : values.device ? {} : { viewport: { width: Number(values.width), height: Number(values.height) } }),
  });
  if (values.storage) {
    const raw = await readFile(resolve(values.storage), 'utf8');
    JSON.parse(raw); // Fail early on malformed capture fixtures.
    await context.addInitScript((save: string) => localStorage.setItem('stumped.v1', save), raw);
  }
  const page = await context.newPage();
  if (values.landscape) {
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: Math.max(viewport.width, viewport.height), height: Math.min(viewport.width, viewport.height) });
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  if (printPng) {
    await page.emulateMedia({ media: 'print' });
  }

  await page.goto(targetUrl, { waitUntil: 'networkidle' });
  if (values.code) await page.waitForSelector('#board canvas[data-ready="true"]', { timeout: 60_000 });
  for (const selector of values.click ?? []) await page.locator(selector).click();
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('#home')?.inert, undefined, { timeout: 60_000 });

  if (values.wait) {
    await page.waitForSelector(values.wait);
  }
  if (values.delay) {
    await page.waitForTimeout(Number(values.delay));
  }
  if (await page.locator('#puzzle-screen').isVisible()) {
    await page.waitForSelector('#board canvas[data-ready="true"]', { timeout: 60_000 });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  if (errors.length) throw new Error(`Page errors during capture:\n${errors.join('\n')}`);

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

  console.log(`Captured ${targetUrl} (${theme}${deviceName ? `, ${deviceName}` : ''}${print ? ', print' : ''}${printPng ? ' PNG' : ''}) -> ${outPath}`);
} finally {
  await browser.close();
  if (server) {
    await server.close();
  }
}
