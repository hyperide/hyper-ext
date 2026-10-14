import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { pageEntries } from '../src/lib/navigation-search';
import { literateParts } from '../src/lib/highlight';
import { guideFor } from '../src/lib/learning';
import { normalizeAsciiDiagram } from '../../../vector-cli/src/diagram';

test('every decision has a distinct searchable row', () => {
  const text = readFileSync(new URL('../../DECISIONS.md', import.meta.url), 'utf8');
  assert.match(text, /^\|\s*34\s*\|/m);
});
test('literate code retains indentation after narrative', () => {
  const parts = literateParts('function f() {\n  // Keep the count in view.\n  return n;\n}');
  assert(parts.some((part) => part.kind === 'code' && part.text.startsWith('  return n;')));
});
test('normalizing a table preserves the coordinates of neighboring text', () => {
  const source = '+---+---+  peer\n| A | B |  peer\n+---+---+  peer';
  assert.equal(normalizeAsciiDiagram(source), source);
});
test('ordinary variables named field or select do not choose a boundary or query lesson', () => {
  assert.notEqual(guideFor('const field = "title"')?.id, 'conversion');
  assert.notEqual(guideFor('const select = document.querySelector("select")')?.id, 'queries');
});
test('page search reads text once without cloning or synchronous layout', () => {
  const win = new Window();
  win.document.body.innerHTML =
    '<main id="page-content"><h2 id="one">One</h2><p>alpha <b>beta</b></p><button>ignore button</button><div data-no-export>ignore export</div><h3 id="two">Two</h3><p>gamma</p><details><summary>Closed source</summary><h3 id="hidden">Hidden</h3><pre>not indexed</pre></details></main>';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  win.HTMLElement.prototype.getClientRects = () => {
    throw new Error('No layout read allowed for text extraction');
  };
  win.Range.prototype.cloneContents = () => {
    throw new Error('No DOM cloning allowed for text extraction');
  };
  try {
    const entries = pageEntries(
      [
        { id: 'one', text: 'One', level: 2 },
        { id: 'two', text: 'Two', level: 3 },
        { id: 'hidden', text: 'Hidden', level: 3 },
      ],
      '/sample',
    );
    assert.deepEqual(
      entries.map((entry) => entry.anchor),
      ['one', 'two'],
    );
    assert.match(entries[0].body, /alpha beta/);
    assert(!entries[0].body.includes('ignore'));
    assert.match(entries[1].body, /gamma/);
    assert(!entries[1].body.includes('not indexed'));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    void win.close();
  }
});

test('collection guides distinguish base collections from derived views', () => {
  assert.equal(guideFor('per-item collection updates')?.id, 'collection');
  assert.equal(guideFor('derive.collection(rows)')?.id, 'derived');
});
test('in-page search includes visible diagram labels without traversing SVG geometry', () => {
  const win = new Window();
  win.document.body.innerHTML =
    '<main id="page-content"><h2 id="architecture">Architecture</h2><figure data-diagram-source="build time → run time"><svg><text>build time</text></svg><details><summary>View source</summary><pre>source</pre></details></figure></main>';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  try {
    const entries = pageEntries([{ id: 'architecture', text: 'Architecture', level: 2 }], '/spec');
    assert.match(entries[0].body, /build time/);
    assert.match(entries[0].body, /run time/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    void win.close();
  }
});

test('page index preserves line and block boundaries while skipping code overlay buttons', () => {
  const win = new Window();
  win.document.body.innerHTML = `<main id="page-content"><h2 id="a">A</h2><p>build<br>time</p><ul><li><p>run</p><p>time</p></li></ul><pre><code>${'<span>token </span>'.repeat(500)}</code><span data-no-export>do not index action</span></pre></main>`;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  const original = win.Element.prototype.matches;
  let checked = 0;
  win.Element.prototype.matches = function (selector) {
    checked++;
    return original.call(this, selector);
  };
  try {
    const entries = pageEntries([{ id: 'a', text: 'A', level: 2 }], '/spec');
    assert.match(entries[0].body, /build time/);
    assert.match(entries[0].body, /run time/);
    assert.equal(entries[0].body.includes('do not index action'), false);
    assert(checked < 30, `Code token forest was walked (${checked} nodes)`);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
    void win.close();
  }
});
