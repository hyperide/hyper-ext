import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const root = dirname(fileURLToPath(import.meta.url)),
  boards = resolve(process.argv[2]),
  fixture = resolve(root, 'fixture');
const results = resolve(root, 'results');
mkdirSync(results, { recursive: true });
mkdirSync(resolve(fixture, 'src/core'), { recursive: true });
const hashes = {};
for (const name of [
  'document-store.mjs',
  'document-store-baseline.mjs',
  'json-draft.mjs',
  'model.mjs',
  'document-publication.mjs',
]) {
  const bytes = readFileSync(resolve(boards, 'packages/core', name));
  writeFileSync(resolve(fixture, 'src/core', name), bytes);
  hashes['core/' + name] = createHash('sha256').update(bytes).digest('hex');
}
mkdirSync(resolve(fixture, 'src/state-lib/dist'), { recursive: true });
for (const name of ['index.js', 'core.js', 'latest-task.js', 'external-store.js']) {
  const bytes = readFileSync(resolve(boards, 'packages/state-lib/dist', name));
  writeFileSync(resolve(fixture, 'src/state-lib/dist', name), bytes);
  hashes['runtime/' + name] = createHash('sha256').update(bytes).digest('hex');
}
for (const name of ['json-draft.mjs', 'document-publication.mjs'])
  assert.deepEqual(
    readFileSync(resolve(fixture, 'src/core', name)),
    readFileSync(resolve(root, '../2026-09-19-cow', name)),
    'Measured and tested source differ: ' + name,
  );
