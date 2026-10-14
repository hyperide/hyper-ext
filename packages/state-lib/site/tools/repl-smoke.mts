/** Drive the REPL: run every example, assert each produces output and no error line,
 *  and that the hover inspector gets populated. */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { chromium } from './browser.mts';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
// Read from the source rather than repeating it: a hardcoded list silently
// stops covering the example you just added, which is when you most want it.
const ids = ['examples.ts', 'examples-other.ts'].flatMap((f) =>
  [...readFileSync(resolve(here, `../src/data/${f}`), 'utf8').matchAll(/^    id: '([^']+)'/gm)].map((m) => m[1]),
);
if (ids.length < 2) {
  console.log('FAIL — could not read the example ids from src/data/examples.ts');
  process.exit(1);
}
const b = await chromium.launch();
let bad = 0;
for (const id of ids) {
  const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  p.on('pageerror', (e: Error) => {
    console.error(`  PAGEERROR ${id}: ${e.message}`);
    bad++;
  });
  await p.goto(`file://${dist}#/repl/${id}`);
  await p.waitForTimeout(400);
  const runBtn = await p.$('button:has-text("run")');
  if (!runBtn) {
    console.log(`FAIL ${id}: no run button`);
    bad++;
    await p.close();
    continue;
  }
  await runBtn.click();
  await p.waitForTimeout(2200); // the cancellation examples run real timers
  const out = await p.$$eval('.repl-out > div', (ds: Element[]) => ds.map((d) => d.textContent ?? ''));
  const errs = await p.$$eval('.repl-err', (ds: Element[]) => ds.map((d) => d.textContent ?? ''));
  const chips = await p.$$eval('.tracechip', (cs: Element[]) => cs.length);
  // The other toolkits' examples run in a pane with no value inspector — the
  // inspector reads OUR frames — so a chip count is not a signal for them.
  const ours = await p.$$eval('.repl-techs .chip.on', (cs: Element[]) => (cs[0]?.textContent ?? '') === 'state');
  const ok = out.length > 0 && errs.length === 0 && (!ours || chips > 0);
  if (!ok) bad++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${id}: ${out.length} output line(s), ${chips} value chip(s)${errs.length ? `\n     ${errs.join('\n     ')}` : ''}`,
  );
  if (id === 'derived') await p.screenshot({ path: join(here, '.figures/page-repl.png'), fullPage: true });
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} failure(s)` : '\nall examples run clean');
process.exit(bad ? 1 : 0);
