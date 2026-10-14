/** Drives the served site's real lazy import with its editor chunk held at the
 * network boundary. The shared gate must reject missing/partial editor sets. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, errors } from 'playwright';
import { serveStatic } from './static-server.mts';
import { waitForWorkbenchEditors } from './workbench-readiness.mts';

const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let releaseChunk!: () => void;
  const chunkHeld = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  const requested = page.waitForRequest('**/assets/CodeEditor-*.js', { timeout: 30_000 });
  await page.route('**/assets/CodeEditor-*.js', async (route) => {
    await chunkHeld;
    await route.continue();
  });
  try {
    await page.goto(`${server.url}/repl/task-screen`, { waitUntil: 'domcontentloaded' });
    await page.locator('.pane-primary[data-example="task-screen"]').waitFor();
    for (const label of ['Interactive example', 'Live state', 'Editable code']) {
      assert(await page.getByRole('region', { name: label, exact: true }).isVisible(), label);
    }
    await requested;
    assert.equal(await page.locator('.guide-source .cm-editor').count(), 0);
    console.log('RED observation: visible panels, editor chunk held, immediate count = 0 (expected 3)');
    // The helper starts while the genuine import is unresolved. Releasing the
    // response lets React and CodeMirror create the editors, without DOM fakes.
    const ready = waitForWorkbenchEditors(page);
    releaseChunk();
    await ready;
    assert.equal(await page.locator('.guide-source .cm-editor').count(), 3);
    assert.equal(await page.locator('.example-screen').count(), 0);
    assert.deepEqual(pageErrors, []);
    console.log('GREEN: delayed real chunk hydrated exactly 3 editors; cold execution count = 0');
  } finally {
    releaseChunk();
  }
  for (const count of [0, 2, 4]) {
    await page.setContent(`<div class="guide-source">${'<div class="cm-editor"></div>'.repeat(count)}</div>`);
    await assert.rejects(waitForWorkbenchEditors(page, 250), (error: unknown) => error instanceof errors.TimeoutError);
    console.log(`PASS negative: ${count} editors rejected with TimeoutError`);
  }
} finally {
  await browser.close();
  await server.close();
}
