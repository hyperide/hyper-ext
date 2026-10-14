/**
 * Every gate, in the order that makes a failure legible: unit tests against the
 * prototype first (they need no browser and a failure there explains failures
 * downstream), then the build, then the harnesses that drive the built page.
 *
 *   cd packages/state-lib/site && bun run check
 *
 * The list is here rather than in a README because a list in a README is a list
 * nobody runs. Adding a harness means adding one line; forgetting to is the
 * failure mode this file exists to remove.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const unit = readdirSync(here)
  .filter((f) => f.endsWith('.check.mts'))
  .sort();
/** Page-driving harnesses, in dependency order. Screenshot and figure-rendering
 *  tools are deliberately absent: they produce artefacts for a human to look at,
 *  they do not assert anything, and a gate that cannot fail is noise. */
const page = [
  'prerender-regression.mts',
  'check-routes.mts',
  'anchor-integrity.mts',
  'anchor-scroll.mts',
  'toc-smoke.mts',
  'repl-smoke.mts',
  'facts-freshness.mts',
  'served-mode.mts',
  'responsive.mts',
  'prose-escaping.mts',
  'markdown-export.mts',
  'hover.mts',
  'reference-tour.mts',
  'docs-refresh.mts',
  'experience-smoke.mts',
  'diagram-devices.mts',
  'repl-smoke-new.mts',
];

const run = (label: string, cmd: string, args: string[]) => {
  const t = Date.now();
  const r = spawnSync(cmd, args, { cwd: join(here, '..'), encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? '\n' + String(r.error) : '');
  const logDir = join(here, 'artifacts', 'gates');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, `${label.replace(/[^a-zA-Z0-9-]/g, '-')}.log`), out);
  const ok = r.status === 0;
  const tail =
    out
      .trim()
      .split('\n')
      .filter((l) => !/DeprecationWarning|trace-deprecation/.test(l))
      .at(-1) ?? '';
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(30)} ${((Date.now() - t) / 1000).toFixed(1)}s  ${tail}`);
  if (!ok)
    console.log(
      out
        .split('\n')
        .filter((l) => /FAIL|Error|✖/.test(l))
        .slice(0, 12)
        .map((l) => `        ${l}`)
        .join('\n'),
    );
  return ok;
};

let bad = 0;
if (!run('TypeScript', 'tsc', ['--noEmit'])) bad++;
console.log('\nunit — the prototype against its claims');
for (const f of unit) if (!run(f.replace('.check.mts', ''), 'tsx', [`tools/${f}`])) bad++;

console.log('\nbuild');
if (!run('vite build', 'npm', ['run', 'build'])) {
  console.log('\nbuild failed — the page harnesses below would only report its symptoms');
  process.exit(1);
}

if (!run('served static build', 'npm', ['run', 'build:served'])) {
  console.log('Static build failed');
  process.exit(1);
}
if (!run('static reading', 'tsx', ['tools/static-reading.mts'])) bad++;

console.log('\npage — the built site, driven');
for (const f of page) if (!run(f.replace('.mts', ''), 'tsx', [`tools/${f}`])) bad++;

console.log(bad ? `\n${bad} gate(s) failed` : `\nall ${unit.length + page.length + 4} gates passed`);
process.exit(bad ? 1 : 0);
