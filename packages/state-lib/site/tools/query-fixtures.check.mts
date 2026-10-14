import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { QUERY_CASES, FIXTURE } from '../src/data/query-comparison';
import { runQueryFixture } from '../src/lib/run-query-fixture';
import { view } from '../src/lib/view-plan';
let n = 0;
for (const c of QUERY_CASES)
  for (const [name, v] of Object.entries(c.variants)) {
    if (!v) continue;
    if (v.status === 'executable') {
      const warnings: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      let result: unknown;
      try {
        result = await runQueryFixture(v);
      } finally {
        console.warn = originalWarn;
      }
      assert.deepEqual(result, c.expected, `${c.id} / ${name}`);
      n++;
      assert.deepEqual(warnings, [], `${c.id} / ${name} must not fall back to scans`);
    } else if (name === 'jq') {
      const result = JSON.parse(execFileSync('jq', [v.code], { input: JSON.stringify(FIXTURE), encoding: 'utf8' }));
      assert.deepEqual(result, c.expected, `${c.id} / jq`);
      n++;
    }
  }
const plan = view.from(FIXTURE.rows).where({ active: true }).orderBy('rank', 'desc').orderBy('id').take(2);
assert.deepEqual(plan.select('id'), [{ id: 'm1' }, { id: 'm2' }]);
const exposed = plan.explain();
exposed.order.length = 0;
assert.equal(plan.explain().order.length, 2, 'explain must not mutate plan');
assert.equal(view.from([]).sum('amount'), 0);
assert.throws(() => view.from(FIXTURE.rows).take(-1));
const nullOrderingError = { name: 'Error', message: 'Specify null ordering before using nullable sort keys' };
for (const direction of ['asc', 'desc'] as const) {
  for (const rows of [
    [{ x: null }, { x: 2 }],
    [{ x: 2 }, { x: null }],
    [{ x: undefined }, { x: 2 }],
  ]) {
    assert.throws(
      () => view.from<{ x: number | null | undefined }>(rows).orderBy('x', direction).run(),
      nullOrderingError,
    );
  }
}
assert.deepEqual(
  view
    .from([{ x: 2 }, { x: 1 }])
    .orderBy('x')
    .run(),
  [{ x: 1 }, { x: 2 }],
);
assert.deepEqual(view.from([{ x: null }, { x: 2 }]).run(), [{ x: null }, { x: 2 }]);
assert.throws(
  () =>
    view
      .from([{ x: 'two' }, { x: 2 }])
      .orderBy('x')
      .run(),
  { name: 'Error', message: 'Sort keys must be homogeneous finite numbers, strings or booleans' },
);
console.log(`all ${n} actual-library/jq fixture comparisons passed; proposal boundary tests passed`);
