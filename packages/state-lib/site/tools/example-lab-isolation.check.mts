/** Exercise the real execution-worker sandbox in Chromium. */
import assert from 'node:assert/strict';
import { build } from 'esbuild-wasm';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve as resolvePath } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from './browser.mts';
import type * as ExecutionSandbox from '../src/lib/example-lab/execution-sandbox';

declare const sandbox: typeof ExecutionSandbox;
const bundle = await build({
  entryPoints: ['src/lib/example-lab/execution-sandbox.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'sandbox',
  plugins: [
    {
      name: 'raw-worker',
      setup(builder) {
        builder.onResolve({ filter: /\.js\?raw$/ }, (args) => ({
          path: resolvePath(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-worker',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'raw-worker' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});
let requests = 0;
const server = createServer((request, response) => {
  if (request.url === '/probe') requests++;
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Sandbox boundary check</title>');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}`;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const preview = await page.evaluate(async () => {
    const result = sandbox.executeInSandbox({
      kind: 'preview',
      code: `var __stateExample = {createModel() {
        let text = 'Original';
        return {
          step(operation, index, value) { text = value; },
          snapshot() { return {
            document: {title: 'Owned worker', columns: [{id: 'one', title: 'Tasks', items: [{id: 1, text, done: false}]}]},
            canUndo: false, canRedo: false
          }; },
          dispose() {}
        };
      }};`,
      settings: { count: 30, operation: 'point', samples: 5, historyLimit: 40, includeSetup: false },
      actions: [{ operation: 'point', index: 0, text: 'Updated' }],
    });
    return await result;
  });
  assert.deepEqual(preview, {
    title: 'Owned worker',
    total: 1,
    canUndo: false,
    canRedo: false,
    columns: [{ id: 'one', title: 'Tasks', count: 1, items: [{ id: '1', index: 0, text: 'Updated', done: false }] }],
  });
  const isolated = await page.evaluate(async (probeUrl) => {
    // Deliberately hostile user code probes the same production sandbox boundary.
    const code = `self.addEventListener('message', async (event) => {
      event.stopImmediatePropagation();
      let network = 'allowed';
      try { await fetch(event.data.actions[0].text); } catch { network = 'denied'; }
      self.postMessage({result: {
        title: [self.origin, typeof document, typeof localStorage, network].join('|'),
        total: 0, canUndo: false, canRedo: false, columns: []
      }});
    }, {once: true});`;
    return await sandbox.executeInSandbox({
      kind: 'preview',
      code,
      actions: [{ operation: 'point', text: probeUrl }],
      settings: { count: 30, operation: 'point', samples: 5, historyLimit: 40, includeSetup: false },
    });
  }, `${url}/probe`);
  assert.equal('title' in isolated && isolated.title, 'null|undefined|undefined|denied');
  assert.equal(requests, 0, 'Worker code must not make an HTTP request');
  assert.equal(await page.locator('iframe').count(), 0, 'Completed executions remove their private frames');
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
console.log('PASS: real worker preview, opaque realm, network denial and cleanup');
