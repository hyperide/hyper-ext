/** The contents list must exist, track the heading being read, and scroll on click. */
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const b = await chromium.launch();
for (const route of ['/spec', '/requirements', '/brief']) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e: Error) => {
    console.error('  PAGEERROR', e.message);
    bad++;
  });
  await p.goto(`file://${dist}#${route}`);
  await p.waitForTimeout(700);

  const count = await p.$$eval('.toc a', (as: Element[]) => as.length);
  check(`${route}: contents rendered`, count > 5, `${count} entries`);

  const first = await p.$eval('.toc a.on', (a: Element) => a.textContent ?? '').catch(() => '');
  check(`${route}: something is marked current at the top`, first.length > 0, JSON.stringify(first));

  await p.evaluate(() => window.scrollTo({ top: 4000, behavior: 'instant' as ScrollBehavior }));
  await p.waitForTimeout(500);
  const after = await p.$eval('.toc a.on', (a: Element) => a.textContent ?? '').catch(() => '');
  check(
    `${route}: it follows the scroll`,
    after !== first && after.length > 0,
    `${JSON.stringify(first)} → ${JSON.stringify(after)}`,
  );

  // clicking an entry must move the page to that heading
  const targetText = await p.$$eval('.toc a', (as: Element[]) => as[as.length - 1]?.textContent ?? '');
  await p.$$eval('.toc a', (as: Element[]) => (as[as.length - 1] as HTMLElement).click());
  await p.waitForTimeout(900);
  const nowTop = await p.evaluate(() => window.scrollY);
  check(
    `${route}: clicking the last entry scrolls there`,
    nowTop > 4000,
    `y=${Math.round(nowTop)} → ${JSON.stringify(targetText.slice(0, 40))}`,
  );

  if (route === '/spec') await p.screenshot({ path: join(here, '.figures/page-toc.png') });
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} failure(s)` : '\ncontents list works on every document page');
process.exit(bad ? 1 : 0);
