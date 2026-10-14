import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeSnippet, decodeSnippet, snippetHref } from '../src/lib/snippet-transfer.ts';
import { edgeAt, followTarget, lensAt, LEAVE_DELAY, EDGE_DWELL } from '../src/lib/nav-motion.ts';
import { GENERATED_API } from '../src/lib/api-docs.generated.ts';
import { referenceDoc } from '../src/lib/api-reference-prose.ts';
import { lookup } from '../src/lib/api-docs.ts';
import { STATE_EXAMPLES } from '../src/data/examples.ts';
const code = `// Привет 🌐 </script> & ' "\nlog("hello")`;
assert.equal(decodeSnippet(encodeSnippet({ code, lang: 'ts' })).code, code);
assert.throws(() => decodeSnippet('broken'));
assert.throws(() => encodeSnippet({ code: 'a'.repeat(200000), lang: 'ts' }));
assert.match(snippetHref(code), /repl\/snippet#code-/);
assert.equal(STATE_EXAMPLES[0].id, 'read-write');
assert(STATE_EXAMPLES.some((e) => e.id === 'adapter-react'));
assert.equal(edgeAt(5, 600), -1);
assert.equal(edgeAt(595, 600), 1);
assert.equal(edgeAt(300, 600), 0);
assert.equal(followTarget(300, 300, 200, 600, 500), 200);
assert(followTarget(0, 300, 200, 600, 500) >= 0);
assert(followTarget(600, 300, 200, 600, 500) <= 500);
assert.equal(lensAt(10, 600, 10).scale, 1);
assert.equal(lensAt(590, 600, 590).angle, 0);
assert(lensAt(10, 600, 590).scale < 1);
assert(LEAVE_DELAY > EDGE_DWELL && EDGE_DWELL >= 100);
const prototypePath = fileURLToPath(new URL('../src/lib/proto.ts', import.meta.url));
const program = ts.createProgram([prototypePath], { target: ts.ScriptTarget.ES2022, skipLibCheck: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(prototypePath)!;
const moduleSymbol = checker.getSymbolAtLocation(source)!;
const expectedExports = checker
  .getExportsOfModule(moduleSymbol)
  .map((symbol) => symbol.getName())
  .sort();
assert.deepEqual(
  Object.keys(GENERATED_API)
    .filter((name) => !name.includes('.'))
    .sort(),
  expectedExports,
  'Every real exported symbol must have one reference entry; prototype inheritance must not inflate coverage',
);
for (const [name, entry] of Object.entries(GENERATED_API)) {
  if (entry.kind === 'function' || entry.kind === 'method')
    assert(referenceDoc(name), `${name}: callable needs a reader-facing contract`);
}
assert.match(referenceDoc('store.snapshot')!, /structuredClone/);
assert.match(referenceDoc('store.action')!, /partial writes/);
assert.match(referenceDoc('store.log')!, /not the REPL/);
assert.match(lookup('snapshot', 'store')!.doc, /not frozen or structurally shared/);
const root = new URL('../', import.meta.url);
const get = (s: string) => readFileSync(new URL(s, root), 'utf8');
for (const [a, b] of [
  ['src/content/spec.md', '../docs/2026-09-01-state-master-spec.md'],
  ['src/content/requirements.md', '../REQUIREMENTS.md'],
  ['src/content/decisions.md', '../DECISIONS.md'],
])
  assert.equal(get(a), get(b), `${a} must mirror canonical document`);
const spec = get('src/content/spec.md');
assert(!/\| Req \| Destination \| Req \| Destination \|/.test(spec));
assert(spec.includes('R98'));
assert.match(get('../docs/research/2026-09-08-query-syntax-and-tanstack-db.md'), /@tanstack\/db-ivm/);
console.log('docs refresh: exact-source transport, navigation geometry, API inventory and canonical mirrors passed');
