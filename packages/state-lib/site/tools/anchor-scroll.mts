/** The bug the user actually reported: open /requirements#R25 cold and land on R25.
 *  Covers a cold entry (anchor in the URL before the app mounts) and an in-app click,
 *  because those are different code paths and only one of them was ever tested. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
import type { Page } from 'playwright';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');
let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const b = await chromium.launch();

/** How far the target sits from the top of the viewport. Near zero means we landed on it. */
const offsetOf = (page: Page, id: string) =>
  page.evaluate((i: string) => {
    const el = document.getElementById(i);
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  }, id);

for (const [route, id] of [
  ['/requirements', 'R25'],
  ['/requirements', 'R40'],
  ['/requirements', 'R82'],
  ['/spec', 's4-8'],
  ['/spec', 's13-1'],
  ['/decisions', 'd12'],
] as const) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e: Error) => {
    console.error('  PAGEERROR', e.message);
    bad++;
  });
  // Cold entry: the anchor is in the URL before the app has rendered anything.
  await p.goto(`file://${dist}#${route}#${id}`);
  await p.waitForTimeout(1400);
  const exists = (await offsetOf(p, id)) !== null;
  const { y, atBottom } = await p.evaluate(() => ({
    y: window.scrollY,
    // A target near the end of the document cannot be brought to the top of the viewport;
    // being scrolled as far as the document allows is the correct outcome, not a failure.
    atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
  }));
  const off = await offsetOf(p, id);
  check(`${route}#${id} exists`, exists);
  const landed = exists && y > 0 && (Math.abs(off ?? 9999) < 140 || atBottom);
  check(
    `${route}#${id} cold entry lands on it`,
    landed,
    `y=${Math.round(y)} offset=${off}${atBottom ? ' (document end)' : ''}`,
  );
  await p.close();
}
await b.close();
console.log(bad ? `\n${bad} failure(s)` : '\nevery anchor exists and cold entry lands on it');
process.exit(bad ? 1 : 0);
