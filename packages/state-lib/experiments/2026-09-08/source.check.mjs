/** Exact-source regressions for the corpus text embedded in the production site. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exampleSource } from './example-source.mjs';
import { cases } from './corpus.mjs';

const formatted = readFileSync(new URL('./corpus.mjs', import.meta.url), 'utf8');
const flatten = (source) => source.replace(/\s*\n\s*/g, ' ');
const compactFunction = (fn) => flatten(fn.toString());
const compact = cases
  .map(
    (c) =>
      `add('${c.id}',${JSON.stringify(c.title)},${JSON.stringify(c.family)},${compactFunction(c.optimized)},${compactFunction(c.reference)},${JSON.stringify(c.note)});`,
  )
  .join('\n');

for (const c of cases) {
  test(`${c.id}: exact source in compact and formatter-produced layouts`, () => {
    const original = exampleSource(compact, c.id);
    const actual = exampleSource(formatted, c.id);
    assert.deepEqual(original, { code: compactFunction(c.optimized), native: compactFunction(c.reference) });
    assert.deepEqual(actual, { code: c.optimized.toString(), native: c.reference.toString() });
    assert.deepEqual({ code: flatten(actual.code), native: flatten(actual.native) }, original);
  });
}

test('nested delimiters and escaped strings preserve exact slices', () => {
  const code = `() => ({ value: ["),]", ${JSON.stringify('escaped " ),')}, \`],)\`] })`;
  const native = "() => ({ nested: [(1 + 2)], text: 'comma,)' })";
  for (const separator of [',', ',\n  ']) {
    const source = `  add (\n  ${['"edge"', "'title'", "'family'", code, native, "'note'"].join(separator)},\n);`;
    assert.deepEqual(exampleSource(source, 'edge'), { code, native });
  }
});

test('missing and invalid IDs are rejected', () => {
  assert.throws(() => exampleSource(formatted, 'absent'), /Missing source example/);
  assert.throws(() => exampleSource(formatted, "filter'"), /Invalid example ID/);
});

test('malformed calls cannot yield partial or empty source', () => {
  for (const body of [
    "'bad','title','family',()=>1,()=>2,'note'",
    "'bad','title','family',()=>[1},()=>2,'note')",
    "'bad','title','family',()=>1,()=>2,'unterminated)",
    "'bad','title','family',()=>1,()=>2)",
    "'bad','title','family',()=>1,()=>2,'note','extra')",
    "'bad','title','family',,()=>2,'note')",
    "'bad','title','family',()=>1,,'note')",
    "'bad','title','family',()=>1,()=>2,'note',,)",
  ])
    assert.throws(() => exampleSource(`add(${body}`, 'bad'), /Example format changed/, body);
});
