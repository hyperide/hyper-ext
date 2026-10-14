import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mts';
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
const artifacts = fileURLToPath(new URL('./artifacts/visible-workbench/', import.meta.url));
mkdirSync(artifacts, { recursive: true });
const results: unknown[] = [],
  errors: string[] = [];
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('pageerror', (error) => errors.push(error.message));
      for (const example of ['task-screen', 'zustand-task-screen']) {
        await page.goto(`${server.url}/repl/${example}`);
        await page.locator(`.pane-primary[data-example="${example}"]`).waitFor();
        for (const label of ['Interactive example', 'Live state', 'Editable code']) {
          assert(await page.getByRole('region', { name: label, exact: true }).isVisible(), label);
        }
        assert.equal(await page.locator('.guide-source .cm-editor').count(), 3);
        assert.equal(
          await page.locator('.guide-source').evaluate((node) => node.closest('details:not([open])') !== null),
          false,
        );
        assert.equal(await page.locator('.example-screen').count(), 0, 'No code executes on cold entry');
        const boxes = await page.locator('.workbench-grid > section').evaluateAll((nodes) =>
          nodes.map((node) => ({
            x: node.getBoundingClientRect().x,
            y: node.getBoundingClientRect().y,
            width: node.getBoundingClientRect().width,
          })),
        );
        assert.equal(boxes.length, 3);
        assert(
          Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y)) < 2,
          'Desktop UI/state/code must share one row',
        );
        assert(
          boxes[0].x + boxes[0].width <= boxes[1].x && boxes[1].x + boxes[1].width <= boxes[2].x,
          'Panels must not overlap',
        );
        await page.locator('.initialize-example').click();
        await page.locator('.example-screen').waitFor();
        const read = page.getByLabel('Inspect a value', { exact: true });
        await read.fill('store.tasks.a.done');
        await page.waitForFunction(() => document.querySelector('.path-value')?.textContent === 'false');
        await page.locator('.screen-task input').first().check();
        await page.waitForFunction(() => document.querySelector('.path-value')?.textContent === 'true');
        await page.getByLabel('Task filter').selectOption('open');
        assert.equal(await page.locator('.screen-task').count(), 1);
        await page.getByRole('button', { name: 'Complete both tasks', exact: true }).click();
        await page.getByText('Ready to launch. The checklist and count agree.', { exact: true }).waitFor();
        await read.fill('store.tasks.b.done');
        assert.equal(await page.locator('.path-value').textContent(), 'true');
        await read.fill('store.tasks.b.done()');
        assert((await page.locator('.path-value').textContent())?.includes('data path'));
        await page.getByLabel('Manual command', { exact: true }).fill("setFilter('all'); toggle('b')");
        await page.getByRole('button', { name: 'Run this command', exact: true }).click();
        await read.fill('store.tasks.b.done');
        await page.waitForFunction(() => document.querySelector('.path-value')?.textContent === 'false');
        assert.equal(await page.locator('.screen-task').count(), 2);
        assert((await page.locator('.changed-paths').textContent())?.includes('store.tasks.b.done'));
        // Template navigation and refresh must keep edited code without executing it.
        const marker = '// saved draft proof';
        const setupEditor = page.locator('.guide-source .cm-content').first();
        await setupEditor.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type(`\n${marker}`);
        await page.getByRole('link', { name: 'Undo & redo', exact: true }).click();
        await page.locator('.pane-primary[data-example="undo"]').waitFor();
        await page.getByRole('link', { name: 'React task screen', exact: true }).click();
        await page.locator('.pane-primary[data-example="task-screen"]').waitFor();
        if (example === 'task-screen')
          assert((await page.locator('.guide-source .cm-content').first().innerText()).includes(marker));
        await page.goto(`${server.url}/repl/${example}`);
        await page.locator(`.pane-primary[data-example="${example}"]`).waitFor();
        assert.equal(await page.locator('.example-screen').count(), 0);
        assert((await page.locator('.guide-source .cm-content').first().innerText()).includes(marker));
        await page.getByRole('button', { name: 'Scripted demo', exact: true }).click();
        await page.locator('.runall').click();
        await page.getByText('Ready to launch. The checklist and count agree.', { exact: true }).waitFor();
        await page.screenshot({ path: `${artifacts}${engine.name()}-${example}-desktop.png` });
        await page.setViewportSize({ width: 390, height: 844 });
        for (const label of ['Interactive example', 'Live state', 'Editable code']) {
          assert(await page.getByRole('region', { name: label, exact: true }).isVisible());
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `${artifacts}${engine.name()}-${example}-mobile.png`, fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1000 });
        results.push({
          engine: engine.name(),
          example,
          coldSafe: true,
          manualNoDemo: true,
          realUi: true,
          liveValues: true,
          manualCode: true,
        });
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${artifacts}results.json`, JSON.stringify(results, null, 2));
  console.info(
    'PASS: real state/Zustand React screens, visible UI/state/code, manual commands and data-only inspection',
  );
} finally {
  await server.close();
}
