/**
 * Gate: no page scrolls sideways on a phone, and dark mode is really dark.
 *
 * This exists because the site was broken on four routes for weeks and nothing
 * noticed: every other harness runs at desktop width, and horizontal overflow
 * is invisible there. /landscape overflowed by a thousand pixels.
 *
 * The cause is always the same and worth stating once: a grid or flex child
 * defaults to `min-width: auto`, so it refuses to be narrower than its widest
 * descendant — a table, a diagram, a code editor — and pushes the document out
 * with it. The fix is `min-width: 0` on the child plus `overflow-x: auto` on
 * whatever is legitimately wide, never a media query that hides the content.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');

const ROUTES = [
  '/',
  '/init',
  '/concepts',
  '/landscape',
  '/compare',
  '/repl',
  '/bench',
  '/cli',
  '/effects',
  '/devtools',
  '/dive-data',
  '/dive-stores',
  '/requirements',
  '/decisions',
  '/spec',
  '/brief',
  '/lib/zustand',
];

let bad = 0;
const b = await chromium.launch();

for (const [label, width] of [
  ['phone', 390],
  ['tablet', 768],
  ['desktop', 1440],
] as const) {
  console.log(`\n${label} — ${width}px`);
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  for (const r of ROUTES) {
    const p = await ctx.newPage();
    const errs: string[] = [];
    p.on('pageerror', (e: Error) => errs.push(e.message));
    await p.goto(`file://${dist}#${r}`);
    await p.waitForTimeout(400);
    const m = await p.evaluate(() => {
      const de = document.documentElement;
      const w = de.clientWidth;
      const wide: string[] = [];
      document.querySelectorAll<HTMLElement>('*').forEach((e) => {
        if (e.getBoundingClientRect().width <= w + 4 || wide.length >= 3) return;
        // Report the outermost offender only: its children being wide is a symptom.
        let a = e.parentElement;
        while (a) {
          if (a.getBoundingClientRect().width > w + 4) return;
          a = a.parentElement;
        }
        wide.push(
          e.tagName.toLowerCase() +
            (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''),
        );
      });
      return { over: de.scrollWidth - de.clientWidth, wide };
    });
    const ok = m.over <= 2 && errs.length === 0;
    if (!ok) {
      bad++;
      console.log(
        `  FAIL ${r} — scrolls ${m.over}px sideways  ${m.wide.join(' ')}${errs.length ? ` | ${errs.join(' | ')}` : ''}`,
      );
    } else console.log(`  ok   ${r}`);
    await p.close();
  }
  await ctx.close();
}

console.log('\nthe header: a phone is a phone, a narrow desktop window is not');
{
  // Which header a reader gets is a DEVICE question, not a width one. A fine
  // pointer at any width gets the logo plus one scrolling row — no burger; a
  // coarse pointer with no hover gets the logo, a burger and the list behind it.
  // The old check asserted a burger at 390px by width, which is exactly the
  // half-screen-desktop-is-not-a-phone mistake this replaces.
  const fineNarrow = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await fineNarrow.newPage();
  await p.goto(`file://${dist}#/compare`);
  await p.waitForTimeout(500);
  const d = await p.evaluate(() => {
    const strip = document.querySelector('.navstrip') as HTMLElement;
    const first = strip.firstElementChild as HTMLElement,
      last = strip.lastElementChild as HTMLElement;
    const sr = strip.getBoundingClientRect();
    const scrolls = strip.scrollWidth > strip.clientWidth + 2;
    strip.scrollLeft = 0;
    const firstWhole = first.getBoundingClientRect().left >= sr.left - 1;
    strip.scrollLeft = strip.scrollWidth;
    const lastWhole = last.getBoundingClientRect().right <= sr.right + 1;
    strip.scrollLeft = 0;
    return {
      h: Math.round((document.querySelector('nav.top') as HTMLElement).getBoundingClientRect().height),
      toggleShown: getComputedStyle(document.querySelector('.nav-menu-search')!).display !== 'none',
      stripShown: getComputedStyle(strip).display !== 'none',
      scrolls,
      firstWhole,
      lastWhole,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const okA = d.h <= 64 && d.toggleShown && d.stripShown && d.pageOverflow === 0;
  if (!okA) bad++;
  console.log(
    `  ${okA ? 'ok  ' : 'FAIL'} fine pointer @1280: desktop strip plus shared menu, ${d.h}px tall, page overflow ${d.pageOverflow}px (row scrolls: ${d.scrolls})`,
  );
  const okB = !d.scrolls || (d.firstWhole && d.lastWhole);
  if (!okB) bad++;
  console.log(`  ${okB ? 'ok  ' : 'FAIL'} the first item is whole at the left end and the last at the right end`);
  // dragging with the mouse scrolls the row, and a drag that moved is not a click
  const hrefBefore = await p.evaluate(() => location.hash);
  const sr = await p.$eval('.navstrip', (e: Element) => {
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 };
  });
  await p.mouse.move(sr.x, sr.y);
  await p.mouse.down();
  await p.mouse.move(sr.x - 120, sr.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const afterDrag = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const hrefAfter = await p.evaluate(() => location.hash);
  const okC = !d.scrolls || (afterDrag > 0 && hrefAfter === hrefBefore);
  if (!okC) bad++;
  console.log(
    `  ${okC ? 'ok  ' : 'FAIL'} a mouse drag scrolls the row (scrollLeft → ${afterDrag}) and does not navigate`,
  );
  // Cursor position alone scrolls it, but ENTRY-RELATIVE: wherever the cursor
  // enters becomes the zero point (no jump), and only further movement from
  // there approaches an edge. Leave the strip first so the drag above is
  // fully over (a drag taints that hover session against snap-back, but this
  // is a fresh one), then re-measure.
  await p.mouse.move(5, 600);
  await p.waitForTimeout(120);
  const rr = await p.$eval('.navstrip', (e: Element) => {
    const r = e.getBoundingClientRect();
    return {
      l: r.left,
      r: r.right,
      y: r.top + r.height / 2,
      max: (e as HTMLElement).scrollWidth - (e as HTMLElement).clientWidth,
    };
  });
  const w = rr.r - rr.l;
  const before = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  // Enter with room to the right edge (not deep in the inset, where the
  // runway floor deliberately caps how close to max a short entry-to-edge
  // hop can reach): this must NOT jump — scrollLeft stays at `before`.
  await p.mouse.move(rr.r - w * 0.3, rr.y);
  await p.waitForTimeout(80);
  const atEntryR = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const okD1 = !d.scrolls || Math.abs(atEntryR - before) <= 2;
  if (!okD1) bad++;
  console.log(
    `  ${okD1 ? 'ok  ' : 'FAIL'} entering with room to the right edge does not jump (scrollLeft ${atEntryR}, was ${before})`,
  );
  // Moving the rest of the way to that edge from the entry point approaches max.
  await p.mouse.move(rr.r - 2, rr.y);
  await p.waitForTimeout(560);
  const atRight = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const okD2 = !d.scrolls || Math.abs(atRight - rr.max) <= 2;
  if (!okD2) bad++;
  console.log(
    `  ${okD2 ? 'ok  ' : 'FAIL'} moving further right from the entry point approaches the end (${atRight}/${rr.max})`,
  );
  // New contract: a 420ms grace period permits accidental re-entry, then
  // the hover-only session returns to the start (not its old baseline).
  await p.mouse.move(5, 600);
  await p.waitForTimeout(250);
  const duringGrace = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const graceOK = !d.scrolls || Math.abs(duringGrace - atRight) <= 2;
  if (!graceOK) bad++;
  console.log(`  ${graceOK ? 'ok  ' : 'FAIL'} accidental leave has a grace period before reset`);
  await p.waitForTimeout(750);
  const afterLeaveR = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const okD3 = !d.scrolls || Math.abs(afterLeaveR) <= 2;
  if (!okD3) bad++;
  console.log(
    `  ${okD3 ? 'ok  ' : 'FAIL'} leaving after a hover-only session returns to the start after the grace period (got ${afterLeaveR})`,
  );
  // Self-contained: re-drive the strip to max and back out, but this time
  // re-enter WHILE the snap-back animation is still running. That must
  // CANCEL the old tween and re-baseline from wherever it had gotten to —
  // not let the old animation keep running underneath the new hover session
  // and drag the strip back to `before` regardless of what the new session
  // does. Force-reset scrollLeft afterward (bypassing the component) so this
  // sub-test cannot leak a different baseline into what follows.
  if (d.scrolls) {
    await p.mouse.move(rr.r - w * 0.3, rr.y);
    await p.waitForTimeout(80);
    await p.mouse.move(rr.r - 2, rr.y);
    await p.waitForTimeout(560);
    await p.mouse.move(5, 600);
    // Sample almost immediately: if headless Chromium renders the smooth
    // scroll instantly (it sometimes does), there is nothing mid-flight to
    // catch, and the cancel-vs-drift check is skipped rather than flaking.
    const justLeft = await p.evaluate(
      () =>
        new Promise<number>((r) =>
          setTimeout(() => r((document.querySelector('.navstrip') as HTMLElement).scrollLeft), 15),
        ),
    );
    if (Math.abs(justLeft - before) <= 2) {
      console.log('  skip  smooth snap-back already settled before it could be sampled mid-flight (headless quirk)');
    } else {
      await p.mouse.move(rr.r - w * 0.3, rr.y);
      await p.waitForTimeout(30);
      const atReentry = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
      await p.waitForTimeout(700); // well past when the original animation would have finished
      const stillThere = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
      const okCancel = Math.abs(stillThere - atReentry) <= 4;
      if (!okCancel) bad++;
      console.log(
        `  ${okCancel ? 'ok  ' : 'FAIL'} re-entering mid-animation cancels the snap-back (stayed near ${atReentry}, got ${stillThere})`,
      );
    }
    await p.mouse.move(5, 600);
    await p.waitForTimeout(50);
    await p.evaluate((v: number) => {
      (document.querySelector('.navstrip') as HTMLElement).scrollLeft = v;
    }, before);
  }
  // Same story on the other side: enter with room to the left edge, no jump,
  // then moving the rest of the way there approaches zero.
  await p.mouse.move(rr.l + w * 0.3, rr.y);
  await p.waitForTimeout(80);
  const atEntryL = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const okD4 = !d.scrolls || Math.abs(atEntryL - before) <= 2;
  if (!okD4) bad++;
  console.log(
    `  ${okD4 ? 'ok  ' : 'FAIL'} entering with room to the left edge does not jump (scrollLeft ${atEntryL}, was ${before})`,
  );
  await p.mouse.move(rr.l + 2, rr.y);
  await p.waitForTimeout(560);
  const atLeft = await p.evaluate(() => (document.querySelector('.navstrip') as HTMLElement).scrollLeft);
  const okD5 = !d.scrolls || atLeft <= 2;
  if (!okD5) bad++;
  console.log(`  ${okD5 ? 'ok  ' : 'FAIL'} moving further left from the entry point approaches the start (${atLeft})`);
  // Leave again to settle before the next section reuses this page.
  await p.mouse.move(5, 600);
  await p.waitForTimeout(600);
  await fineNarrow.close();

  // A phone: coarse pointer, no hover.
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const q = await phone.newPage();
  await q.emulateMedia({ media: 'screen' });
  await q.goto(`file://${dist}#/compare`);
  await q.waitForTimeout(500);
  const m = await q.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse) and (hover: none)').matches,
    toggleShown: getComputedStyle(document.querySelector('.nav-menu-search')!).display !== 'none',
    stripShown: getComputedStyle(document.querySelector('.navstrip')!).display !== 'none',
    h: Math.round((document.querySelector('nav.top') as HTMLElement).getBoundingClientRect().height),
  }));
  const okE = m.coarse && m.toggleShown && !m.stripShown && m.h <= 64;
  if (!okE) bad++;
  console.log(
    `  ${okE ? 'ok  ' : 'FAIL'} phone (coarse pointer): burger shown, row hidden, ${m.h}px tall (media matched: ${m.coarse})`,
  );
  await q.tap('.nav-menu-search');
  await q.waitForTimeout(150);
  const opened = await q.evaluate(() => Boolean(document.querySelector('.navigation-dialog[open]')));
  await q.tap('.navigation-dialog a[href*="bench"]');
  await q.waitForTimeout(400);
  const landed = (await q.evaluate(() => location.hash)).includes('/bench');
  const closed = await q.evaluate(() => !document.querySelector('.navigation-dialog[open]'));
  const okF = opened && landed && closed;
  if (!okF) bad++;
  console.log(
    `  ${okF ? 'ok  ' : 'FAIL'} the burger opens the list, a tap navigates, and the list closes (opened=${opened} landed=${landed} closed=${closed})`,
  );
  await phone.close();
}

console.log('\ndark mode');
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(`file://${dist}#/`);
  await p.waitForTimeout(400);
  // No helper functions inside evaluate: tsx's transform names inner arrows via
  // an `__name` shim that does not exist in the page, and the call throws.
  const raw = await p.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
  const luminance = (s: string) => {
    const c = (s.match(/\d+/g) ?? ['255', '255', '255']).slice(0, 3).map(Number);
    return (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255;
  };
  const lum = { bg: luminance(raw.bg), fg: luminance(raw.fg) };
  const ok = lum.bg < 0.25 && lum.fg > 0.6;
  if (!ok) bad++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} the page is dark and the text is light — bg ${lum.bg.toFixed(2)}, text ${lum.fg.toFixed(2)}`,
  );
  await ctx.close();
}

await b.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nevery route fits every viewport, and dark mode is dark');
process.exit(bad ? 1 : 0);
