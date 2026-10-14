import { chooseScriptedDemo } from './workbench-fixture.mts';
/** Drive the REPL: run every example, assert each produces output and no error line,
 *  and that the hover inspector gets populated. */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES, exampleById } from '../src/data/examples';
import { chromium } from './browser.mts';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
// Only registered example IDs are runnable routes; task group names are not examples.
const ids = [...new Set(EXAMPLES.map((example) => example.id))];
if (!EXAMPLES.length) throw new Error('No runnable examples exported');
const b = await chromium.launch();
let bad = 0;
for (const id of ids) {
  const expected = exampleById(id);
  if (!expected) throw new Error(`Missing registered example ${id}`);
  const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  p.on('pageerror', (e: Error) => {
    console.error(`  PAGEERROR ${id}: ${e.message}`);
    bad++;
  });
  await p.goto(`file://${dist}#/repl/${id}`);
  await p.waitForTimeout(400);
  if ((await p.locator('.pane-primary .pane-head b').innerText()) !== expected.title)
    throw new Error(`Route ${id} rendered a different example`);
  await chooseScriptedDemo(p);
  const runBtn = await p.$('.pane-primary .runall');
  if (!runBtn) {
    console.log(`FAIL ${id}: no run button`);
    bad++;
    await p.close();
    continue;
  }
  await runBtn.click();
  await p.locator('.pane-primary .guide-debug > summary').click();
  await p.waitForTimeout(2200); // the cancellation examples run real timers
  const out = await p.$$eval('.repl-out > div', (ds: Element[]) => ds.map((d) => d.textContent ?? ''));
  const errs = await p.$$eval('.repl-err', (ds: Element[]) => ds.map((d) => d.textContent ?? ''));
  const chips = await p.$$eval('.pane-primary .tracechip', (cs: Element[]) => cs.length);
  // The other toolkits' examples run in a pane with no value inspector — the
  // inspector reads OUR frames — so a chip count is not a signal for them.
  const ours = await p.$$eval('.repl-techs .chip.on', (cs: Element[]) => (cs[0]?.textContent ?? '') === 'state');
  const screenResult =
    expected.task === 'screen' &&
    (await p.locator('.example-screen').count()) === 1 &&
    (await p.locator('.example-screen header strong').innerText()) === '0' &&
    (await p.locator('.state-tree-root').innerText()).includes('true');
  const ok = (out.length > 0 || screenResult) && errs.length === 0 && (!ours || chips > 0);
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