writeFileSync(
  resolve(fixture, 'src/command-store.mjs'),
  `import {Runtime} from './state-lib/dist/index.js';import {createDocumentPublication} from './core/document-publication.mjs';export function createCommandDocumentStore(options){return createDocumentPublication(new Runtime(),options);}`,
);
const publicationConformance = execFileSync('bun', ['test', resolve(root, 'publication.test.ts')], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
writeFileSync(resolve(results, 'publication-conformance.txt'), publicationConformance);
const arg = (name) => ({ arg: name });
const declarations = {
  root: { operation: 'set', path: ['name'], value: arg('text') },
  item: { operation: 'toggle', path: ['boards', 0, 'columns', arg('column'), 'items', 0, 'done'] },
  sparse: {
    operation: 'groups',
    path: ['boards', 0, 'columns'],
    itemsField: 'items',
    field: 'text',
    value: arg('text'),
    stride: 10,
  },
  all: { operation: 'groups', path: ['boards', 0, 'columns'], itemsField: 'items', field: 'text', value: arg('text') },
  move: {
    operation: 'move',
    path: ['boards', 0, 'columns', arg('column'), 'items'],
    fromIndex: 0,
    targetPath: ['boards', 0, 'columns', arg('target'), 'items'],
    toIndex: 0,
  },
  noop: { operation: 'noop' },
};
const bodies = {
  root: 'd.name=a.text;',
  item: 'd.boards[0].columns[a.column].items[0].done=!d.boards[0].columns[a.column].items[0].done;',
  sparse: 'for(const col of d.boards[0].columns)for(let i=0;i<col.items.length;i+=10)col.items[i].text=a.text;',
  all: 'for(const col of d.boards[0].columns)for(const item of col.items)item.text=a.text;',
  move: 'const source=d.boards[0].columns[a.column].items;if(!source.length)throw new RangeError("Missing source item");d.boards[0].columns[a.target].items.unshift(source.shift());',
  noop: '',
};
const conformanceFiles = [
  '../2026-09-19-cow/json-draft.test.mjs',
  'commands.test.mjs',
  'dense-copy.test.mjs',
  'edge-cases.test.mjs',
];
const conformance = execFileSync(process.execPath, ['--test', ...conformanceFiles.map((file) => resolve(root, file))], {
  encoding: 'utf8',
});
writeFileSync(resolve(results, 'conformance.tap'), conformance);
const operations = Object.keys(declarations),
  sizes = [0, 1, 30, 300, 1200, 10000];
for (const op of operations) {
  writeFileSync(
    resolve(fixture, `src/${op}-baseline.mjs`),
    `import {beginJsonDraft} from './core/json-draft.mjs';export function ${op}(base,a){const tx=beginJsonDraft(base),d=tx.draft;try{${bodies[op]}return tx.finish();}catch(e){tx.abort();throw e;}}`,
  );
  writeFileSync(resolve(fixture, `src/${op}-strategy.mjs`), `export {${op}} from './${op}-baseline.mjs';`);
}
writeFileSync(
  resolve(fixture, 'src/entry.mjs'),
  `export {createCommandDocumentStore} from './command-store.mjs';\n` +
    operations.map((op) => `export {${op}} from './${op}-strategy.mjs';`).join('\n'),
);
const config = {
  version: 1,
  sourceRoot: 'src',
  entry: 'src/entry.mjs',
  outDir: 'out',
  targets: ['node-controller'],
  capabilities: [],
  metrics: ['equivalentRuntimeMs', 'originalBudgetMs'],
  cases: sizes.map((n) => `items-${n}`),
  minimumSamples: 5,
  units: operations.map((op) => ({
    id: op,
    facade: `src/${op}-strategy.mjs`,
    baseline: `src/${op}-baseline.mjs`,
    timing: 'sync',
    contract: 'declared-json-command-v1',
    variants: [
      {
        id: 'generated',
        entry: `src/generated/${op}.mjs`,
        executor: 'js-main',
        contract: 'declared-json-command-v1',
        generate: { kind: 'json-command', runtime: 'src/core/json-draft.mjs', export: op, ...declarations[op] },
      },
    ],
  })),
};
const configPath = resolve(fixture, 'state.config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
const cli = resolve(root, '../../cli/bin/state');
const state = (...args) =>
  JSON.parse(execFileSync('python3', [cli, ...args, '--config', configPath], { encoding: 'utf8' }));
const plan = state('doctor'),
  generated = {};
for (const module of plan.generatedModules) {
  const path = resolve(fixture, `measure-${module.unit}.mjs`);
  writeFileSync(path, module.content);
  generated[module.unit] = (await import(pathToFileURL(path).href))[module.unit];
}
const { createDocumentStore } = await import(pathToFileURL(resolve(fixture, 'src/core/document-store.mjs')).href);
const mutate = Object.fromEntries(operations.map((op) => [op, new Function('d', 'a', bodies[op])]));
const fixtureData = (n) => ({
  schemaVersion: 1,
  name: 'Document',
  boards: [
    {
      id: 'b',
      columns: [
        {
          id: 'a',
          items: Array.from({ length: n }, (_, i) => ({ id: `${i}`, text: `Task ${i}`, done: false, assignees: [] })),
        },
        { id: 'b', items: [] },
      ],
    },
  ],
});
const strategies = ['baseline', 'state-lib', 'state-lib-cow', 'generated'];
const raw = [];
let comparisons = 0;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const count of sizes)
  for (const operation of [...operations, 'history']) {
    const batches = Object.fromEntries(strategies.map((name) => [name, []])),
      iterations = count >= 10000 ? 8 : count >= 1200 ? 24 : count >= 300 ? 64 : count >= 30 ? 256 : 2048;
    for (let trial = -3; trial < 17; trial++) {
      const outcomes = [];
      for (const backend of trial % 2 ? [...strategies].reverse() : strategies) {
        const store = createDocumentStore({
          backend: backend === 'generated' ? 'state-lib-cow' : backend,
          initial: fixtureData(count),
          limit: 40,
        });
        if (operation === 'history')
          store.change((d) => {
            d.name = 'history';
          });
        let errors = 0;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          if (operation === 'history') {
            assert(store.undo());
            assert(store.redo());
            continue;
          }
          const document = store.read(),
            column = document.boards[0].columns[0].items.length ? 0 : 1;
          const args = { text: `Edit ${i}`, column, target: 1 - column };
          try {
            if (backend === 'generated') store.apply(generated[operation], args);
            else store.change((d) => mutate[operation](d, args));
          } catch (error) {
            if (count === 0 && (operation === 'item' || operation === 'move')) errors++;
            else throw error;
          }
        }
        const elapsed = (performance.now() - start) / iterations;
        assert.equal(errors, count === 0 && (operation === 'item' || operation === 'move') ? iterations : 0);
        if (trial >= 0) batches[backend].push(elapsed);
        outcomes.push(structuredClone(store.read()));
        store.dispose();
      }
      for (const output of outcomes.slice(1)) {
        assert.deepEqual(output, outcomes[0]);
        comparisons++;
      }
    }
    for (const backend of strategies)
      raw.push({
        count,
        operation,
        backend,
        iterations,
        samples: batches[backend],
        medianMs: median(batches[backend]),
        minMs: Math.min(...batches[backend]),
        maxMs: Math.max(...batches[backend]),
      });
    console.log(count, operation, ...strategies.map((name) => `${name}=${median(batches[name]).toFixed(5)}`));
  }
