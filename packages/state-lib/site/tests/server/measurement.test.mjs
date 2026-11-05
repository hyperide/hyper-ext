import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const fixture = () => ({
  version: 1,
  exampleId: 'board-commands',
  sourceHash: 'a'.repeat(64),
  sourceRevision: 'b'.repeat(40),
  settings: { count: 30, operation: 'move', samples: 3, historyLimit: 40, includeSetup: false },
  rows: ['reference', 'compiled'].map((variant) => ({
    variant,
    samplesMs: [1, 2, 3],
    medianMs: 2,
    p95Ms: 3,
    iterations: 10,
    totalMs: 60,
    checksum: 'c'.repeat(64),
  })),
  equivalent: true,
  environment: { engine: 'Chromium', engineVersion: '153', platform: 'macOS', timerResolutionMs: 0.1 },
  createdAt: '2026-09-24T19:00:00.000Z',
});
async function api() {
  assert(existsSync(new URL('../../server/measurement-model.mjs', import.meta.url)), 'Implement bounded measurement validation');
  return import('../../server/measurement-model.mjs');
}
test('valid measurements retain samples but not arbitrary source or device fields', async () => {
  const { validateMeasurement } = await api(),
    result = fixture();
  assert.deepEqual(validateMeasurement(result), result);
  result.code = 'private source';
  assert.throws(() => validateMeasurement(result), /Unknown/);
});
test('invalid, forged aggregate or divergent outputs do not enter shared comparisons', async () => {
  const { validateMeasurement } = await api();
  for (const mutate of [
    (x) => (x.rows[0].samplesMs[0] = -1),
    (x) => (x.rows[0].samplesMs[0] = NaN),
    (x) => (x.rows[0].medianMs = 0),
    (x) => (x.rows[0].totalMs = 999),
    (x) => (x.rows[1].checksum = 'd'.repeat(64)),
    (x) => (x.settings.count = 1e9),
    (x) => (x.environment.ip = '127.0.0.1'),
  ]) {
    const result = fixture();
    mutate(result);
    assert.throws(() => validateMeasurement(result));
  }
});
test('equivalent runs share a key while distinct slower conditions are retained', async () => {
  const { measurementKey } = await api(),
    first = fixture(),
    repeat = fixture();
  repeat.createdAt = '2026-09-24T19:01:00.000Z';
  assert.equal(measurementKey(first), measurementKey(repeat));
  repeat.rows[1].samplesMs = [2, 4, 6];
  repeat.rows[1].medianMs = 4;
  repeat.rows[1].p95Ms = 6;
  repeat.rows[1].totalMs = 120;
  assert.notEqual(measurementKey(first), measurementKey(repeat));
});
export { fixture };

test('measurement identity ignores JSON key order and includes the pinned source revision', async () => {
  const { measurementKey } = await api();
  const first = fixture(),
    reordered = fixture();
  reordered.settings = Object.fromEntries(Object.entries(reordered.settings).reverse());
  reordered.rows.reverse();
  assert.equal(measurementKey(first), measurementKey(reordered));
  const revised = fixture();
  revised.sourceRevision = 'd'.repeat(40);
  assert.notEqual(measurementKey(first), measurementKey(revised));
});

test('unclassified browsers can share a valid run without inventing an engine version', async () => {
  const { validateMeasurement } = await api();
  const input = fixture();
  input.environment.engine = 'Other';
  input.environment.engineVersion = 'unknown';
  assert.equal(validateMeasurement(input).environment.engineVersion, 'unknown');
  input.environment.engineVersion = 'free text';
  assert.throws(() => validateMeasurement(input));
});
