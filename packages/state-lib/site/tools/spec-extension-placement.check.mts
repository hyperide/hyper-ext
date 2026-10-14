import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeSpec } from '../src/lib/spec-compose.mjs';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('canonical amendments have one anchor and sit in the relevant real master-spec chapters', () => {
  const modules = [
    ['normalized-views', 5],
    ['ux-actions', 5],
    ['compiler-tooling', 6],
    ['binary-interop', 9],
    ['operator-algebra', 9],
    ['simd-measurements', 14],
  ] as const;
  const grouped = new Map<number, string>();
  for (const [file, before] of modules)
    grouped.set(before, `${grouped.get(before) || ''}\n${read(`../../docs/spec/${file}.md`)}`);
  const original = read('../src/content/spec.md');
  const full = composeSpec(original, grouped);
  for (const [file] of modules) {
    const body = read(`../../docs/spec/${file}.md`);
    const id = /id="([^"]+)"/.exec(body)![1];
    assert.equal(full.split(`id="${id}"`).length - 1, 1);
    assert(full.includes(body));
  }
});
