import type { BenchmarkResult } from '../src/lib/example-lab/types';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const built = await build({
  stdin: {
    contents: "export {submitMeasurement} from './src/lib/example-lab/client.ts';",
    resolveDir: resolve(import.meta.dirname, '..'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'raw-source',
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-source',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'raw-source' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});
const { submitMeasurement } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(built.outputFiles[0].text + '\n//# sourceURL=measurement-client-under-test.mjs').toString('base64')
);

const result: BenchmarkResult = {
  version: 1,
  exampleId: 'board-commands',
  sourceHash: 'a'.repeat(64),
  sourceRevision: 'b'.repeat(40),
  settings: { count: 30, operation: 'move', samples: 3, historyLimit: 40, includeSetup: false },
  rows: (['reference', 'compiled'] as const).map((variant) => ({
    variant,
    samplesMs: [1, 2, 3],
    medianMs: 2,
    p95Ms: 3,
    iterations: 10,
    totalMs: 60,
    checksum: 'c'.repeat(64),
  })),
  equivalent: true,
  environment: { engine: 'Chromium', engineVersion: '153', platform: 'macOS', timerResolutionMs: 0.1 },
  createdAt: '2026-09-26T12:00:00.000Z',
};
const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls++;
      assert.equal(input, '/api/measurements', 'Sharing must remain on the current site');
      assert.equal(init?.credentials, 'same-origin', 'The protected lab requires its same-origin session');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(String(init?.body)), result);
      return new Response(JSON.stringify({ stored: true, duplicate: false }), { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  assert.deepEqual(await submitMeasurement(result), { stored: true, duplicate: false });
  assert.equal(calls, 1);
  await assert.rejects(submitMeasurement({ ...result, equivalent: false }), /same state/);
  assert.equal(calls, 1, 'A divergent comparison must not be sent');
  globalThis.fetch = Object.assign(async () => new Response('Unavailable', { status: 503 }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(submitMeasurement(result), /remains on this device/);
  const offline = new TypeError('Failed to fetch');
  globalThis.fetch = Object.assign(
    async () => {
      throw offline;
    },
    { preconnect: originalFetch.preconnect },
  );
  await assert.rejects(submitMeasurement(result), (error) => error === offline);
  assert.equal(result.rows[0].medianMs, 2, 'Submission never mutates the local measurement');
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'PASS: same-origin measurement session, explicit submission and divergent/unavailable/offline failure behavior',
);
