/**
 * Gate: the site works when SERVED, not just when opened from disk.
 *
 * Every other harness here loads dist/index.html over file://, where the router
 * falls back to hash routing. The site people actually read is served, where the
 * History API is in charge and `#` is reserved for in-page anchors. A link that
 * works in one mode and silently does nothing in the other is invisible to every
 * file:// gate — which is how a fragment link written as `href="#/repl/..."`
 * shipped, and how the anchor-scroll bug survived two rounds of reasoning.
 *
 * This serves dist/ over http and drives real navigation: route links, in-page
 * anchors, and a deep link straight to an anchor.
 */
import { resolve } from 'node:path';
import { chromium } from './browser.mts';
import { serveStatic } from './static-server.mts';

// Production uses clean URLs and real 404s; a SPA fallback hides missing route files.
const root = resolve(import.meta.dirname, '../dist-served');
const server = await serveStatic(root);
const base = server.url;

let bad = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', (e: Error) => {
  bad++;
  console.log(`  FAIL pageerror: ${e.message}`);
});

console.log('\nroutes resolve under the History API — cold loads, two-segment routes included');
// /repl/queries and /lib/zustand are here because they were blank on the live
// site: a relative asset path resolved against the route, the SPA rewrite
// served index.html for it, and the browser refused HTML as a module script.
// Only a COLD load of a two-segment route shows it; navigating there from an
// already-loaded page never does.
for (const route of [
  '/api',
  '/adapters',
  '/concepts/practical',
  '/query-research',
  '/selectors-vs-datalog',
  '/diagrams',
  '/',
  '/concepts',
  '/compare',
  '/cli',
  '/repl/snippet',
  '/repl/cancellation',
  '/repl/queries',
  '/lib/zustand',
  '/spec',
]) {
  const response = await p.goto(base + route);
  check(`${route} returns 200`, response?.status() === 200);
  await p.waitForTimeout(400);
  const text = (await p.evaluate(() => document.body.innerText)).trim();
  check(`${route} renders`, text.length > 200, `${text.length} chars`);
}

console.log('\na route link inside a static content fragment navigates');
{
  await p.goto(`${base}/concepts`);
  await p.waitForTimeout(500);
  const link = await p.$('#structured-concurrency a[href*="repl"]');
  check('the link exists', !!link);
  if (link) {
    const raw = await link.getAttribute('href');
    check('it is a real route, not a hash fragment', raw === '/repl/cancellation', String(raw));
    await link.click();
    await p.waitForTimeout(600);
    const url = p.url();
    check('clicking it lands on the REPL', url.endsWith('/repl/cancellation'), url);
    // Assert on the editor's contents rather than a heading: what the link
    // promises is that example's code, and a heading is free to be reworded.
    const code = await p.$eval('.source-editor .cm-content', (e: Element) => e.textContent ?? '').catch(() => '');
    check(
      'and the REPL loaded that example into the editor',
      code.includes("createScope('route:/products')"),
      code.slice(0, 80),
    );
  }
}

console.log('\na deep link to an in-page anchor scrolls to it');
{
  await p.goto(`${base}/requirements#R25`);
  await p.waitForTimeout(900);
  const y = await p.evaluate(() => {
    const el = document.getElementById('R25');
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });
  check('#R25 exists on the served page', y !== null);
  check('and the page scrolled to it', y !== null && Math.abs(y) < 200, `top = ${y}px`);
}

await b.close();
await server.close();
console.log(bad ? `\n${bad} check(s) failed under a real server` : '\nserved mode is clean');
process.exit(bad ? 1 : 0);
