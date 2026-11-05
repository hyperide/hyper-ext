// Bundle-size sensitivity experiment; does not assert runtime qualification.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url)),
  lib = resolve(root, '../..');
const runtime = readFileSync(resolve(lib, 'experiments/2026-09-19-cow/json-draft.mjs'));
const records = [];
for (const count of [1, 16, 128, 512]) {
  const directory = resolve(root, 'size-fixtures', String(count));
  mkdirSync(resolve(directory, 'src'), { recursive: true });
  const actual = resolve(root, 'fixture/src');
  assert.deepEqual(
    readFileSync(resolve(actual, 'core/json-draft.mjs')),
    runtime,
    'Run the current controller fixture before catalogue measurement',
  );
  cpSync(resolve(actual, 'core'), resolve(directory, 'src/core'), { recursive: true });
  cpSync(resolve(actual, 'state-lib'), resolve(directory, 'src/state-lib'), { recursive: true });
  writeFileSync(resolve(directory, 'src/runtime.mjs'), "export * from './core/json-draft.mjs';");
  cpSync(resolve(actual, 'command-store.mjs'), resolve(directory, 'src/command-store.mjs'));
  const units = [];
  for (let i = 0; i < count; i++) {
    const id = `c${i}`,
      field = `field${i}`;
    const reference = `import {beginJsonDraft} from './runtime.mjs';export function ${id}(base,a){const tx=beginJsonDraft(base);try{tx.draft[${JSON.stringify(field)}]=a.value;return tx.finish();}catch(e){tx.abort();throw e;}}`;
    writeFileSync(resolve(directory, `src/${id}-baseline.mjs`), reference);
    writeFileSync(resolve(directory, `src/${id}-strategy.mjs`), `export {${id}} from './${id}-baseline.mjs';`);
    units.push({
      id,
      facade: `src/${id}-strategy.mjs`,
      baseline: `src/${id}-baseline.mjs`,
      timing: 'sync',
      contract: 'scalar-field-v1',
      variants: [
        {
          id: 'generated',
          entry: `src/generated/${id}.mjs`,
          executor: 'js-main',
          contract: 'scalar-field-v1',
          generate: {
            kind: 'json-command',
            runtime: 'src/runtime.mjs',
            export: id,
            operation: 'set',
            path: [field],
            value: { arg: 'value' },
          },
        },
      ],
    });
  }
  writeFileSync(
    resolve(directory, 'src/entry.mjs'),
    units.map((u) => `export {${u.id}} from './${u.id}-strategy.mjs';`).join('\n'),
  );
  const config = {
    version: 1,
    sourceRoot: 'src',
    entry: 'src/entry.mjs',
    outDir: 'out',
    targets: ['size-only'],
    capabilities: [],
    metrics: ['latency'],
    cases: ['not-qualified'],
    units,
  };
  const configPath = resolve(directory, 'state.config.json');
  writeFileSync(configPath, JSON.stringify(config));
  const plan = JSON.parse(
    execFileSync('python3', [resolve(lib, 'cli/bin/state'), 'doctor', '--config', configPath], { encoding: 'utf8' }),
  );
  for (const module of plan.generatedModules)
    writeFileSync(resolve(directory, `generated-${module.unit}.mjs`), module.content);
  writeFileSync(
    resolve(directory, 'generated-entry.mjs'),
    units.map((u) => `export {${u.id}} from './generated-${u.id}.mjs';`).join('\n'),
  );
  writeFileSync(
    resolve(directory, 'controller-reference.mjs'),
    "export {createCommandDocumentStore} from './src/command-store.mjs';\nexport * from './src/entry.mjs';",
  );
  writeFileSync(
    resolve(directory, 'controller-generated.mjs'),
    "export {createCommandDocumentStore} from './src/command-store.mjs';\nexport * from './generated-entry.mjs';",
  );
  const sizes = {};
  for (const [name, entry] of [
    ['reference', 'src/entry.mjs'],
    ['generated', 'generated-entry.mjs'],
    ['controllerReference', 'controller-reference.mjs'],
    ['controllerGenerated', 'controller-generated.mjs'],
  ]) {
    const bundle = JSON.parse(
      execFileSync('node', [resolve(lib, 'build-tools/bundle.mjs')], {
        input: JSON.stringify({
          root: directory,
          entry: resolve(directory, entry),
          aliases: {},
          generated: {},
          target: 'es2022',
        }),
        encoding: 'utf8',
      }),
    );
    const bytes = Buffer.from(bundle.code);
    sizes[name] = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: bundle.brotliBytes };
    assert(!bundle.code.includes('BEGIN_MEASUREMENT_PADDING'));
  }
  const record = {
    commands: count,
    ...sizes,
    allByteMetricsNonGrowing: ['raw', 'gzip', 'brotli'].every((key) => sizes.generated[key] <= sizes.reference[key]),
    sourceHash: plan.sourceHash,
  };
  records.push(record);
  console.log(JSON.stringify(record));
}
const result = {
  date: new Date().toISOString(),
  node: process.version,
  runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
  records,
  method:
    'Actual native-generated modules bundled with all reachable runtime helpers, distinct field paths and exported commands. Reference is the generic COW command implementation. No padding or fabricated timing profiles. Both alternatives are bundled independently for size measurement; this is not automatic runtime admission.',
  limits: [
    'Command-only and complete document-controller entry graphs are both measured. The command-only controller includes Runtime, shared publication and history with identical exports in both variants; unrelated routes and UI dependencies are not part of this fixture.',
    'These measurements do not include worker/Wasm assets not referenced by this experiment.',
    'Source maps are debug artifacts and not included in the runtime byte totals.',
  ],
};
writeFileSync(resolve(root, 'results/catalogue-size.json'), JSON.stringify(result, null, 2) + '\n');
