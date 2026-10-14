import assert from 'node:assert/strict';
import { asciiToSvg, normalizeAsciiDiagram } from '../../../vector-cli/src/diagram';
import { isAsciiDiagram, inlineDiagramHtml } from '../src/lib/inline-diagram';

const sources = [
  '+----+---+\n| A | B |\n+-----+------+\n| first | long cell |\n+---+-----+',
  '╭─────╮\n│ short │\n╰───╯',
  '┌──────────────┐\n│ ┌──────┐     │\n│ │ X │       │\n│ └──────┘    │\n└──────────────┘',
  '+------+   +------+\n| A |----->| B    |\n+------+   +------+',
  '+--------+\n| 日本語 |\n| café é |\n+--------+',
];
for (const source of sources) {
  const repaired = normalizeAsciiDiagram(source);
  assert.equal(normalizeAsciiDiagram(repaired), repaired, 'repair is idempotent');
  assert.equal(asciiToSvg(source), asciiToSvg(repaired), 'CLI and inline rendering share geometry');
  for (const word of source.match(/[\p{L}\p{M}]+/gu) ?? []) assert(repaired.includes(word), `label lost: ${word}`);
}
assert.equal(isAsciiDiagram('const s = "+---+";\n// |x|\n// +---+', 'ts'), false);
assert.equal(isAsciiDiagram('+---+\n| open', 'text'), false);
assert.equal(isAsciiDiagram('+---+\n| A |\n+---+', 'text'), true);
const html = inlineDiagramHtml('+-------+\n| <svg> |\n+-------+', '<script>bad</script>');
assert(!html.includes('<script>'));
assert(html.includes('data-diagram-source='));
assert(html.includes('&lt;svg&gt;'));
console.info(
  'PASS: layout idempotence, tables, nesting, adjacent arrows, Unicode labels, source detection and escaping',
);

assert.equal(isAsciiDiagram('React adapter ──→ core\ncollections ──→ core', 'text'), true);
assert.equal(isAsciiDiagram('A ---> B', 'diagram'), true);
assert.equal(isAsciiDiagram('There is an arrow --> in one prose line.', 'text'), false);
assert.equal(isAsciiDiagram('a --> b\nc --> d', 'ts'), false);
assert.match(asciiToSvg('+-------+\n| A   B |\n+-------+'), /xml:space="preserve"/);
