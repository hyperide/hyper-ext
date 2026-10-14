import { describe, expect, test } from 'bun:test';
import { asciiToSvg } from '../src/diagram';

const rightEdges = (svg: string): number[] => {
  const xs = [...svg.matchAll(/M ([\d.]+) [\d.]+ l 0 -?[\d.]+/g)].map((m) => Number(m[1]));
  const left = Math.min(...xs);
  return [...new Set(xs.filter((x) => x > left))];
};

describe('ASCII geometry repair', () => {
  test('a ragged ASCII frame has one straight right edge, not copied glyph positions', () => {
    const svg = asciiToSvg('+----------+\n| Store |\n| A longer value |\n+-----+');
    expect(rightEdges(svg)).toHaveLength(1);
    expect(svg).toContain('Store');
    expect(svg).toContain('A longer value');
  });
  test('a labelled Unicode frame is closed and gets a panel fill', () => {
    const svg = asciiToSvg('┌── runtime ─────┐\n│ signals │\n│ transactions and patches │\n└────────────────┘');
    expect(rightEdges(svg)).toHaveLength(1);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(1);
    expect(svg).toContain('runtime');
    expect(svg).toContain('transactions and patches');
  });
});

import { normalizeAsciiDiagram } from '../src/diagram';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('table separators align using column content widths', () => {
  const result = normalizeAsciiDiagram('+----+----+\n| A | Longer content |\n+----+----+');
  const columns = result.split('\n').map((row) => [...row].flatMap((c, i) => ('+|'.includes(c) ? [i] : [])));
  expect(columns[0]).toEqual(columns[1]);
  expect(columns[1]).toEqual(columns[2]);
  expect(result).toContain('Longer content');
});
test('repair is idempotent across ragged widths, titles and alphabets', () => {
  for (let width = 5; width < 40; width++) {
    const raw = `┌${'─'.repeat(width)}┐\n│ Текст ${' '.repeat(width % 5)}│\n│ café ${' '.repeat(width % 7)}│\n└${'─'.repeat(width + 2)}┘`;
    const fixed = normalizeAsciiDiagram(raw);
    expect(normalizeAsciiDiagram(fixed)).toBe(fixed);
    expect(asciiToSvg(raw)).toBe(asciiToSvg(fixed));
  }
});
test('real architecture keeps titles and emits straight closed panels', () => {
  const raw = readFileSync(new URL('../examples/diagrams/architecture.txt', import.meta.url), 'utf8');
  const svg = asciiToSvg(raw);
  expect(svg).toContain('build time');
  expect(svg).toContain('run time');
  expect(svg.match(/data-ascii-frame="true"/g)).toHaveLength(2);
});
test('ordinary text, limits, tabs and escaped labels are preserved', () => {
  expect(normalizeAsciiDiagram('ordinary <text>')).toBe('ordinary <text>');
  expect(normalizeAsciiDiagram('a\tb')).toBe('a   b');
  expect(() => normalizeAsciiDiagram('x'.repeat(401))).toThrow();
  const svg = asciiToSvg('+----------------------+\n| <script> & "label" |\n+----------------------+');
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&lt;script&gt;');
  expect(svg).toContain('&amp;');
});
test('CLI repairs stdin geometry and rejects invalid scene input without starting the vector backend', () => {
  const cli = new URL('../bin/vecli.ts', import.meta.url).pathname;
  const input = '+----------+\n| CLI |\n| A longer value |\n+----+';
  const success = spawnSync(process.execPath, [cli, 'diagram', 'ascii'], { input, encoding: 'utf8', timeout: 15000 });
  expect(success.status).toBe(0);
  expect(success.stdout).toBe(asciiToSvg(input));
  const invalid = spawnSync(process.execPath, [cli, 'diagram', 'scene', 'not json'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain('Invalid JSON');
});
