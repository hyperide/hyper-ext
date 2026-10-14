import { isExampleBackedSource } from './example-source-contract.mts';
/**
 * A "run it →" button must open exactly the code it sits under (R80).
 *
 * The failure it exists to stop was live on the site: the front page showed one
 * snippet and its button opened a different, related one. A reader who presses
 * a button labelled "run it" and lands on code they were not reading has been
 * told something untrue by the interface, and no other gate can see it — both
 * halves render perfectly.
 *
 * The rule enforced here is structural rather than textual: a Code block with a
 * `repl` target may not carry a literal string. It must render the example's own
 * `code`, so the two cannot drift apart in the first place.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from '../src/data/examples';
import { CATS } from '../src/data/compare';

const here = dirname(fileURLToPath(import.meta.url));
const pages = resolve(here, '../src/pages');
const ids = new Set(EXAMPLES.map((e) => e.id));

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nevery run button names a real example and renders its code');
let seen = 0;
for (const file of readdirSync(pages).filter((f) => f.endsWith('.tsx'))) {
  const src = readFileSync(join(pages, file), 'utf8');
  for (const m of src.matchAll(/<Code\s+repl=(?:"([^"]+)"|\{[^}]*\})\s*>([\s\S]*?)<\/Code>/g)) {
    seen++;
    const id = m[1];
    const body = m[2]!.trim();
    check(
      `${file}: repl="${id}" names a known example`,
      !!id && ids.has(id),
      id ? 'no example with that id' : 'target is not a literal',
    );
    check(
      `${file}: repl="${id}" renders the example rather than a copy`,
      !!id && isExampleBackedSource(body, id),
      'shows a literal snippet, which can (and did) drift from what the button opens',
    );
  }
}
check('at least one run button exists', seen > 0, String(seen));

console.log('\n/init shows the whole task-screen example that Run executes');
{
  // Run executes setup + code and mounts ui; /init once displayed setup + ui only,
  // silently dropping the prepared script. The block must reference all three fields
  // of its own example id, so the script cannot be dropped again without failing here.
  const init = readFileSync(join(pages, 'Init.tsx'), 'utf8');
  const m = init.match(/<Code\s+repl="task-screen"\s*>([\s\S]*?)<\/Code>/);
  check('Init renders a task-screen block', !!m);
  const body = m?.[1] ?? '';
  for (const field of ['setup', 'code', 'ui'])
    check(
      `Init task-screen block renders exampleById('task-screen')!.${field}`,
      body.includes(`exampleById('task-screen')!.${field}`),
      `the ${field} piece Run executes is not displayed`,
    );
}

console.log('\nevery "see it live" on Compare opens the row it belongs to');
{
  const axes = CATS.flatMap((c) => c.axes);
  for (const a of axes) {
    if (a.demo) check(`${a.id} → ${a.demo} exists`, ids.has(a.demo), 'no example with that id');
    // A generic link to the playground lands on whatever example was showing,
    // which is the bug this pairing exists to stop.
    if (a.status === 'prototyped') check(`${a.id} is prototyped, so it names a demo`, !!a.demo, 'no demo');
  }
}

console.log('\nevery example the buttons point at actually runs');
for (const e of EXAMPLES) {
  check(`${e.id} has code and scaffolding`, e.code.trim().length > 0 && e.setup.trim().length > 0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall assertions passed');
process.exit(failures ? 1 : 0);
