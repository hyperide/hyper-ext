import test from 'node:test';
import assert from 'node:assert/strict';
import * as json from '../2026-09-19-cow/json-draft.mjs';
import { captureJsonSnapshot } from '../2026-09-19-cow/json-capture.mjs';
const capture = (value) => {
  assert.equal(typeof captureJsonSnapshot, 'function');
  return captureJsonSnapshot(value);
};
test('owned immutable snapshots cross an async queue without another copy', () => {
  const value = json.ownJson({ rows: [{ id: 1, text: 'old' }] });
  assert.equal(capture(value), value);
  const next = json.setJsonScalar(value, ['rows', 0, 'text'], 'new');
  assert.equal(capture(next), next);
  assert.equal(value.rows[0].text, 'old');
});
test('plain and superficially frozen objects never become trusted immutable snapshots', () => {
  for (const value of [{ rows: [{ text: 'old' }] }, Object.freeze({ rows: [{ text: 'old' }] })]) {
    const saved = capture(value);
    assert.notEqual(saved, value);
    assert.notEqual(saved.rows, value.rows);
    value.rows[0].text = 'new';
    assert.equal(saved.rows[0].text, 'old');
  }
});
test('unowned capture preserves structured-clone behavior including holes and undefined', () => {
  const value = { rows: new Array(3), optional: undefined };
  value.rows[1] = 'middle';
  const saved = capture(value);
  assert.deepEqual(saved, value);
  assert.equal(0 in saved.rows, false);
});
