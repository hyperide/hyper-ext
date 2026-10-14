import assert from 'node:assert/strict';
import type { Page } from 'playwright';

/** Used by the visible-workbench gate and its regression: panel visibility can
 * precede the lazy CodeMirror chunk, but readiness requires exactly three editors. */
export async function waitForWorkbenchEditors(page: Page, timeout = 30_000) {
  await page.waitForFunction(() => document.querySelectorAll('.guide-source .cm-editor').length === 3, undefined, {
    timeout,
  });
  assert.equal(await page.locator('.guide-source .cm-editor').count(), 3);
}
