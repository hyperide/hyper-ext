/**
 * The spec's status line says, in public, on the front of the document:
 * "Every requirement R1–R84 now names a destination." This checks that.
 *
 * It is the kind of claim that is true on the day it is written and quietly
 * false a week later, when a new requirement is appended to REQUIREMENTS.md and
 * the traceability table is not touched. Nothing else notices: the spec still
 * builds, the site still renders, and the sentence still reads well.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');
const req = read('../../REQUIREMENTS.md');
const spec = read('../../docs/2026-09-01-state-master-spec.md');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Requirement ids as REQUIREMENTS.md defines them. */
const defined = [...new Set([...req.matchAll(/^- \*\*R(\d+)\b/gm)].map((m) => Number(m[1])))].sort((a, b) => a - b);

/**
 * Ids mentioned anywhere in a markdown table row of the spec. The traceability
 * table pairs two columns per row and some cells carry two ids ("R24 CLI,
 * R25 agent tools"), so this reads the whole row rather than a cell's first token.
 */
const placed = new Set<number>();
for (const line of spec.split('\n')) {
  if (!line.startsWith('|')) continue;
  for (const m of line.matchAll(/\bR(\d+)\b/g)) placed.add(Number(m[1]));
}

console.log('\nevery requirement names a destination in the spec');
const missing = defined.filter((r) => !placed.has(r));
check(
  `all ${defined.length} requirements are placed`,
  missing.length === 0,
  missing.length ? `missing: ${missing.map((r) => `R${r}`).join(', ')}` : '',
);

const max = Math.max(...defined);
const claimed = spec.match(/Every requirement R1–R(\d+) now names a destination/);
check(
  'the status line names the real range',
  claimed?.[1] === String(max),
  `says R${claimed?.[1] ?? '?'}, highest is R${max}`,
);

console.log('\nno requirement id is invented by the spec');
const ghosts = [...placed].filter((r) => !defined.includes(r)).sort((a, b) => a - b);
check(
  'every id in the tables is defined in REQUIREMENTS.md',
  ghosts.length === 0,
  ghosts.length ? `not defined: ${ghosts.map((r) => `R${r}`).join(', ')}` : '',
);

console.log('\nthe requirement list has no gaps or duplicates');
const gaps = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !defined.includes(n));
check(
  `R1 through R${max} are all defined`,
  gaps.length === 0,
  gaps.length ? `gaps: ${gaps.map((r) => `R${r}`).join(', ')}` : '',
);
const dupes = [...req.matchAll(/^- \*\*R(\d+)\b/gm)].map((m) => m[1]);
check('no requirement id is defined twice', dupes.length === new Set(dupes).size);

console.log(failures ? `\n${failures} check(s) failed` : '\nall assertions passed');
process.exit(failures ? 1 : 0);
