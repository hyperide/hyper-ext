import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert(existsSync('src/lib/example-lab/core.ts'), 'The shared comparison model exists');
const { resolveSourcePath, summarizeSamples, validateRunSettings } = await import('../../src/lib/example-lab/core');
assert.equal(resolveSourcePath('/src', './core.js'), '/src/core.js');
assert.equal(resolveSourcePath('/src/generated', '../point.ts'), '/src/point.ts');
for (const path of ['../../../outside.js', 'https://example.com/code.js', 'node:fs', 'data:text/javascript,x'])
  assert.throws(() => resolveSourcePath('/src', path));
assert.deepEqual(summarizeSamples([3, 1, 2, 4, 5]), { medianMs: 3, p95Ms: 5 });
for (const values of [[], [NaN], [Infinity], [-1]]) assert.throws(() => summarizeSamples(values));
assert.equal(
  validateRunSettings({ count: 30, operation: 'move', samples: 5, historyLimit: 40, includeSetup: false }).count,
  30,
);
for (const count of [-1, 100000000, 1.5])
  assert.throws(() =>
    validateRunSettings({ count, operation: 'point', samples: 5, historyLimit: 40, includeSetup: false }),
  );
console.log('PASS: closed source resolution, real sample statistics and bounded run settings');
const core = await import('../../src/lib/example-lab/core');
assert.equal(typeof core.compilerIdentity, 'function', 'Comparison identity must use only relevant compiler inputs');
const manifest = {
  rustSources: { 'src/lib.rs': 'a' },
  harness: { 'execution.worker.js': 'b' },
  assets: {
    'statec.js': { sha256: 'c' },
    'statec_bg.wasm': { sha256: 'd' },
    'esbuild.wasm': { sha256: 'e' },
    'other-example.json': { sha256: 'old' },
  },
};
const changed = structuredClone(manifest);
changed.assets['other-example.json'].sha256 = 'new';
assert.deepEqual(
  core.compilerIdentity(manifest),
  core.compilerIdentity(changed),
  'Unrelated example or marketing metadata cannot alter this code identity',
);
changed.assets['statec_bg.wasm'].sha256 = 'different-compiler';
assert.notDeepEqual(core.compilerIdentity(manifest), core.compilerIdentity(changed));
assert.equal(typeof core.timingRelation, 'function');
assert.equal(core.timingRelation(0, 1), 'timer-floor');
assert.equal(core.timingRelation(0, 0), 'timer-floor');
assert.equal(core.timingRelation(2, 2), 'tie');
assert.equal(core.timingRelation(1, 2), 'different');
assert.equal(typeof core.scriptString, 'function');
const markers = '/* <!-- <script </script> */';
assert(!core.scriptString(markers).includes('<'));
assert.equal(JSON.parse(core.scriptString(markers)), markers);
