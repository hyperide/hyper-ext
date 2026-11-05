/**
 * Public-copy repair (HYP-1489): the surfaces below must explain the product, not internal
 * progress or defensive disclaimers, and the useful demo/spec links must survive the rewrite.
 * Source-level check: runs without a build or a browser.
 *
 *   cd packages/state-lib/site && tsx tools/public-copy.check.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
/** Collapse JSX/HTML line wrapping so a phrase cannot hide across a newline. */
const flat = (text: string) => text.replace(/\s+/g, ' ');

const SURFACES: Record<string, string> = {
  home: '../src/pages/Home.tsx',
  concepts: '../src/pages/Concepts.tsx',
  conceptsFragment: '../src/content/concepts-fragment.html',
  researchConcepts: '../src/lib/ResearchConcepts.tsx',
  init: '../src/pages/Init.tsx',
  initWizard: '../src/data/init-wizard.ts',
  api: '../src/pages/Api.tsx',
  apiDocs: '../src/lib/api-docs.ts',
  examples: '../src/data/examples.ts',
  screenExamples: '../src/data/screen-examples.ts',
  learningExamples: '../src/data/learning-examples.ts',
  glossary: '../src/data/glossary.ts',
  learning: '../src/content/learning.md',
  learningCanonical: '../../docs/research/2026-09-08-reactivity-sync-and-reading.md',
};
const text = Object.fromEntries(Object.entries(SURFACES).map(([k, p]) => [k, flat(read(p))]));

const BAD: [surface: string, phrase: string][] = [
  ['home', 'A SYNTHESIS, NOT A CLAIM'],
  ['home', 'Native is a foundation, not a browser claim'],
  ['home', 'What is not yet a universal guarantee'],
  ['home', 'still being integrated'],
  ['home', 'Checked behavior, not just timing'],
  ['home', 'These are executable contracts'],
  ['home', 'Those are mechanisms to measure'],
  ['home', 'not a claim that Redux'],
  ['home', 'not proof that an update helper is deficient'],
  ['home', 'not a reason to hide useful'],
  ['home', 'MEASUREMENT BEFORE SUPERLATIVES'],
  ['home', 'A narrow improvement is not an application-wide speedup'],
  ['home', 'Historical isolated workload'],
  ['home', 'CAPTURE PIPELINE PLANNED'],
  ['home', 'FULL DEVTOOLS PLANNED'],
  ['home', 'No npm installation or production-readiness promise'],
  ['api', 'no dedicated prose comment'],
  ['examples', 'clearly labelled'],
  ['examples', 'our composition'],
  ['examples', 'No planned useSlice'],
  ['examples', 'not a claim that every dispose'],
  ['glossary', 'our composition'],
  ['screenExamples', 'not a unique checkbox capability'],
  ['screenExamples', 'not things Zustand makes impossible'],
  ['learningExamples', 'not a running Electric server or a benchmark'],
  ['learningExamples', 'not a claim about a browser paint'],
  ['init', 'has not actually run anywhere'],
  ['init', 'nothing invented'],
  ['init', 'not a production npm installation recipe'],
  ['init', 'R19 R24 R26 R38'],
  ['init', 'are real today'],
  ['initWizard', 'would be a fabrication'],
  ['initWizard', 'R19 is explicit'],
  ['concepts', 'Glossary (R63)'],
  ['concepts', 'concepts v1'],
  ['concepts', 'being added, starting'],
  ['conceptsFragment', 'Why it matters for us'],
  ['conceptsFragment', 'It runs today'],
  ['conceptsFragment', 'Nor is it a slide'],
  ['conceptsFragment', 'R48, pending'],
  ['conceptsFragment', 'the mechanism that made it expensive is gone'],
  ['researchConcepts', 'Research concepts ·'],
  ['researchConcepts', 'does not yet inspect every application command'],
  ['researchConcepts', 'does not qualify every COW performance case'],
  ['researchConcepts', 'not a switch already optimizing'],
];
for (const [surface, phrase] of BAD) {
  assert(!text[surface].includes(phrase), `${surface}: internal or defensive phrase is back: "${phrase}"`);
}
for (const surface of ['learning', 'learningCanonical']) {
  for (const phrase of [
    'Runtime implementation and verification status',
    'not a formally proved production StateIR runtime',
    'Test coverage does not imply',
    'This site no longer equates',
    'The REPL now lists these',
    'The served build now prerenders',
    'The JSX editor now uses',
    "Danny's proposed",
    'not a claimed large-scale benchmark',
    'Research checked against the primary sources',
  ]) {
    assert(!text[surface].includes(phrase), `${surface}: progress-report phrase is back: "${phrase}"`);
  }
}

const KEEP: [surface: string, needle: string][] = [
  // live app demos and the working screen
  ['home', "familiar('/repl/board-commands'"],
  ['home', "familiar('/repl/issue-triage'"],
  ['home', "familiar('/repl/task-screen'"],
  ['home', "familiar('/bench'"],
  // precise spec links stay, as mechanisms
  ['home', "familiar('/spec#s4-15'"],
  ['home', "familiar('/spec#s4-7'"],
  ['conceptsFragment', 'href="#/spec#s4-1"'],
  ['conceptsFragment', 'href="#/spec#s4-4"'],
  ['conceptsFragment', 'href="#/spec#s4-15"'],
  ['conceptsFragment', 'href="#/spec#s4-16"'],
  ['conceptsFragment', 'href="#/repl/transient"'],
  ['conceptsFragment', 'href="#/repl/cancellation"'],
  ['conceptsFragment', 'href="#/repl/regions"'],
  ['conceptsFragment', 'How state uses it'],
  // genuine constraints and conditions stay
  ['home', 'Different runs and devices are not comparable'],
  ['home', 'Prototype · not published to npm'],
  ['home', 'Exhaustive async binding'],
  ['examples', 'designed, not built'],
  ['examples', 'tags alone do not enable storage or sync'],
  ['apiDocs', 'not frozen or structurally shared'],
  ['init', 'the CLI itself is not published yet'],
  ['init', 'API sketch (planned)'],
  ['init', 'planned</span>'],
  ['learningExamples', 'Simulation, no network'],
  ['learning', 'not the published production library'],
];
for (const [surface, needle] of KEEP) {
  assert(text[surface].includes(needle), `${surface}: expected to keep "${needle}"`);
}

// The API entry renders a paragraph only when a description exists.
assert(text.api.includes('{prose && <p>{prose}</p>}'), 'api: empty description must render nothing');
// Both learning copies stay identical, so the served page and the docs cannot drift.
assert.equal(read(SURFACES.learning), read(SURFACES.learningCanonical), 'learning mirror differs from canonical doc');

console.info('PASS: public copy has no internal-progress phrases; demo, spec and constraint anchors remain');
