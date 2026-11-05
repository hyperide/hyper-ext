import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));
const boards = resolve(process.argv[2] ?? '');
assert(process.argv[2], 'Pass the actual Boards worktree path');
const evidence = resolve(process.argv[3] ?? resolve(root, 'results'));
const inputs = JSON.parse(readFileSync(resolve(evidence, 'controller.json'), 'utf8'));
for (const [path, expected] of Object.entries(inputs.hashes)) {
  const actual = createHash('sha256').update(readFileSync(resolve(boards, path))).digest('hex');
  assert.equal(actual, expected, 'Measured source changed: ' + path);
}
assert.deepEqual(readFileSync(resolve(root, 'json-draft.mjs')), readFileSync(resolve(boards, 'packages/core/json-draft.mjs')), 'Tested and measured COW helper must match');
const fixture = process.argv[3] ? resolve(evidence, 'selection-fixture') : resolve(root, 'selection-fixture'),
  src = resolve(fixture, 'src');
mkdirSync(src, { recursive: true });
const copy = (name, data) => {
  const path = resolve(src, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};
copy('core/current.mjs', execFileSync('git', ['-C', boards, 'show', 'a312a2d:packages/core/document-store.mjs']));
copy('core/candidate.mjs', readFileSync(resolve(boards, 'packages/core/document-store.mjs')));
for (const name of ['model.mjs', 'document-store-baseline.mjs', 'json-draft.mjs'])
  copy('core/' + name, readFileSync(resolve(boards, 'packages/core', name)));
for (const name of ['index.js', 'core.js', 'latest-task.js', 'external-store.js'])
  copy('state-lib/dist/' + name, readFileSync(resolve(boards, 'packages/state-lib/dist', name)));
copy('baseline.mjs', `export { createDocumentStore } from './core/current.mjs';`);
copy(
  'candidate.mjs',
  `import { createDocumentStore as factory } from './core/candidate.mjs';
export function createDocumentStore(options) { return factory({...options, backend:'state-lib-cow'}); }`,
);
copy('strategy.mjs', `export { createDocumentStore } from './baseline.mjs';`);
copy('entry.mjs', `export { createDocumentStore } from './strategy.mjs';`);
const cases = inputs.gates.map((row) => `${row.count}/${row.operation}`);
const config = {
  version: 1,
  sourceRoot: 'src',
  entry: 'src/entry.mjs',
  outDir: 'out',
  targets: ['node26-m4pro'],
  capabilities: [],
  metrics: ['current-runtime-ms', 'pre-library-budget-ms'],
  cases,
  minimumSamples: 5,
  units: [
    {
      id: 'document',
      facade: 'src/strategy.mjs',
      baseline: 'src/baseline.mjs',
      timing: 'sync',
      contract: 'json-document-assignment-history-v1',
      variants: [
        {
          id: 'cow',
          entry: 'src/candidate.mjs',
          contract: 'json-document-assignment-history-v1',
          executor: 'js-main',
          requires: [],
        },
      ],
    },
  ],
};
const configPath = resolve(fixture, 'state.config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const cli = resolve(root, '../../cli/bin/state');
const command = (...args) =>
  JSON.parse(execFileSync('python3', [cli, ...args, '--config', configPath], { encoding: 'utf8' }));
const sourceHash = command('doctor').sourceHash;
const testPath = resolve(root, 'json-draft.test.mjs');
const check = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testPath], { encoding: 'utf8' });
writeFileSync(resolve(evidence, 'selection-conformance.tap'), check.stdout + check.stderr);
const records = [];
for (const cell of inputs.gates) {
  const rows = inputs.raw.filter((row) => row.count === cell.count && row.operation === cell.operation);
  const values = (name) => rows.find((row) => row.backend === name).samples;
  for (const [metric, reference] of [
    ['current-runtime-ms', 'state-lib'],
    ['pre-library-budget-ms', 'baseline'],
  ])
    records.push({
      unit: 'document',
      variant: 'cow',
      target: 'node26-m4pro',
      case: `${cell.count}/${cell.operation}`,
      metric,
      baseline: values(reference),
      candidate: values('state-lib-cow'),
    });
}
const profile = {
  version: 1,
  sourceHash,
  correctness: [
    {
      unit: 'document',
      variant: 'cow',
      target: 'node26-m4pro',
      passed: check.status === 0,
      testHash: createHash('sha256').update(readFileSync(testPath)).digest('hex'),
    },
  ],
  records,
};
const profilePath = resolve(fixture, 'profile.json');
writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
const automatic = command('build', '--profile', profilePath);
const autoCode = readFileSync(resolve(fixture, 'out/app.js'));
const forced = command('build', '--mode', 'baseline');
const baselineCode = readFileSync(resolve(fixture, 'out/app.js'));
assert.equal(
  automatic.decisions[0].selected,
  'baseline',
  'COW must not be promoted with failing correctness or performance cells',
);
assert.deepEqual(autoCode, baselineCode, 'Rejected optimizer must preserve the baseline output bytes');
const result = {
  scope:
    'Same Runtime semantics against current full-copy implementation, with a separate stricter pre-library latency budget. This is not an assertion that the mutable pre-library baseline had the same correctness guarantees.',
  candidateAccepted: false,
  conformanceExit: check.status,
  conformancePassed: Number(check.stdout.match(/# pass (\d+)/)?.[1]),
  conformanceFailed: Number(check.stdout.match(/# fail (\d+)/)?.[1]),
  autoEqualsBaseline: true,
  emittedBytes: autoCode.length,
  baselineHash: createHash('sha256').update(autoCode).digest('hex'),
  profileSourceHash: sourceHash,
  decision: automatic.decisions[0],
  emitted: automatic.emitted,
};
writeFileSync(resolve(evidence, 'compile-gate.json'), JSON.stringify(result, null, 2) + '\n');
console.info(
  JSON.stringify({
    candidateAccepted: result.candidateAccepted,
    conformancePassed: result.conformancePassed,
    conformanceFailed: result.conformanceFailed,
    autoEqualsBaseline: result.autoEqualsBaseline,
    emitted: result.emitted,
  }),
);
