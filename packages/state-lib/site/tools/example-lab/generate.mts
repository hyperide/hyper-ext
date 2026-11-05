import { execFileSync } from 'node:child_process';
import { triageData, triageDeclarations, triageBodies, triageEntry } from './triage-source';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { LAB_EXAMPLES } from '../../src/data/example-lab/catalogue';
const source = resolve(process.argv[2] ?? '..');
const runtime = resolve(process.argv[3] ?? '../dist');
const out = resolve('public/lab');
mkdirSync(out, { recursive: true });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const common: Record<string, string> = {};
for (const name of ['json-draft.mjs', 'document-publication.mjs'])
  common['src/core/' + name] = readFileSync(resolve(source, 'experiments/2026-09-19-cow', name), 'utf8');
for (const name of ['core.js']) common['src/state-lib/' + name] = readFileSync(resolve(runtime, name), 'utf8');
const declarations: Record<string, Record<string, unknown>> = {
  point: { operation: 'toggle', path: ['columns', { arg: 'column' }, 'items', { arg: 'index' }, 'done'] },
  dense: { operation: 'groups', path: ['columns'], itemsField: 'items', field: 'text', value: { arg: 'text' } },
  sparse: {
    operation: 'groups',
    path: ['columns'],
    itemsField: 'items',
    field: 'text',
    value: { arg: 'text' },
    stride: 10,
  },
  move: {
    operation: 'move',
    path: ['columns', { arg: 'column' }, 'items'],
    fromIndex: { arg: 'index' },
    targetPath: ['columns', { arg: 'target' }, 'items'],
    toIndex: 0,
  },
};
const bodies: Record<string, string> = {
  point: 'draft.columns[args.column].items[args.index].done = !draft.columns[args.column].items[args.index].done;',
  dense:
    'for (const column of draft.columns) {\n      for (const issue of column.items) issue.text = args.text;\n    }',
  sparse:
    'for (const column of draft.columns) {\n      for (let i = 0; i < column.items.length; i += 10) column.items[i].text = args.text;\n    }',
  move: 'const source = draft.columns[args.column].items;\n    if (!source[args.index]) throw new RangeError("Choose an existing card");\n    const [card] = source.splice(args.index, 1);\n    draft.columns[args.target].items.splice(0, 0, card);',
};
for (const meta of LAB_EXAMPLES) {
  const files = { ...common };
  files['src/data.ts'] = `export function seed(count: number) {
  return {
    title: ${JSON.stringify(meta.id === 'board-commands' ? 'Launch board' : 'Release triage')},
    columns: [
      {id: 'backlog', title: 'Backlog', items: Array.from({length: count}, (_, i) => ({
        id: 'issue-' + i, text: 'Issue ' + (i + 1), done: false,
        priority: i % 4, assignees: [], details: {estimate: i % 8, tags: ['product']}
      }))},
      {id: 'ready', title: 'Ready', items: []},
      {id: 'complete', title: 'Complete', items: []}
    ]
  };
}\n`;
  const selected = meta.id === 'issue-triage' ? triageDeclarations : declarations;
  const referenceBodies = meta.id === 'issue-triage' ? triageBodies : bodies;
  const units = Object.entries(selected).map(([operation, spec]) => {
    files[`src/${operation}-reference.ts`] = `import {beginJsonDraft} from './core/json-draft.mjs';
export function ${operation}(base, args) {
  const transaction = beginJsonDraft(base);
  const draft = transaction.draft;
  try {
    ${referenceBodies[operation]}
    return transaction.finish();
  } finally { transaction.abort(); }
}\n`;
    files[`src/${operation}.ts`] = `export {${operation}} from './${operation}-reference.ts';\n`;
    return {
      id: operation,
      facade: `src/${operation}.ts`,
      baseline: `src/${operation}-reference.ts`,
      timing: 'sync',
      contract: 'immutable-document-command-v1',
      variants: [
        {
          id: 'generated',
          entry: `src/generated/${operation}.mjs`,
          executor: 'js-main',
          contract: 'immutable-document-command-v1',
          generate: { kind: 'json-command', runtime: 'src/core/json-draft.mjs', export: operation, ...spec },
        },
      ],
    };
  });
  files['src/entry.ts'] = `import {Runtime} from './state-lib/core.js';
import {createDocumentPublication} from './core/document-publication.mjs';
import {seed} from './data.ts';
${Object.keys(declarations)
  .map((op) => `import {${op}} from './${op}.ts';`)
  .join('\n')}
const commands = {point, dense, sparse, move};
export function createModel(count = 30, historyLimit = 40) {
  const store = createDocumentPublication(new Runtime(), {initial: seed(count), limit: historyLimit});
  return {
    read: store.read,
    snapshot: store.getSnapshot,
    step(operation, index = 0, text = 'Updated issue') {
      if (operation === 'undo') return store.undo();
      if (operation === 'redo') return store.redo();
      if (operation === 'history') { store.undo(); return store.redo(); }
      const document = store.read();
      const total = document.columns.reduce((sum, column) => sum + column.items.length, 0);
      if (!total) return false;
      let position = ((index % total) + total) % total, column = 0;
      while (position >= document.columns[column].items.length) position -= document.columns[column++].items.length;
      return store.apply(commands[operation], {column, index: position, target: (column + 1) % document.columns.length, text});
    },
    dispose: store.dispose
  };
}\n`;
  if (meta.id === 'issue-triage') {
    files['src/data.ts'] = triageData;
    files['src/entry.ts'] = triageEntry;
  }
  const config = {
    version: 1,
    sourceRoot: 'src',
    entry: 'src/entry.ts',
    outDir: 'out',
    targets: ['browser'],
    capabilities: [],
    metrics: ['latency'],
    cases: ['interactive'],
    minimumSamples: 3,
    units,
  };
  files['state.config.json'] = JSON.stringify(config, null, 2) + '\n';
  const project = {
    ...meta,
    files,
    entry: 'src/entry.ts',
    config,
    editable: Object.keys(files).filter((p) => !p.startsWith('src/core/') && !p.startsWith('src/state-lib/')),
    defaultFile: 'src/entry.ts',
    sourceRevision: 'dbdfc07d0b25fa12f6f395305a25d88b6b838052',
  };
  writeFileSync(resolve(out, meta.id + '.json'), JSON.stringify(project));
}
for (const name of ['statec.js', 'statec_bg.wasm'])
  copyFileSync(resolve(source, 'compiler/pkg-web', name), resolve(out, name));
