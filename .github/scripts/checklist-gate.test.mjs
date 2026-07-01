#!/usr/bin/env bun
// Self-check for the PR checklist gate parser.
// Accessed via: `bun .github/scripts/checklist-gate.test.mjs` (and the
// `PR Checklist` GitHub Actions job, which imports the same parser module).
// Assumptions: this is the SINGLE source of truth test for parseUnchecked —
// the workflow imports the exact same module, so a green run here proves the
// real gate logic, not a copy.
//
// Not part of the repo's `bun run test` scope (client/lib/server/shared/
// vscode-extension), so it is a standalone runnable self-check: exits non-zero
// on any failed assertion.

import { parseUnchecked } from './checklist-gate.mjs';

let failures = 0;
function check(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// (a) body with an unchecked item -> it is returned, gate must fail
check('unchecked item is detected', parseUnchecked('## Acceptance criteria\n- [ ] do the thing\n- [x] done thing'), [
  '- [ ] do the thing',
]);

// (b) all checked -> nothing returned, gate passes
check('all checked passes', parseUnchecked('- [x] a\n- [X] b\n  - [x] nested done'), []);

// (c) no checkboxes at all -> passes
check('no checkboxes passes', parseUnchecked('Just prose, no tasks here.'), []);

// (d) null / empty body must not crash and must pass
check('null body passes', parseUnchecked(null), []);
check('empty body passes', parseUnchecked(''), []);
check('undefined body passes', parseUnchecked(undefined), []);

// (e) alternative bullet markers (* and +) and leading whitespace
check('star/plus bullets and indentation detected', parseUnchecked('  * [ ] star item\n\t+ [ ] plus item\n- [x] ok'), [
  '* [ ] star item',
  '+ [ ] plus item',
]);

// (f) inline `[ ]` that is NOT a task-list bullet must be ignored
check(
  'non-bullet brackets ignored',
  parseUnchecked('See array[ ] syntax. Also `foo[ ]` in code.\n- [x] real done'),
  [],
);

// (g) trims trailing whitespace in the reported line for clean output
check('reported line is trimmed', parseUnchecked('- [ ] trailing spaces   '), ['- [ ] trailing spaces']);

// (h) multiple spaces/tabs after bullet marker — valid GFM, must be detected
check('multiple spaces after marker detected', parseUnchecked('-   [ ] two-space indent\n-\t[ ] tab after marker'), [
  '-   [ ] two-space indent',
  '-\t[ ] tab after marker',
]);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
