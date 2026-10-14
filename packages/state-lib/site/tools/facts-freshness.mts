/**
 * Gate: the site's self-describing numbers must match their sources.
 *
 * Every fact the site states about itself — the spec version on the Compare
 * badges, the requirement range, the prototype's size — is derived in
 * src/data/facts.ts. This harness renders the pages that quote those facts and
 * checks the rendered text against the sources directly, so a value that gets
 * hardcoded back in (the failure this exists to catch: Compare wore a
 * "spec v0.4" badge for two spec versions) fails a run rather than a reader.
 */
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { chromium } from './browser.mts';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
const read = (p: string) => readFileSync(resolve(here, p), 'utf8');

const specMd = read('../src/content/spec.md');
const reqMd = read('../src/content/requirements.md');
const proto = read('../src/lib/proto.ts');

const specVersion = specMd.match(/\*\*Status:\*\*\s*draft\s*(v[\d.]+)/)?.[1];
const reqMax = Math.max(...[...reqMd.matchAll(/^- \*\*R(\d+)/gm)].map((m) => Number(m[1])));
const protoLines = Math.floor(proto.split('\n').length / 50) * 50;

if (!specVersion) {
  console.log('FAIL — could not read the spec version from its status line');
  process.exit(1);
}

/**
 * [route, strings that must appear, patterns whose every hit must name the
 * current spec version]. The second list is what catches a hardcoded badge:
 * any "spec v0.N" on the page that is not the version the spec itself declares.
 */
const benchmark = JSON.parse(read('./bench-results.json')) as {
  provenance: { commit: string; ranAt: string };
  suites: { suite: string; rows: { name: string; ms: number }[] }[];
};
const timingRows = benchmark.suites.find((suite) => suite.suite.startsWith('R66'))!.rows;
const timings = [
  timingRows.find((row) => row.name === 'recompute · 10,000 rows')!,
  timingRows.find((row) => row.name.startsWith('deriveCollection · 10,000 rows'))!,
].map((row) => `${row.ms} ms`);
const checks: [string, string[], RegExp[]][] = [
  ['/', [benchmark.provenance.commit, benchmark.provenance.ranAt.slice(0, 10), ...timings], [/Master spec v[\d.]+/g]],
  ['/compare', [`spec ${specVersion}`], [/spec v[\d.]+/g]],
  ['/playground', [`~${protoLines}-line`], []],
  ['/repl', [`~${protoLines}-line`], []],
];

/**
 * The markdown under src/content/ is a COPY of the document it names, bundled so
 * the site can render it offline. A forgotten copy after a doc edit leaves the
 * whole page stale with every other gate green — and this session did that copy
 * by hand three times. Checked first, because if the copy is stale then every
 * number below is derived from the wrong file.
 */
const COPIES: [string, string][] = [
  ['../src/content/spec.md', '../../docs/2026-09-01-state-master-spec.md'],
  ['../src/content/requirements.md', '../../REQUIREMENTS.md'],
  ['../src/content/decisions.md', '../../DECISIONS.md'],
  ['../src/content/brief.md', '../../docs/2026-09-01-state-management-research-brief.md'],
];
let bad = 0;
console.log('bundled copies match their source documents');
for (const [copy, source] of COPIES) {
  let same: boolean;
  try {
    same = read(copy) === read(source);
  } catch (e) {
    bad++;
    console.log(`  FAIL ${copy} — ${(e as Error).message}`);
    continue;
  }
  if (same) console.log(`  ok   ${copy}`);
  else {
    bad++;
    console.log(
      `  FAIL ${copy} is stale — run: cp ${relative(resolve(here, '../../../..'), resolve(here, source))} ${relative(resolve(here, '../../../..'), resolve(here, copy))}`,
    );
  }
}
console.log();

const b = await chromium.launch();
for (const [route, must, mustNot] of checks) {
  const p = await b.newPage();
  await p.goto(`file://${dist}#${route}`);
  await p.waitForTimeout(350);
  const sourceDetails = p.locator('.repl-safety:not([open]) > summary');
  if (await sourceDetails.count()) await sourceDetails.click();
  const text = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const missing = must.filter((m) => !text.includes(m.replace(/\s+/g, ' ')));
  const stale = mustNot.flatMap((re) => (text.match(re) ?? []).filter((h: string) => !h.includes(specVersion)));
  if (missing.length || stale.length) {
    bad++;
    console.log(`FAIL ${route}`);
    for (const m of missing) console.log(`   missing: ${m}`);
    for (const s of stale) console.log(`   stale:   ${s}`);
  } else console.log(`ok   ${route}  (spec ${specVersion} · R1–R${reqMax} · ~${protoLines} lines)`);
  await p.close();
}
await b.close();
console.log(
  bad
    ? `\n${bad} page(s) quote a stale fact — derive it in src/data/facts.ts`
    : `\nall ${checks.length} pages quote their sources correctly`,
);
process.exit(bad ? 1 : 0);
