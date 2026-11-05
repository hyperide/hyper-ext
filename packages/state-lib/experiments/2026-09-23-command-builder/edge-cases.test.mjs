import test from 'node:test';
import assert from 'node:assert/strict';
import * as json from '../2026-09-19-cow/json-draft.mjs';

test('numeric and canonical string indices address the same fields; metadata cannot be written', () => {
  const base = json.ownJson({ rows: [{ value: 1 }], other: [] });
  for (const key of [0, '0']) assert.equal(json.setJsonScalar(base, ['rows', key, 'value'], 2).rows[0].value, 2);
  for (const key of [-1, '01', '1.0', 'length', 4294967295, NaN, {}, undefined]) {
    assert.throws(() => json.setJsonScalar(base, ['rows', key, 'value'], 2));
    assert.deepEqual(base, { rows: [{ value: 1 }], other: [] });
  }
});
test('branching from an old root repeatedly leaves all siblings and source unchanged', () => {
  const base = json.ownJson({ rows: Array.from({ length: 64 }, (_, value) => ({ value })), other: [] });
  const branches = [];
  for (let n = 0; n < 80; n++) branches.push(json.moveJsonItem(base, ['rows'], n % 64, ['other'], 0));
  for (let n = 0; n < branches.length; n++) {
    assert.equal(branches[n].other[0], base.rows[n % 64]);
    assert.equal(branches[n].rows.length, 63);
    assert.equal(base.rows.length, 64);
  }
});
test('graph aliases preserve shared row updates and reject cyclic moves atomically', () => {
  const row = { value: 1 },
    base = json.ownJson({ rows: [row, row], mirror: row, other: [] });
  const next = json.setJsonScalar(base, ['rows', 0, 'value'], 2);
  assert.equal(next.rows[0], next.rows[1]);
  assert.equal(next.rows[0], next.mirror);
  assert.equal(base.mirror.value, 1);
  assert.equal(next.mirror.value, 2);
  const child = { children: [] },
    graph = json.ownJson({ rows: [child], alias: child });
  assert.throws(() => json.moveJsonItem(graph, ['rows'], 0, ['alias', 'children'], 0), /acyclic JSON/);
  assert.equal(graph.rows.length, 1);
  assert.equal(graph.alias.children.length, 0);
});
