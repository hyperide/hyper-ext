/**
 * Structural checks on the comparison matrix.
 *
 * The first one is here because two rows shipped sharing `id: 'keystroke'` —
 * one in Core ergonomics, one in Async — which rendered two elements with the
 * same DOM id, made hovering either row highlight both in different categories,
 * and pointed any inbound `#cmp-keystroke` link at whichever came first. React
 * did not warn, because keys are scoped per category; anchor-integrity did not
 * catch it, because nothing linked there yet. Nothing could have caught it
 * except this.
 */
import { CATS, LIBS, type Axis } from '../src/data/compare';
import { EXAMPLES } from '../src/data/examples';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const axes: Axis[] = CATS.flatMap((c) => c.axes);
const ids = axes.map((a) => a.id);

console.log('\nidentity');
{
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(`all ${ids.length} axis ids are unique`, dupes.length === 0, `duplicated: ${[...new Set(dupes)].join(', ')}`);
  check(
    'every id is anchor-safe',
    ids.every((id) => /^[a-z0-9-]+$/.test(id)),
    ids.filter((i) => !/^[a-z0-9-]+$/.test(i)).join(', '),
  );
}

console.log('\nevery row rates every library');
{
  const libIds = LIBS.map((l) => l.id);
  for (const a of axes) {
    const missing = libIds.filter((l) => !(l in a.cells));
    if (missing.length) check(`${a.id} rates every column`, false, `missing: ${missing.join(', ')}`);
  }
  check(
    'no row is missing a column',
    axes.every((a) => libIds.every((l) => l in a.cells)),
  );
  check(
    'every rating is 0-3',
    axes.every((a) => Object.values(a.cells).every((c) => c[0] >= 0 && c[0] <= 3)),
  );
  check(
    'state is rated on every row',
    axes.every((a) => a.cells.state !== undefined),
  );
}

console.log('\nclaims');
{
  const exampleIds = new Set(EXAMPLES.map((e) => e.id));
  for (const a of axes) {
    if (a.demo) check(`${a.id} names a real example`, exampleIds.has(a.demo), a.demo);
    if (a.status === 'prototyped') check(`${a.id} is prototyped, so it shows the thing`, !!a.demo, 'no demo');
  }
  // "measured" is the project's strongest word and it may only appear where a
  // number has provenance. The perf row once called a published V8
  // characteristic "a measured ~13x trap tax", which is exactly the claim the
  // no-number-without-a-source rule exists to prevent.
  const loose = axes.filter(
    (a) => /\bmeasured\b/i.test(a.ours) && !/(bench|provenance|harness|research|landscape|§13\.1)/i.test(a.ours),
  );
  check('no row says "measured" without pointing at where', loose.length === 0, loose.map((a) => a.id).join(', '));
}

console.log('\nprose');
{
  check(
    'every row explains itself',
    axes.every((a) => a.ours.length > 80 && a.why.length > 80),
    axes
      .filter((a) => a.ours.length <= 80 || a.why.length <= 80)
      .map((a) => a.id)
      .join(', '),
  );
  check(
    'every axis title is a claim, not a label',
    axes.every((a) => a.axis.split(' ').length >= 3),
    axes
      .filter((a) => a.axis.split(' ').length < 3)
      .map((a) => a.id)
      .join(', '),
  );
}

console.log(
  failures
    ? `\n${failures} check(s) failed`
    : `\nall assertions passed (${axes.length} axes across ${CATS.length} categories)`,
);
process.exit(failures ? 1 : 0);
