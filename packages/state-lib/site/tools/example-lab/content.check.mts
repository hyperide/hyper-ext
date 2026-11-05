import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAB_EXAMPLES } from '../../src/data/example-lab/catalogue';
const source = readFileSync('src/lib/ResearchEvidence.tsx', 'utf8');
for (const phrase of [
  'not a live browser run',
  'Less code for one declared projection',
  'not a theorem',
  'not a substitute',
  'Correctness passing does not erase',
])
  assert(!source.includes(phrase), `Remove internal-report copy: ${phrase}`);
assert(source.includes('/repl/board-commands'), 'Archived conditions should link into the current interactive example');
const spec = readFileSync('../docs/spec/live-example-lab.md', 'utf8');
for (const example of LAB_EXAMPLES)
  for (const mechanism of example.mechanisms)
    assert(spec.includes(`id="${mechanism.href.split('#')[1]}"`), 'Real mechanism target: ' + mechanism.href);
const app = readFileSync('src/App.tsx', 'utf8');
assert(
  app.includes('live-example-lab.md?raw'),
  'The mechanism document must be in the live spec, not only in the repository',
);
console.log('PASS: user-facing archive copy and exact live mechanism destinations');
