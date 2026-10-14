import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { QUERY_CASES, fullSnippet } from '../src/data/query-comparison';

const messages: Array<{ type: string; text?: string }> = [];
const scope: { location: { origin: string }; onmessage?: (event: { origin: string; data: unknown }) => Promise<void> } =
  { location: { origin: 'https://state.test' } };
const source = readFileSync(new URL('../src/lib/snippet.worker.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
new vm.Script(js).runInNewContext({
  self: scope,
  postMessage: (m: { type: string; text?: string }) => messages.push(structuredClone(m)),
  exports: {},
  require: createRequire(new URL('../src/lib/snippet.worker.ts', import.meta.url)),
});
assert(scope.onmessage);
assert.deepEqual([...messages], [], 'loading the worker must not execute snippets');
await scope.onmessage({ origin: 'https://other.test', data: { code: 'log("bad")' } });
assert.deepEqual([...messages], []);
for (const data of [null, {}, { code: 12 }, { code: 'x'.repeat(100001) }]) {
  await scope.onmessage({ origin: '', data });
  assert.equal(messages.pop()?.type, 'error');
}
for (const origin of ['', scope.location.origin]) {
  await scope.onmessage({ origin, data: { code: 'log("ok")' } });
  assert.equal(messages[0]?.text, 'ok');
  assert.equal(messages[1]?.type, 'done');
  messages.length = 0;
}
await scope.onmessage({ origin: '', data: { code: 'log("limit")'.padEnd(100_000) } });
assert.deepEqual([...messages], [{ type: 'log', text: 'limit' }, { type: 'done' }]);
messages.length = 0;
for (const name of ['fs', 'toString', '__proto__']) {
  await scope.onmessage({ origin: '', data: { code: `import x from '${name}'; log(x);` } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.type, 'error');
  assert.match(messages[0]?.text ?? '', /Runtime not loaded:/);
  messages.length = 0;
}
for (const c of QUERY_CASES)
  for (const [name, variant] of Object.entries(c.variants)) {
    if (variant?.status !== 'executable') continue;
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await scope.onmessage({ origin: '', data: { code: fullSnippet(variant) } });
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(
      messages,
      [{ type: 'log', text: JSON.stringify(c.expected, null, 2) }, { type: 'done' }],
      `${c.id} / ${name}`,
    );
    assert.deepEqual(warnings, [], `${c.id} / ${name} must not fall back to scans`);
    messages.length = 0;
  }
const join = QUERY_CASES.find((c) => c.id === 'join');
assert(join?.variants['TanStack DB']);
const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args);
};
try {
  // Removing the index must expose the real engine warning, proving capture is live.
  const withoutIndex = fullSnippet(join.variants['TanStack DB']).replace(
    /collection\.createIndex\(r\s*=>\s*r\.ownerId,[^;]+;/,
    '',
  );
  await scope.onmessage({ origin: '', data: { code: withoutIndex } });
} finally {
  console.warn = originalWarn;
}
assert.equal(warnings.length, 1);
assert.match(String(warnings[0]?.[0]), /Join requires an index on "ownerId".*Falling back to scanning local data/);
assert.deepEqual([...messages], [{ type: 'log', text: JSON.stringify(join.expected, null, 2) }, { type: 'done' }]);
messages.length = 0;
await scope.onmessage({
  origin: '',
  data: { code: `import _, {map} from 'lodash'; log(_([1,2]).map(x => x * 2).value()); log(map([1,2], x => x * 3));` },
});
assert.deepEqual(
  [...messages],
  [{ type: 'log', text: '[\n  2,\n  4\n]' }, { type: 'log', text: '[\n  3,\n  6\n]' }, { type: 'done' }],
);
console.log('worker boundaries, no-autorun, authored executable snippets and default/named Lodash imports passed');
