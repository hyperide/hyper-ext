import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import type * as ExampleLabClient from '../src/lib/example-lab/client';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:6919/');
  const results = await page.evaluate(async () => {
    const modulePath = '/src/lib/example-lab/client.ts';
    const api: typeof ExampleLabClient = await import(modulePath);
    const output = [];
    for (const id of ['board-commands', 'issue-triage']) {
      const build = await api.compileProject(await api.loadProject(id), {});
      const settings = { count: 50, operation: 'point' as const, samples: 3, historyLimit: 40, includeSetup: false };
      const initial = await api.previewProject(build, settings, []);
      const moved = await api.previewProject(build, settings, [{ operation: 'move', index: 0 }]);
      const toggled = await api.previewProject(build, settings, [
        { operation: 'move', index: 0 },
        { operation: 'point', index: 49 },
      ]);
      output.push({ id, initial, moved, toggled });
    }
    return output;
  });
  for (const { id, initial, moved, toggled } of results) {
    assert.equal(initial.columns[0].count, 50, `${id} counts full rows, not the preview window`);
    assert.equal(moved.columns[0].count, 49);
    assert.equal(moved.columns[1].count, 1);
    assert.equal(moved.columns[1].items[0].index, 49);
    assert.equal(toggled.columns[1].items[0].done, true, `${id} edits selected card in another column`);
    assert.equal(toggled.columns[0].items[0].done, false);
  }
  console.log('PASS: full counts and correct selection beyond a bounded preview');
} finally {
  await browser.close();
}
