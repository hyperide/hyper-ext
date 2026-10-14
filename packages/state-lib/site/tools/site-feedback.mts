import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mts';
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
const artifacts = fileURLToPath(new URL('./artifacts/site-feedback/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
const results: unknown[] = [],
  errors: string[] = [];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${server.url}/api`);
      for (const trigger of ['.navcurrent', '.navsection', '.nav-menu-search']) {
        await page.locator(trigger).click();
        const active = await page.evaluate(() => document.activeElement === document.querySelector('.searchinput'));
        assert.equal(active, trigger === '.nav-menu-search', `${engine.name()}: opening focus for ${trigger}`);
        assert(await page.locator('.searchinput').isVisible());
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('#site-menu[open]'));
        assert(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), trigger));
      }
      results.push({ engine: engine.name(), openingFocus: true });
      for (const width of [320, 390, 430, 768]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('.navsection').click();
        const size = await page.locator('.navigation-results').evaluate((node) => {
          node.scrollLeft = 500;
          return { width: node.clientWidth, contents: node.scrollWidth, left: node.scrollLeft };
        });
        assert(size.contents <= size.width + 1, `horizontal overflow ${JSON.stringify(size)}`);
        assert.equal(size.left, 0);
        await page.keyboard.press('Escape');
      }
      assert.equal(await page.locator('#api-TaskStatus-charAt, #api-CancelReason-toString').count(), 0);
      assert((await page.locator('#api-TaskStatus').textContent())?.includes('pending'));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${server.url}/`);
      assert.equal(
        (await page.locator('h1').textContent())?.replace(/\s+/g, ' ').trim(),
        'One state model. Fewer places for bugs to hide.',
      );
      assert((await page.locator('meta[name="description"]').getAttribute('content'))?.includes('state-management'));
      const icons = await page
        .locator('svg.site-icon')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({ box: node.getAttribute('viewBox'), stroke: node.getAttribute('stroke-width') })),
        );
      assert(icons.length >= 3);
      assert(icons.every((icon) => icon.box === '0 0 24 24' && icon.stroke === '1.75'));
      await page.screenshot({ path: `${artifacts}${engine.name()}-home.png` });
      await page.locator('.landing-playband').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${artifacts}${engine.name()}-lessons.png` });
      await page.locator('.navsection').click();
      await page.screenshot({ path: `${artifacts}${engine.name()}-menu.png` });
      await page.keyboard.press('Escape');
      results.push({ engine: engine.name(), verticalOnly: true, apiClean: true, metadataAndIcons: true });
      await page.goto(`${server.url}/repl/undo`);
      const pane = page.locator('.pane-primary');
      assert.equal(await pane.locator('.runall').count(), 1);
      assert.equal(await pane.locator('.guide-debug').getAttribute('open'), null);
      assert.equal(await pane.locator('.step-once').isVisible(), false);
      await pane.locator('.initialize-example').click();
      const field = pane.locator('.ui-slot input').first();
      await field.waitFor();
      const original = await field.inputValue();
      await field.fill('Edited in the live example');
      await pane.getByRole('button', { name: /^undo$/i }).click();
      assert.equal(await field.inputValue(), original);
      await pane.getByRole('button', { name: /^redo$/i }).click();
      assert.equal(await field.inputValue(), 'Edited in the live example');
      await page.screenshot({ path: `${artifacts}${engine.name()}-repl.png` });
      await pane.locator('.guide-debug > summary').click();
      assert(await pane.locator('.repl-out').isVisible());
      await pane.getByRole('button', { name: 'Reset example', exact: true }).click();
      await pane.locator('.step-once').click();
      await page.waitForFunction(() => !!document.querySelector('.pane-primary .repl-scrub'));
      results.push({ engine: engine.name(), singlePrimaryAction: true, liveUndoRedo: true, optionalDebugger: true });
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    'PASS: trigger focus, vertical-only menus, truthful API, heading/metadata, SVGs and real lesson/debug interactions',
  );
} finally {
  writeFileSync(`${artifacts}results.json`, JSON.stringify({ results, errors }, null, 2));
  await server.close();
}
