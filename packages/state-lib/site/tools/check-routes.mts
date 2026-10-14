/** Load every route from the built bundle and fail on a console error or a pageerror. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');
const routes = [
  '/api',
  '/adapters',
  '/concepts/practical',
  '/query-research',
  '/selectors-vs-datalog',
  '/',
  '/init',
  '/concepts',
  '/landscape',
  '/compare',
  '/playground',
  '/bench',
  '/cli',
  '/devtools',
  '/dive-data',
  '/dive-stores',
  '/requirements',
  '/decisions',
  '/spec',
  '/brief',
  '/repl',
  '/repl/derived',
  '/repl/optimistic',
  '/lib',
  '/lib/zustand',
  '/lib/rtk',
  '/lib/jotai',
  '/lib/valtio',
  '/lib/mobx',
  '/lib/legend',
  '/lib/xstate',
];
const b = await chromium.launch();
let bad = 0;
for (const r of routes) {
  const p = await b.newPage();
  const errs: string[] = [];
  p.on('pageerror', (e: Error) => errs.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });
  await p.goto(`file://${dist}#${r}`);
  await p.waitForTimeout(350);
  const text = (await p.evaluate(() => document.body.innerText)).trim();
  if (text.length < 120) errs.push(`suspiciously empty (${text.length} chars)`);
  if (errs.length) {
    bad++;
    console.log(`FAIL ${r}\n   ${errs.join('\n   ')}`);
  } else console.log(`ok   ${r}  (${text.length} chars)`);
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} route(s) failed` : `\nall ${routes.length} routes clean`);
process.exit(bad ? 1 : 0);
