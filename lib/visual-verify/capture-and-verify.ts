/**
 * @file Headless-Chrome capture + style-presence guard for the agent proof path.
 *
 * Accessed via: agent proof/screenshot scripts and demos that capture a render
 *   and want to assert it is actually styled before the PNG ships.
 * Assumptions: `playwright-core` is resolvable (transitive in this repo, used
 *   only here — the detector itself stays dependency-free). Imported lazily so
 *   nothing in the product bundle pulls in a browser driver.
 *
 * Why this lives in the main repo: the full VS Code / hero-shot capture helpers
 * live in `ext-test-projects` (which must not be co-edited here). This is the
 * generic, framework-light building block — capture any URL/file with headless
 * Chrome and run the unstyled-render detector against the live page — usable by
 * in-repo proof scripts, demos, and (later) the e2e blank-webview guard.
 */

import {
  assertStyled,
  detectStylePresenceOnPage,
  type DetectStyleOptions,
  type StylePresenceVerdict,
} from './detect-style-presence';

export interface CaptureAndVerifyOptions {
  /** URL or `file://` path to load. */
  url: string;
  /** Where to write the PNG. */
  screenshotPath: string;
  /** Capture the full scrollable page (default true). */
  fullPage?: boolean;
  /** Viewport (default 1280x800). */
  viewport?: { width: number; height: number };
  /**
   * When true (default), throw a `StyleMissingError` if the render is judged
   * unstyled — so an unstyled proof cannot silently ship. Set false to capture
   * the verdict without failing (e.g. to screenshot a known-unstyled fixture).
   */
  assertStyled?: boolean;
  /** Extra detector options (app-root selectors, sheet-rule threshold). */
  detect?: DetectStyleOptions;
  /** Milliseconds to wait after load for late CSS/fonts (default 250). */
  settleMs?: number;
  /**
   * Navigation wait strategy (default 'load'). NOT 'networkidle' by default:
   * dev-preview / app pages keep long-lived connections open (HMR websockets,
   * EventSource/SSE status streams, long-polling), so 'networkidle' would hang
   * until Playwright's timeout and fail before any screenshot/verdict. Pass
   * 'networkidle' explicitly only for fully-static pages.
   */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  /** Navigation timeout in ms (default 30000). */
  navTimeoutMs?: number;
  /** Label used in the thrown error / returned verdict for context. */
  label?: string;
}

export interface CaptureAndVerifyResult {
  screenshotPath: string;
  verdict: StylePresenceVerdict;
}

/**
 * Launch headless Chrome, load `url`, screenshot to `screenshotPath`, then run
 * the unstyled-render detector against the live page. With `assertStyled` (the
 * default) an unstyled render throws `StyleMissingError` AFTER the PNG is written
 * (so you still get the evidence screenshot of the failure).
 *
 * Opt-in and non-breaking: nothing calls this automatically. Proof scripts wire
 * it in explicitly when they want the guard.
 */
export async function captureAndVerify(options: CaptureAndVerifyOptions): Promise<CaptureAndVerifyResult> {
  // Lazy import so the product/runtime bundle never pulls in playwright-core.
  const { chromium } = await import('playwright-core');

  const viewport = options.viewport ?? { width: 1280, height: 800 };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(options.url, {
      waitUntil: options.waitUntil ?? 'load',
      timeout: options.navTimeoutMs ?? 30_000,
    });
    if (options.settleMs !== 0) {
      await page.waitForTimeout(options.settleMs ?? 250);
    }
    await page.screenshot({ path: options.screenshotPath, fullPage: options.fullPage ?? true });

    const shouldAssert = options.assertStyled ?? true;
    const verdict = shouldAssert
      ? await assertStyled(page, { ...options.detect, label: options.label })
      : await detectStylePresenceOnPage(page, options.detect);

    return { screenshotPath: options.screenshotPath, verdict };
  } finally {
    await browser.close();
  }
}
