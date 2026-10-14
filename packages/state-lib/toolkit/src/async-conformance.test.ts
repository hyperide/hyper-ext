import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../../runtime/src/index.js';
import { CONFORMANCE_SCENARIOS, runConformanceScenario, type ConformanceAssert } from './testing.js';
import { createAsyncResource } from './async-resource.js';

const check: ConformanceAssert = {
  equal: (actual, expected, message) => assert.equal(actual, expected, message),
  ok: (value, message) => assert.ok(value, message),
  throws: (fn, expected, message) => assert.throws(fn, expected as never, message),
  rejects: (prone, expected, message) => assert.rejects(prone, expected as never, message),
};

for (const scenario of CONFORMANCE_SCENARIOS) {
  test(`conformance: ${scenario.id} — ${scenario.title}`, async () => {
    const runtime = new Runtime();
    try {
      await runConformanceScenario(
        scenario.id,
        (inner, options) => createAsyncResource(inner, options),
        runtime,
        check,
      );
    } finally {
      runtime.dispose();
    }
  });
}
