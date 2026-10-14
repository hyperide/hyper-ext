import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { literateParts, highlightHtml } from '../src/lib/highlight';
import { GUIDES, guideFor, guideHref } from '../src/lib/learning';
import { filterPageEntries, type PageEntry } from '../src/lib/navigation-search';

const samples = [
  '// Explain the read.\nconst x = 1;\n// Explain the write.\nx++;\n',
  '\n  // <script> is text, not markup\nconst x = "// not a comment";\n',
  'const url = `https://example.test/path`;\n// A real explanation\nlog(url);',
  '/* Two lines\n * of explanation. */\nconst done = false;\n',
  '// @ts-expect-error intentional negative contract\nconst x: number = "x";\n',
  '\n\n',
  '',
];
for (const source of samples)
  assert.equal(
    literateParts(source)
      .map((part) => part.raw)
      .join(''),
    source,
  );
assert.equal(literateParts(samples[0]).filter((part) => part.kind === 'prose').length, 2);
assert(!literateParts(samples[4]).some((part) => part.kind === 'prose'));
const rendered = highlightHtml('<pre><code class="language-ts">// &lt;script&gt;\nconst a = 1;</code></pre>');
assert(rendered.includes('literate-prose') && rendered.includes('data-code-source='));
assert(!rendered.includes('<script>'));
const exampleSource = readFileSync(new URL('../src/data/examples.ts', import.meta.url), 'utf8');
for (const guide of Object.values(GUIDES)) {
  assert(exampleSource.includes(`id: '${guide.id}'`), `Missing complete example: ${guide.id}`);
  assert(guide.steps.length >= 3 && guide.purpose.length > 20);
  assert(!guideHref(guide.id).includes('/repl/snippet'));
}
assert.equal(guideFor('dispose(): void')?.id, 'lifecycle');
assert.equal(guideFor('opaque language with no matching topic'), undefined);
const entries: PageEntry[] = [
  {
    title: 'History',
    body: 'Signals keep a history here.',
    anchor: 'history',
    route: '/api',
    kind: 'heading',
    score: 0,
    level: 2,
  },
  {
    title: 'Signals',
    body: 'Read and subscribe.',
    anchor: 'signals',
    route: '/api',
    kind: 'heading',
    score: 0,
    level: 2,
  },
];
assert.deepEqual(
  filterPageEntries(entries, '').map((entry) => entry.anchor),
  ['history', 'signals'],
);
assert.deepEqual(
  filterPageEntries(entries, 'sIgNaLs').map((entry) => entry.anchor),
  ['signals', 'history'],
);
assert.deepEqual(
  filterPageEntries(entries, 'signals history').map((entry) => entry.anchor),
  ['history'],
);
assert.deepEqual(filterPageEntries(entries, 'absent'), []);
assert.equal(entries[0].score, 0, 'Filtering must not mutate the page inventory');
console.info('PASS: source fidelity, safe narrative, complete guide destinations and explicit in-page ranking');