copyFileSync(resolve('node_modules/esbuild-wasm/esbuild.wasm'), resolve(out, 'esbuild.wasm'));
const binding = resolve('src/lib/example-lab/generated');
mkdirSync(binding, { recursive: true });
for (const name of ['statec.js', 'statec.d.ts'])
  copyFileSync(resolve(source, 'compiler/pkg-web', name), resolve(binding, name));

// Normalize the pinned bindgen glue before hashing. These temporaries are only
// read inside their try block; the finally block uses deferred3_0/deferred3_1.
for (const directory of [out, binding]) {
  const file = resolve(directory, 'statec.js');
  let glue = readFileSync(file, 'utf8');
  for (const name of ['ptr2', 'len2']) {
    const before = `var ${name} = ret[`;
    if (glue.split(before).length !== 2) throw new Error('Bindgen output changed; inspect temporary scope');
    glue = glue.replace(before, `let ${name} = ret[`);
  }
  glue = glue.replace(/\bwasmModule\b/g, '_wasmModule').replace(/\bwasmInstance\b/g, '_wasmInstance');
  writeFileSync(file, glue);
}

execFileSync(resolve('../../../node_modules/.bin/oxfmt'), [
  '--write',
  resolve(out, 'statec.js'),
  resolve(binding, 'statec.js'),
  resolve(binding, 'statec.d.ts'),
  ...LAB_EXAMPLES.map((example) => resolve(out, example.id + '.json')),
]);
const compilerInputs = [
  'compiler/Cargo.toml',
  'compiler/Cargo.lock',
  'compiler/src/lib.rs',
  'compiler/src/projection.rs',
  'compiler/src/command.rs',
];
const provenance = {
  version: 1,
  compiler: 'statec/0.1.0-oxc',
  harness: Object.fromEntries(
    [
      'src/lib/example-lab/execution.worker.js',
      'src/lib/example-lab/compiler.worker.ts',
      'src/lib/example-lab/core.ts',
    ].map((path) => [path, digest(readFileSync(path))]),
  ),
  rustSources: Object.fromEntries(compilerInputs.map((p) => [p, digest(readFileSync(resolve(source, p)))])),
  assets: Object.fromEntries(
    ['statec.js', 'statec_bg.wasm', 'esbuild.wasm', ...LAB_EXAMPLES.map((p) => p.id + '.json')].map((name) => [
      name,
      { sha256: digest(readFileSync(resolve(out, name))), bytes: readFileSync(resolve(out, name)).byteLength },
    ]),
  ),
};
writeFileSync(resolve(out, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log('Generated real compiler assets and ' + LAB_EXAMPLES.length + ' editable multi-file projects.');
