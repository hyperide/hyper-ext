import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mts';

const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${server.url}/repl/undo`, { waitUntil: 'networkidle' });
        const action = await page.locator('.pane-primary .initialize-example').boundingBox();
        assert(
          action && action.y + action.height <= 844,
          `${engine.name()}/${width}: first action below viewport: ${JSON.stringify(action)}`,
        );
        assert.equal(await page.locator('.pane-primary .guide-debug').getAttribute('open'), null);
        assert(await page.locator('.pane-primary .guide-source').isVisible());
        assert.equal(await page.locator('.pane-primary .guide-source .cm-editor').count(), 3);
        await page.locator('.pane-primary .initialize-example').click();
        await page.getByLabel('Task title', { exact: true }).waitFor();
        assert(await page.getByLabel('Task title', { exact: true }).isVisible());
        assert(await page.getByLabel('Estimate', { exact: true }).isVisible());
      }
      await page.goto(`${server.url}/api`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        document.documentElement.dataset.searchFocusCount = '0';
        document.querySelector('.searchinput')?.addEventListener('focus', () => {
          document.documentElement.dataset.searchFocusCount = String(
            Number(document.documentElement.dataset.searchFocusCount) + 1,
          );
        });
      });
      await page.locator('.navsection').click();
      assert.equal(
        await page.evaluate(() => Number(document.documentElement.dataset.searchFocusCount)),
        0,
        'Browse opening must not focus search even momentarily',
      );
      // Exercise a changed programmatic opening intent, not a real click through native modal inertness.
      await page.locator('.nav-menu-search').evaluate((button) => (button as HTMLButtonElement).click());
      await page.waitForFunction(() => document.activeElement === document.querySelector('.searchinput'));
      await page.locator('.searchinput').fill('signal');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#site-menu[open]').count(), 0);
      console.info(`PASS: ${engine.name()} first-viewport lesson action, labelled UI and browse/search focus intent`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
