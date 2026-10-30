import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/* ========================================================= *\
 *  Chromium for screenshots and e2e tests, installed on     *
 *  first use rather than on every `pnpm install`, so the    *
 *  deploy jobs never download it.                           *
\* ========================================================= */

/** Chromium preinstalled in Claude Code cloud containers, which refuse `playwright install`. */
const PREINSTALLED = '/opt/pw-browsers/chromium';

/**
 * Finds a Chromium to launch, installing Playwright's own build the first time.
 * @returns a path for `launch({ executablePath })`, or undefined to use Playwright's own build
 */
export function chromiumPath(): string | undefined {
  if (existsSync(chromium.executablePath())) {
    return undefined;
  }
  if (existsSync(PREINSTALLED)) {
    return PREINSTALLED;
  }
  const cli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
  execFileSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  return undefined;
}
