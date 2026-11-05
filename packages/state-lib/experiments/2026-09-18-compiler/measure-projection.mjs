import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from '../../build-tools/node_modules/esbuild/lib/main.js';
import { project as baseline } from './projection-fixture/src/baseline.ts';
import { project as candidate } from './projection-fixture/src/specialized.ts';
const root = fileURLToPath(new URL('./projection-fixture/', import.meta.url));
const cli = fileURLToPath(new URL('../../cli/bin/state', import.meta.url));
const config = root + 'state.config.json';
const sourceHash = JSON.parse(
  execFileSync('python3', [cli, 'doctor', '--config', config], { encoding: 'utf8' }),
).sourceHash;
let checks = 0;
for (let i = 0; i < 5000; i++) {
  const input = { id: i, done: !!(i % 2), unused: 'retained outside projection' };
  assert.deepEqual(candidate(input), baseline(input));
  checks++;
}
for (const fn of [baseline, candidate]) {
  const accesses = [];
  const input = new Proxy(
    { id: 2, done: false },
    {
      get(object, key) {
        accesses.push(key);
        return object[key];
      },
    },
  );
  assert.deepEqual(fn(input), { id: 2, done: false });
  assert.deepEqual(accesses, ['id', 'done']);
  checks += 2;
  const result = fn({});
  assert.deepEqual(Object.keys(result), ['id', 'done']);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  checks += 2;
}
const records = [];
let checksum = 0;
const count = 40000;
for (const [name, size] of [
  ['one-row', 1],
  ['many-rows', 1000],
]) {
  const rows = Array.from({ length: size }, (_, i) => ({ id: i, done: !!(i & 1) })),
    times = { baseline: [], candidate: [] };
  for (let trial = -3; trial < 9; trial++)
    for (const which of trial % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
      const fn = which === 'baseline' ? baseline : candidate;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        const value = fn(rows[i % size]);
        checksum += (value.done ? 1 : 0) + Number(value.id);
      }
      const elapsed = (performance.now() - start) / count;
      if (trial >= 0) times[which].push(elapsed);
    }
  records.push({
    unit: 'projection',
    variant: 'static-fields',
    target: 'node26-m4pro',
    case: name,
    metric: 'meanOperationMs',
    ...times,
  });
  const sizes = { baseline: [], candidate: [] };
  for (let trial = 0; trial < 5; trial++)
    for (const which of ['baseline', 'candidate']) {
      const result = await build({
        entryPoints: [root + 'src/' + (which === 'baseline' ? 'baseline' : 'specialized') + '.ts'],
        bundle: true,
        minify: true,
        format: 'esm',
        write: false,
        logLevel: 'silent',
        target: 'es2022',
      });
      sizes[which].push(gzipSync(result.outputFiles[0].contents).length);
    }
  records.push({
    unit: 'projection',
    variant: 'static-fields',
    target: 'node26-m4pro',
    case: name,
    metric: 'gzipBytes',
    ...sizes,
  });
}
assert(Number.isSafeInteger(checksum));
const testHash = createHash('sha256')
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex');
const profile = {
  version: 1,
  sourceHash,
  correctness: [
    { unit: 'projection', variant: 'static-fields', target: 'node26-m4pro', passed: true, testHash, checks },
  ],
  records,
  method:
    'Nine alternating timing trials after three warmups; 40000 calls per trial, batch mean not event P95. Five independent minified bundle builds per byte measurement. Scalar projection, not application state/DOM speed.',
  node: process.version,
};
writeFileSync(new URL('./results/projection-profile.json', import.meta.url), JSON.stringify(profile, null, 2) + '\n');
const result = JSON.parse(
  execFileSync(
    'python3',
    [
      cli,
      'build',
      '--config',
      config,
      '--profile',
      fileURLToPath(new URL('./results/projection-profile.json', import.meta.url)),
    ],
    { encoding: 'utf8' },
  ),
);
writeFileSync(new URL('./results/projection-manifest.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ checks, selected: result.decisions[0].selected, emitted: result.emitted, records }));
