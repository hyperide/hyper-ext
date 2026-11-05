import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.env.LAB_BASE_URL ?? 'http://127.0.0.1:6919';
mkdirSync('tools/artifacts/example-lab', { recursive: true });
for (const [name, engine] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as const) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(origin + '/');
    assert(!requests.some((url) => url.endsWith('.wasm')), 'Compiler assets must not load on the landing page');
    const results = await page.evaluate(async () => {
      const modulePath = '/src/lib/example-lab/client.ts';
      const api: typeof import('../src/lib/example-lab/client') = await import(modulePath);
      const output = [];
      for (const id of ['board-commands', 'issue-triage']) {
        const project = await api.loadProject(id),
          build = await api.compileProject(project, {});
        const settings = { count: 30, operation: 'move' as const, samples: 3, historyLimit: 40, includeSetup: false };
        const initial = await api.previewProject(build, settings, []),
          moved = await api.previewProject(build, settings, [{ operation: 'move' }]);
        const undone = await api.previewProject(build, settings, [{ operation: 'move' }, { operation: 'undo' }]);
        const measured = await api.runBenchmark(build, settings);
        output.push({
          id,
          total: initial.total,
          moved: moved.columns[1].items.length,
          undo: JSON.stringify(initial.columns) === JSON.stringify(undone.columns),
          measured,
          bytes: { reference: build.artifacts.reference.rawBytes, compiled: build.artifacts.compiled.rawBytes },
          generated: Object.keys(build.generatedFiles),
        });
      }
      return output;
    });
    for (const result of results) {
      assert.equal(result.total, 30);
      assert.equal(result.moved, 1);
      assert(result.undo);
      assert(result.measured.equivalent);
      assert.equal(result.generated.length, 4);
    }
    const checks = await page.evaluate(async () => {
      const modulePath = '/src/lib/example-lab/client.ts';
      const api: typeof import('../src/lib/example-lab/client') = await import(modulePath);
      const project = await api.loadProject('board-commands');
      let invalid = false;
      try {
        await api.compileProject(project, { 'src/entry.ts': 'export const = ;' });
      } catch {
        invalid = true;
      }
      const controller = new AbortController();
      const pending = api.compileProject(project, {}, controller.signal);
      controller.abort();
      let cancelled = false;
      try {
        await pending;
      } catch (error) {
        cancelled = (error as Error).name === 'AbortError';
      }
      const sandboxPath = '/src/lib/example-lab/execution-sandbox.ts';
      const sandbox: typeof import('../src/lib/example-lab/execution-sandbox') = await import(sandboxPath);
      const running = new AbortController();
      const run = sandbox.executeInSandbox(
        {
          kind: 'preview',
          code: 'while(true){}',
          settings: { count: 1, operation: 'point', samples: 3, historyLimit: 40, includeSetup: false },
        },
        running.signal,
      );
      setTimeout(() => running.abort(), 100);
      let stopped = false;
      try {
        await run;
      } catch (error) {
        stopped = (error as Error).name === 'AbortError';
      }
      return { invalid, cancelled, stopped, frames: document.querySelectorAll('iframe[sandbox]').length };
    });
    assert.deepEqual(checks, { invalid: true, cancelled: true, stopped: true, frames: 0 });
    assert(
      !requests.some((url) => url.endsWith('/api/measurements')),
      'Runs must not share data without an explicit action',
    );
    writeFileSync(
      `tools/artifacts/example-lab/runtime-${name}.json`,
      JSON.stringify({ engine: name, version: browser.version(), results, checks }, null, 2),
    );
    console.log(
      'PASS',
      name,
      'real Wasm compilation, distinct source models, moves/undo, equivalent browser runs and cancellation',
    );
  } finally {
    await browser.close();
  }
}
