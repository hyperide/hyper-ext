import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOSSARY } from '../src/data/glossary';
import { GENERATED_API } from '../src/lib/api-docs.generated';
import { pageDescription } from '../src/lib/SiteMetadata';

test('operator-fusion link targets the explanation containing fusion, not selector ergonomics', () => {
  assert.equal(GLOSSARY['operator fusion'].link, '/spec#s4-13-4');
  const spec = readFileSync(new URL('../src/content/spec.md', import.meta.url), 'utf8');
  const section = spec.split('#### 4.13.4 ')[1]?.split('\n#### ')[0];
  assert(section && /fusion|fus(?:es|ing)/i.test(section));
});
test('encoding documentation belongs to the function, while TypeMap describes a mapping', () => {
  assert.match(GENERATED_API.encodeFor.doc, /Encode a snapshot for the wire/);
  assert.match(GENERATED_API.TypeMap.doc, /map|path/i);
  assert(!GENERATED_API.TypeMap.doc.includes('Encode a snapshot'));
});
test('snippet metadata describes source inspection; playground shares the lesson description', () => {
  assert.match(pageDescription('/repl/snippet'), /source|snippet/i);
  assert(!pageDescription('/repl/snippet').includes('change the live UI'));
  assert.equal(pageDescription('/playground'), pageDescription('/repl'));
  assert.notEqual(pageDescription('/api'), pageDescription('/'));
});
