import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createMeasurementRepository } from '../../server/measurement-repository.mjs';
import { fixture } from './measurement.test.mjs';
const host = process.env.STATE_TEST_PG_SOCKET;
// Needs the private cluster that tools/test-measurements-postgres.sh starts; the workspace runner has no
// PostgreSQL, so it reports a skip instead of failing. A set but non-ephemeral socket is still refused.
if (host && !host.startsWith('/tmp/state-measurements-'))
  throw Error('Use the dedicated ephemeral test cluster, never a project database');
const config = { host, port: 56419, user: 'state_test_owner', database: 'postgres', max: 2 };
test('a stored run survives a new connection, deduplicates repeats and retains slower observations', { skip: !host && 'STATE_TEST_PG_SOCKET is not set; run tools/test-measurements-postgres.sh' }, async () => {
  const pool = new Pool(config),
    repository = createMeasurementRepository(pool),
    input = fixture();
  const first = await repository.record(input, '1'.repeat(64));
  assert(first.stored);
  assert(!first.duplicate);
  const second = await repository.record(input, '1'.repeat(64));
  assert(second.duplicate);
  assert.equal(second.id, first.id);
  await pool.end();
  const next = new Pool(config),
    read = createMeasurementRepository(next);
  try {
    const rows = await read.recent(input.exampleId, input.sourceHash);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].observations), 2);
    assert.deepEqual(rows[0].result, input);
    assert.equal(rows[0].trust, 'visitor');
    input.rows[1].samplesMs = [2, 4, 6];
    input.rows[1].medianMs = 4;
    input.rows[1].p95Ms = 6;
    input.rows[1].totalMs = 120;
    assert((await read.record(input, '1'.repeat(64))).stored);
    assert.equal((await read.recent(input.exampleId, input.sourceHash)).length, 2);
    for (let i = 0; i < 60; i++) await read.record(fixture(), '2'.repeat(64));
    await assert.rejects(read.record(fixture(), '2'.repeat(64)), (error) => error.status === 429);
    await assert.rejects(read.recent("board-commands' OR 1=1 --", input.sourceHash));
  } finally {
    await next.end();
  }
});
