/**
 * @file Browser detection for Playwright MCP companion
 *
 * Accessed via: Internal module, used by extension.ts setup wizard
 * Assumptions: Playwright MCP `--browser` flag accepts "chrome" (system Chrome,
 * default) and "chromium" (Playwright's bundled chromium from cache).
 *
 * Detection priority:
 * 1. System Chrome → no extra args (MCP default)
 * 2. Playwright bundled chromium → `--browser chromium`
 * 3. System Chromium → `--executable-path <path>`
 * 4. Nothing → need to install
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Google Chrome paths per platform (Playwright MCP default: `--browser chrome`) */
export const CHROME_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/** System Chromium paths per platform (fallback via `--executable-path`) */
export const CHROMIUM_PATHS: Record<string, string[]> = {
  darwin: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: [],
};

/** Playwright browser cache directory per platform */
export function playwrightCacheDir(): string {
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Caches', 'ms-playwright');
    case 'win32':
      // || is intentional: empty LOCALAPPDATA should fall through to homedir() (not use '' as path)
      return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
    default:
      // || is intentional: empty XDG_CACHE_HOME should fall through to homedir() (not use '' as path)
      return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright');
  }
}

/** Check if Playwright has bundled chromium in its cache */
export function hasPlaywrightBundledChromium(): boolean {
  const cacheDir = process.env.PLAYWRIGHT_BROWSERS_PATH || playwrightCacheDir();
  try {
    return readdirSync(cacheDir).some((e) => e.startsWith('chromium-'));
  } catch {
    return false;
  }
}

/** Find first existing path in a list */
function findExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

export type BrowserDetectionResult = { found: true; extraArgs: string[] } | { found: false };

/**
 * Detect available browser for Playwright MCP.
 * Returns extra CLI args to pass to `@playwright/mcp` if a non-default browser is found.
 */
export function detectBrowserForPlaywright(): BrowserDetectionResult {
  // 1. System Chrome → MCP default, no extra args
  const chromePaths = CHROME_PATHS[process.platform] ?? [];
  if (chromePaths.some((p) => existsSync(p))) {
    return { found: true, extraArgs: [] };
  }

  // 2. Playwright bundled chromium → --browser chromium
  if (hasPlaywrightBundledChromium()) {
    return { found: true, extraArgs: ['--browser', 'chromium'] };
  }

  // 3. System Chromium → --executable-path <path>
  const chromiumPaths = CHROMIUM_PATHS[process.platform] ?? [];
  const chromiumPath = findExisting(chromiumPaths);
  if (chromiumPath) {
    return { found: true, extraArgs: ['--executable-path', chromiumPath] };
  }

  // 4. Nothing found
  return { found: false };
}
