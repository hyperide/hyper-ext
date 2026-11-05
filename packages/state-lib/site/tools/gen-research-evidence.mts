/** Derive browser summaries from one canonical observation file; raw trials stay downloadable. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const input = new URL('../../docs/research/datasets/2026-09-20-public-evidence.json', import.meta.url);
const output = new URL('../src/data/research-evidence.generated.json', import.meta.url);
const raw = JSON.parse(readFileSync(input, 'utf8'));
const rows = raw.controller.rows.map((row: { samples: number[]; medianMs: number }) => {
  const { samples, ...fields } = row;
  assert(
    samples.length === 17 && samples.every((value) => Number.isFinite(value) && value >= 0),
    'Invalid research observation',
  );
  const ordered = [...samples].sort((a, b) => a - b);
  assert.equal(ordered[Math.floor(ordered.length / 2)], row.medianMs, 'Recorded median differs from samples');
  return { ...fields, sampleCount: samples.length, minimumMs: ordered[0], maximumMs: ordered.at(-1) };
});
const compact = {
  ...raw,
  generatedFrom: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  controller: { ...raw.controller, rows },
};
const text = JSON.stringify(compact, null, 2) + '\n';
let current: unknown;
try {
  current = JSON.parse(readFileSync(output, 'utf8'));
} catch {
  /* First generated build or invalid derived output. */
}
// Repository formatting must not make every subsequent build dirty.
if (!isDeepStrictEqual(current, compact)) writeFileSync(output, text);
console.log(
  `Research evidence: ${rows.length} summaries; raw samples excluded from ${fileURLToPath(output).split('/').at(-1)}`,
);
