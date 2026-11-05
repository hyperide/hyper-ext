import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('./', import.meta.url)),
  fixture = root + 'generated-fixture/';
mkdirSync(fixture + 'src', { recursive: true });
const baseline = `const fields=['id','done'];export function project(input){const output={};for(const key of fields)Object.defineProperty(output,key,{value:input[key],writable:true,enumerable:true,configurable:true});return output;}`;
writeFileSync(fixture + 'src/baseline.mjs', baseline);
writeFileSync(fixture + 'src/strategy.mjs', 'export {project} from "./baseline.mjs";');
writeFileSync(fixture + 'src/entry.mjs', 'export {project} from "./strategy.mjs";');
const config = {
  version: 1,
  sourceRoot: 'src',
  entry: 'src/entry.mjs',
  outDir: 'out',
  targets: ['node26-m4pro'],
  capabilities: [],
  metrics: ['batchMeanMs'],
  cases: ['one', 'many'],
  minimumSamples: 5,
  units: [
    {
      id: 'projection',
      facade: 'src/strategy.mjs',
      baseline: 'src/baseline.mjs',
      timing: 'sync',
      contract: 'two-own-data-properties-v1',
      variants: [
        {
          id: 'generated',
          entry: 'src/generated.mjs',
          executor: 'js-main',
          contract: 'two-own-data-properties-v1',
          generate: { kind: 'projection', export: 'project', fields: ['id', 'done'] },
        },
      ],
    },
  ],
};
writeFileSync(fixture + 'state.config.json', JSON.stringify(config, null, 2) + '\n');
const cli = fileURLToPath(new URL('../../cli/bin/state', import.meta.url));
const run = (...args) =>
  JSON.parse(execFileSync('python3', [cli, ...args, '--config', fixture + 'state.config.json'], { encoding: 'utf8' }));
const doctor = run('doctor'),
  source = doctor.generatedModules[0].content;
const candidate = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).project;
const reference = (await import(pathToFileURL(fixture + 'src/baseline.mjs').href)).project;
for (let i = 0; i < 5000; i++)
  assert.deepEqual(candidate({ id: i, done: !!(i % 2), other: i }), reference({ id: i, done: !!(i % 2), other: i }));
for (const fn of [reference, candidate]) {
  const order = [];
  const input = {
    get id() {
      order.push('id');
      return 7;
    },
    get done() {
      order.push('done');
      return true;
    },
  };
  assert.deepEqual(fn(input), { id: 7, done: true });
  assert.deepEqual(order, ['id', 'done']);
}
const records = [];
let checksum = 0;
for (const [name, size] of [
  ['one', 1],
  ['many', 1000],
]) {
  const rows = Array.from({ length: size }, (_, i) => ({ id: i, done: !!(i % 2) })),
    samples = { baseline: [], candidate: [] };
  for (let trial = -3; trial < 17; trial++)
    for (const mode of trial % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) {
      const fn = mode === 'baseline' ? reference : candidate,
        start = performance.now();
      for (let i = 0; i < 40000; i++) {
        const result = fn(rows[i % size]);
        checksum += result.id + Number(result.done);
      }
      if (trial >= 0) samples[mode].push((performance.now() - start) / 40000);
    }
  records.push({
    unit: 'projection',
    variant: 'generated',
    target: 'node26-m4pro',
    case: name,
    metric: 'batchMeanMs',
    ...samples,
  });
}
assert(Number.isSafeInteger(checksum));
const profile = {
  version: 1,
  sourceHash: doctor.sourceHash,
  correctness: [
    {
      unit: 'projection',
      variant: 'generated',
      target: 'node26-m4pro',
      passed: true,
      testHash: createHash('sha256')
        .update(readFileSync(fileURLToPath(import.meta.url)))
        .digest('hex'),
    },
  ],
  records,
};
mkdirSync(root + 'results', { recursive: true });
writeFileSync(root + 'results/generated-profile.json', JSON.stringify(profile, null, 2) + '\n');
const manifest = run('build', '--profile', root + 'results/generated-profile.json');
assert.equal(manifest.decisions[0].selected, 'generated');
const output = await import(pathToFileURL(fixture + 'out/app.js').href);
assert.deepEqual(output.project({ id: 1, done: false }), { id: 1, done: false });
writeFileSync(root + 'results/generated-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify({
    selected: manifest.decisions[0].selected,
    emitted: manifest.emitted,
    generatedSource: source,
    authoredCandidateFiles: 0,
    semanticComparisons: 5000,
    method:
      '17 alternating batches after3 warmups,40000 calls per batch; actual native-generated function, same input/result contract; no DOM or app-wide claim.',
  }),
);