const cells = sizes.flatMap((count) =>
  [...operations, 'history'].map((operation) => {
    const rows = raw.filter((row) => row.count === count && row.operation === operation),
      pick = (name) => rows.find((row) => row.backend === name);
    const candidate = pick('generated'),
      original = pick('baseline'),
      reference = pick('state-lib-cow');
    return {
      count,
      operation,
      medianRatio: candidate.medianMs / original.medianMs,
      strictOriginal: candidate.maxMs <= original.minMs,
      strictEquivalent: candidate.maxMs <= reference.minMs,
    };
  }),
);
const records = [];
for (const count of sizes)
  for (const operation of operations) {
    const pick = (name) =>
      raw.find((row) => row.count === count && row.operation === operation && row.backend === name).samples;
    for (const [metric, baseline] of [
      ['equivalentRuntimeMs', 'state-lib-cow'],
      ['originalBudgetMs', 'baseline'],
    ])
      records.push({
        unit: operation,
        variant: 'generated',
        target: 'node-controller',
        case: `items-${count}`,
        metric,
        baseline: pick(baseline),
        candidate: pick('generated'),
      });
  }
const profile = {
  version: 1,
  sourceHash: plan.sourceHash,
  correctness: operations.map((unit) => ({
    unit,
    variant: 'generated',
    target: 'node-controller',
    passed: true,
    testHash: createHash('sha256')
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest('hex'),
  })),
  records,
};
const profilePath = resolve(results, 'profile.json');
writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n');
const manifest = state('build', '--profile', profilePath);
writeFileSync(resolve(results, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const emitted = await import(pathToFileURL(resolve(fixture, 'out/app.js')).href + '?verified=' + Date.now());
for (const count of [0, 1, 30]) {
  for (const operation of operations) {
    const store = emitted.createCommandDocumentStore({ backend: 'state-lib-cow', initial: fixtureData(count) });
    const before = structuredClone(store.read());
    if (!count && (operation === 'item' || operation === 'move')) {
      assert.throws(() => store.apply(emitted[operation], { text: 'verified', column: 0, target: 1 }));
      assert.deepEqual(store.read(), before);
    } else {
      const expected = structuredClone(before);
      mutate[operation](expected, { text: 'verified', column: 0, target: 1 });
      store.apply(emitted[operation], { text: 'verified', column: 0, target: 1 });
      assert.deepEqual(store.read(), expected);
      assert(store.undo());
      assert.deepEqual(store.read(), before);
    }
    store.dispose();
  }
}

const report = {
  date: new Date().toISOString(),
  node: process.version,
  hashes,
  comparisons,
  emittedIntegrationChecked: true,
  conformancePassed: true,
  conformanceHash: createHash('sha256')
    .update(Buffer.concat(conformanceFiles.map((file) => readFileSync(resolve(root, file)))))
    .digest('hex'),
  raw,
  cells,
  manifest,
  method:
    'Actual document controller and its one Runtime, history and publication are included. Commands measured are native-generated functions. 17 alternating batches after 3 warmups; batch means are not individual event percentiles. Both columns are explicit; the largest fixture has a 10000-item single column.',
  limits: [
    'Initial import, DOM, network and peak memory are not inside operation timings.',
    'Empty point and move commands compare rejection of invalid access, not useful item work.',
    'B0 is a weaker mutable baseline; B1 and COW preserve stronger snapshot semantics.',
    'The compiler profile is local synthetic producer evidence, not a proof over all inputs or future scheduling.',
  ],
};
writeFileSync(resolve(results, 'controller.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  'SUMMARY',
  JSON.stringify({
    strictOriginal: cells.filter((x) => x.strictOriginal).length,
    cells: cells.length,
    emitted: manifest.emitted,
    decisions: manifest.decisions.map((x) => ({ unit: x.unit, selected: x.selected })),
  }),
);
