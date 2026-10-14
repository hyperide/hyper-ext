import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { fileURLToPath } from 'node:url';
import { serveStatic } from './static-server.mts';
import { exampleById } from '../src/data/examples';
const server = await serveStatic(fileURLToPath(new URL('../dist-served/', import.meta.url)), false);
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${server.url}/repl/task-screen`);
      await page.locator('.initialize-example').click();
      await page.locator('.example-screen').waitFor();
      const setup = page.locator('.guide-source .cm-content').first();
      await setup.fill('const store = (');
      await page.locator('.initialize-example').click();
      await page.locator('.repl-err').waitFor();
      assert.equal(await page.locator('.example-screen').count(), 0, 'Cancelled old UI must not survive invalid Apply');
      await setup.fill(exampleById('task-screen')!.setup);
      await page.locator('.initialize-example').click();
      await page.locator('.example-screen').waitFor();
      const command = page.getByLabel('Manual command', { exact: true });
      await command.fill(
        "watch(() => { store.state.tasks.a.done; document.documentElement.dataset.watchCalls = String(Number(document.documentElement.dataset.watchCalls || '0') + 1) }); globalThis.__workbenchPreviousStore = store",
      );
      await page.getByRole('button', { name: 'Run this command', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.watchCalls === '1');
      await page.locator('.screen-task input').first().check();
      await page.waitForFunction(() => document.documentElement.dataset.watchCalls === '2');
      await command.fill("setFilter('all')");
      await page.getByRole('button', { name: 'Run this command', exact: true }).click();
      await page.locator('.screen-task input').first().uncheck();
      await page.waitForFunction(() => document.documentElement.dataset.watchCalls === '3');
      await command.fill("log('workbench-command-marker-7')");
      await page.getByRole('button', { name: 'Run this command', exact: true }).click();
      await page.locator('.command-out:has-text("workbench-command-marker-7")').waitFor();
      await page.locator('.initialize-example').click();
      await page.locator('.example-screen').waitFor();
      await command.fill(
        "globalThis.__workbenchPreviousStore.action('Old store', state => { state.tasks.a.done = true })()",
      );
      await page.getByRole('button', { name: 'Run this command', exact: true }).click();
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.watchCalls),
        '3',
        'Apply must clean up the previous manual watcher',
      );
      await command.fill("await sleep(1000); document.documentElement.dataset.lateCommand = 'bad'");
      await page.getByRole('button', { name: 'Run this command', exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.locator('.initialize-example').click();
      await page.locator('.example-screen').waitFor();
      await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.lateCommand), undefined);
      assert.equal(await page.locator('.repl-err').count(), 0);
      assert.deepEqual(errors, []);
      console.info(
        `PASS: ${engine.name()} invalid Apply/retry, manual resource ownership and cancelled command isolation`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
