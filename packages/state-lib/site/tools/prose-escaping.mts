/**
 * Gate: prose is text, not markup (R54).
 *
 * `<T>` runs its children through the reference pass and injects the result
 * with dangerouslySetInnerHTML, which is what makes tooltips possible. It also
 * meant a sentence mentioning `<input bind={s.query}/>` rendered a live text
 * field in the middle of a Compare panel — angle brackets in prose became
 * markup, silently, wherever an author happened to write one. Reported by a
 * reader, not by a test, which is why there is now a test.
 *
 * Driven through the built page because the escaping runs in the browser: the
 * reference pass parses with DOMParser and there is no DOM in node.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');

let bad = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else {
    bad++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\nthe contract, in the source');
{
  const t = readFileSync(resolve(here, '../src/lib/T.tsx'), 'utf8');
  check(
    'T uses the escaping entry point',
    t.includes('linkifyText('),
    'T must not call linkifyCell — that one takes HTML',
  );
}

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });

console.log('\nno prose renders a live control');
for (const r of [
  '/',
  '/init',
  '/compare',
  '/concepts',
  '/effects',
  '/landscape',
  '/cli',
  '/bench',
  '/devtools',
  '/repl',
]) {
  await p.goto(`file://${dist}#${r}`);
  await p.waitForTimeout(400);
  // Fields, not buttons: a <button> inside a paragraph is something an author
  // legitimately wrote (the Bench page's "Run every suite"), whereas a text
  // field appearing in prose is always an escaped-markup accident.
  const n = await p.evaluate(
    () =>
      document.querySelectorAll('p input, p textarea, p select, .lead input, td input, .cmp-detail-in input').length,
  );
  check(`${r} has no control inside prose`, n === 0, `${n} found`);
}

console.log('\nthe reported case, specifically');
{
  await p.goto(`file://${dist}#/compare`);
  await p.waitForTimeout(400);
  const row = await p.$('#cmp-binding');
  if (!row) {
    bad++;
    console.log('  FAIL the binding row is gone — update this harness');
  } else {
    await row.hover();
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => {
      const panel = document.querySelector('.cmp-detail-in');
      return { inputs: panel?.querySelectorAll('input').length ?? -1, text: panel?.textContent ?? '' };
    });
    check('the panel renders no input element', m.inputs === 0, String(m.inputs));
    check('and shows the tag as text', m.text.includes('<input bind='), m.text.slice(0, 120));
  }
}

await b.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nprose stays prose');
process.exit(bad ? 1 : 0);
