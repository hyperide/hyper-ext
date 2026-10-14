/** The cross-reference system's two halves, asserted end to end (R54).
 *
 *  Half one: a marker is a link where it is USED and plain text where it is DEFINED. The line
 *  that defines R25 used to render R25 as a link to itself. Every previous change to linkify
 *  shipped a bug that source review did not catch, so this loads the built bundle and reads
 *  the rendered DOM rather than reasoning about the tokenizer.
 *
 *  Half two: the backlink chip at a definition walks the reader through the actual use sites —
 *  it navigates to one, marks it, and steps to the next. The chip used to link to the route,
 *  which is how "where is R25 used" became "search a quarter-megabyte document by eye".
 *
 *  Run: tsx tools/reference-tour.mts
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './browser.mts';

/** Playwright arrives through `require`, so its callbacks are untyped here. This is the part of
 *  a console message the harness reads — enough for the repo typecheck, without an `any`. */
type ConsoleMessage = { type: () => string; text: () => string };
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist/index.html');
// The screenshot directory is git-ignored, so on a fresh clone it does not exist and the first
// `page.screenshot` throws ENOENT — after most checks have run, taking the summary line and the
// exit code with it. Losing the verdict of the harness the whole change leans on is worse than
// any bug it would have reported.
mkdirSync(join(here, '.figures'), { recursive: true });

let bad = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Every page this harness opens must fail the run on a thrown error or a console error. Said
 *  once: the reduced-motion page was opened later and silently watched only half of that. */
type WatchablePage = {
  on(event: 'pageerror', cb: (e: Error) => void): void;
  on(event: 'console', cb: (m: ConsoleMessage) => void): void;
};
const watchPage = (p: WatchablePage) => {
  p.on('pageerror', (e: Error) => {
    console.error('  PAGEERROR', e.message);
    bad++;
  });
  p.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') {
      console.error('  CONSOLE', m.text());
      bad++;
    }
  });
};

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
watchPage(page);

/** Wait for the control to report a settled count rather than sleeping a fixed time — the
 *  settle budget is 2500ms and a cold load of the quarter-megabyte spec can use most of it, so
 *  a 2200ms sleep races the very thing it is meant to observe. Resolves either way; the
 *  assertion that follows is what reports the failure. */
const waitForSettled = (want = '^use \\d+ of \\d+$') =>
  page
    .waitForFunction(
      (w: string) => new RegExp(w).test(document.querySelector('.usetour .ut-count')?.textContent ?? ''),
      want,
      { timeout: 9000 },
    )
    .catch(() => {});

/** The control's state as the reader sees it: which document, which use, and what is marked. */
const tourState = () =>
  page.evaluate(() => {
    const bar = document.querySelector('.usetour');
    const now = document.querySelector('a.gr.usenow') as HTMLElement | null;
    const rect = now?.getBoundingClientRect();
    return {
      open: !!bar,
      id: bar?.querySelector('.ut-id')?.textContent ?? '',
      where: bar?.querySelector('.ut-where')?.textContent ?? '',
      count: bar?.querySelector('.ut-count')?.textContent ?? '',
      doc: bar?.querySelector('.ut-doc.on')?.textContent ?? '',
      markedText: now?.textContent ?? null,
      markedTop: rect ? Math.round(rect.top) : null,
      // Every step scrolls its target to the same reading line, so the viewport position is
      // identical each time — the position in the DOCUMENT is what tells them apart.
      markedY: rect ? Math.round(rect.top + window.scrollY) : null,
      inViewport: !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight,
      route: location.hash,
    };
  });

// ---- definitions are not links -------------------------------------------------------------
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(900);

const defs = await page.evaluate(() => {
  const marks = Array.from(document.querySelectorAll('span.ref-def'));
  // The contract, not a magic number: injectAnchors creates one anchor per definition bullet,
  // and markDefinitions must mark exactly those. Requirements.md is designed to grow, so a
  // hard-coded total would fail the day R83 lands while nothing is actually broken — and, worse,
  // would not notice the failure that matters (the two passes disagreeing about what a
  // definition is, which silently restores every self-link this change removes).
  const anchors = Array.from(document.querySelectorAll('span.anchor[id]'))
    .map((a) => a.id)
    .filter((id) => /^(R\d+|F\d+)$/.test(id));
  const markedIds = marks.map((m) => (m.textContent ?? '').replace(/\.$/, ''));
  // Counting marks is not enough: a mark on the WRONG bullet keeps the count at one per id and
  // passes every other check here, while the real definition is left to be linked to itself.
  // A definition mark must sit after its OWN anchor and before the next one, so walking the
  // document and pairing each mark with the anchor most recently seen is the real contract.
  const misplaced: string[] = [];
  {
    const both = Array.from(document.querySelectorAll('span.anchor[id], span.ref-def'));
    let lastAnchor = '';
    for (const el of both) {
      if (el.classList.contains('anchor')) lastAnchor = el.id;
      else {
        const id = (el.textContent ?? '').replace(/\.$/, '');
        if (id !== lastAnchor) misplaced.push(`${id} after anchor ${lastAnchor || '(none)'}`);
      }
    }
  }
  return {
    total: marks.length,
    anchors: anchors.length,
    misplaced: misplaced.slice(0, 5),
    unmarked: anchors.filter((id) => !markedIds.includes(id)).slice(0, 5),
    linked: marks.filter((m) => m.closest('a')).map((m) => m.textContent ?? ''),
    inStrong: marks.filter((m) => m.closest('strong')).length,
    r25Anchor: !!document.getElementById('R25'),
    // a use of some OTHER id, on this same page, must still be a link
    usesHere: Array.from(document.querySelectorAll('a.gr')).filter((a) => (a.textContent ?? '').trim() === 'R25')
      .length,
    // the chips are chrome: linkify must not have turned any of their text into a link
    chipAnchors: Array.from(document.querySelectorAll('.backlinks a')).length,
  };
});
check(
  'every id that got an anchor also got a definition mark',
  defs.anchors > 50 && defs.total === defs.anchors && defs.unmarked.length === 0,
  `${defs.total} marks / ${defs.anchors} anchors${defs.unmarked.length ? ` — unmarked: ${defs.unmarked.join(', ')}` : ''}`,
);
check(
  'and each mark sits on the bullet its own anchor points at, not merely somewhere on the page',
  defs.misplaced.length === 0,
  defs.misplaced.length ? defs.misplaced.join('; ') : 'every mark follows its own anchor',
);
check(
  'a definition renders no self-link',
  defs.linked.length === 0,
  defs.linked.length ? defs.linked.slice(0, 5).join(', ') : 'none of them is inside an <a>',
);
check('the marked token is the bold id itself', defs.inStrong === defs.total, `${defs.inStrong} inside <strong>`);
check('the anchor a reference points at still exists', defs.r25Anchor, '#R25');
check('a use of R25 on the same page is still a link', defs.usesHere > 0, `${defs.usesHere} link(s)`);
check(
  'a backlink chip contains no link of its own',
  defs.chipAnchors === 0,
  `${defs.chipAnchors} <a> inside .backlinks`,
);

const specDefs = await (async () => {
  await page.goto(`file://${dist}#/spec`);
  await page.waitForTimeout(1600);
  return page.evaluate(() => {
    const marks = Array.from(document.querySelectorAll('span.ref-def'));
    return {
      total: marks.length,
      linked: marks.filter((m) => m.closest('a')).length,
      inHeading: marks.filter((m) => m.closest('h2, h3, h4')).length,
      rUses: Array.from(document.querySelectorAll('a.gr')).filter((a) => (a.textContent ?? '').trim() === 'R25').length,
      sUses: Array.from(document.querySelectorAll('a.gs')).length,
    };
  });
})();
check('spec section numbers are marked at their heading', specDefs.total > 100, `${specDefs.total} headings`);
check('a spec heading number is never a link', specDefs.linked === 0);
check(
  'the mark sits in the heading, not the prose',
  specDefs.inHeading === specDefs.total,
  `${specDefs.inHeading}/${specDefs.total}`,
);
check(
  'references in the spec are still links',
  specDefs.rUses > 0 && specDefs.sUses > 0,
  `${specDefs.rUses} R25 link(s), ${specDefs.sUses} section link(s)`,
);

// The R/F pattern is deliberately wide (`F\d{1,3}`, so an `F10` is not read as `F1`). Widening
// it may not invent links: a token that looks like an id but names no requirement — "press F12",
// "the F14" — must stay plain text. Every R/F link on every page is checked against the set of
// ids that actually exist, so a widening that started linking prose fails here.
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(1200);
const realIds: string[] = await page.evaluate(() => {
  // the anchors only exist on /requirements — that page IS the id registry
  return Array.from(document.querySelectorAll('span.anchor[id]'))
    .map((a) => a.id)
    .filter((id) => /^(R\d+|F\d+)$/.test(id));
});
const invented: string[] = [];
for (const route of ['/requirements', '/spec', '/brief', '/decisions', '/landscape', '/concepts']) {
  await page.goto(`file://${dist}#${route}`);
  await page.waitForTimeout(1500);
  const inventedHere: string[] = await page.evaluate((known: string[]) => {
    const set = new Set(known);
    return Array.from(document.querySelectorAll('a.gr'))
      .map((a) => (a.textContent ?? '').trim())
      .filter((t) => /^(R\d+|F\d+)$/.test(t) && !set.has(t));
  }, realIds);
  invented.push(...inventedHere.map((t) => `${route}:${t}`));
}
check(
  'no R/F link points at an id that does not exist',
  invented.length === 0,
  `${realIds.length} real ids${invented.length ? `, invented: ${invented.slice(0, 6).join(', ')}` : ''}`,
);
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(1000);

// ---- the tour walks the use sites -----------------------------------------------------------
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(900);

const chips = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button.backlink-chip[data-ref-id="R25"]')).map((b) =>
    b.getAttribute('data-doc'),
  ),
);
check('R25 carries a chip per document that references it', chips.length >= 2, chips.join(', '));

await page.click('button.backlink-chip[data-ref-id="R25"][data-doc="requirements"]');
await page.waitForTimeout(1200);
const first = await tourState();
const n = Number(/of (\d+)/.exec(first.count)?.[1] ?? 0);
check('the chip opens the tour', first.open, JSON.stringify(first.count));
check('it stands on the first use, of a measured total', /^use 1 of \d+$/.test(first.count) && n >= 1, first.count);
check('the use it stands on is marked', first.markedText === 'R25', JSON.stringify(first.markedText));
check('and is on screen', first.inViewport, `top=${first.markedTop}`);
await page.screenshot({ path: join(here, '.figures/reference-tour.png') });
check(
  'the control names the document',
  first.where.includes('requirements') && first.doc === 'requirements',
  `${JSON.stringify(first.where)} / ${first.doc}`,
);

if (n >= 2) {
  await page.click('.usetour .ut-next');
  await page.waitForTimeout(900);
  const second = await tourState();
  check('the next button steps to the next use', second.count === `use 2 of ${n}`, second.count);
  check(
    'and moves the mark to a different place in the document',
    second.markedY !== first.markedY,
    `y ${first.markedY} → ${second.markedY}`,
  );
  check('which is on screen too', second.inViewport, `top=${second.markedTop}`);

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(900);
  const back = await tourState();
  check('the left arrow steps back', back.count === `use 1 of ${n}`, back.count);
} else {
  check('R25 has more than one use in the requirements to step through', false, `only ${n}`);
}

// Pointing an already-open tour at another id by clicking a second chip. The browser focuses
// that chip on mousedown, which is outside the control — so this is the case where the arrow
// keys silently stopped working and the reader had to click the bar to get them back.
// It has to be an id with at least two uses here, or there is nothing for the arrow to step to
// and the assertion would pass without exercising anything.
const other = await page.evaluate(() => {
  const linkText = Array.from(document.querySelectorAll('a.gr')).map((a) => (a.textContent || '').trim());
  const here = document.querySelectorAll('button.backlink-chip[data-doc="requirements"]');
  const b = Array.from(here).find((x) => {
    const id = x.getAttribute('data-ref-id') ?? '';
    return id !== 'R25' && linkText.filter((t) => t === id).length >= 2;
  });
  return b?.getAttribute('data-ref-id') ?? '';
});
if (other) {
  await page.click(`button.backlink-chip[data-ref-id="${other}"][data-doc="requirements"]`);
  await waitForSettled();
  const opened = await tourState();
  const total = Number(/of (\d+)/.exec(opened.count)?.[1] ?? 0);
  check(`a second chip re-points the open tour at ${other}`, opened.id === other, `${opened.id} / ${opened.count}`);
  await page.keyboard.press('ArrowRight');
  await waitForSettled();
  const stepped = await tourState();
  check(
    'and the arrow keys still drive it after that click',
    total >= 2 && stepped.count === `use 2 of ${total}`,
    `${opened.count} → ${stepped.count}`,
  );
  // Back to R25 for the document-switching legs below.
  await page.click('button.backlink-chip[data-ref-id="R25"][data-doc="requirements"]');
  await waitForSettled();
} else {
  check('a second requirements chip exists to re-point the tour with', false, 'none found');
}

// switching document navigates and re-measures there
await page.evaluate(() => {
  const docs = Array.from(document.querySelectorAll('.usetour .ut-doc')) as HTMLElement[];
  docs.find((d) => d.textContent === 'spec')?.click();
});
await waitForSettled();
await page.waitForTimeout(300);
const onSpec = await tourState();
check('choosing another document goes there', onSpec.route.includes('/spec'), onSpec.route);
check(
  'and counts that document for itself',
  /^use 1 of \d+$/.test(onSpec.count),
  `${onSpec.count} in ${JSON.stringify(onSpec.where)}`,
);
check('with the use marked and on screen', onSpec.markedText === 'R25' && onSpec.inViewport, `top=${onSpec.markedTop}`);

await page.screenshot({ path: join(here, '.figures/reference-tour-spec.png') });

// Stepping BACK off the first use of a document lands on the LAST use of the previous one —
// the count there is unknown at the moment the step is taken, so this exercises the sentinel
// that says "whichever turns out to be last" and the normalisation that resolves it.
await page.keyboard.press('ArrowLeft');
await waitForSettled();
await page.waitForTimeout(300);
const backAcross = await tourState();
check(
  'stepping back across a document boundary goes to the previous document',
  backAcross.route.includes('/requirements'),
  backAcross.route,
);
check('and lands on its LAST use, not its first', backAcross.count === `use ${n} of ${n}`, backAcross.count);
check(
  'with that use marked and on screen',
  backAcross.markedText === 'R25' && backAcross.inViewport,
  `top=${backAcross.markedTop}`,
);

await page.click('.usetour .ut-close');
await page.waitForTimeout(400);
const closed = await tourState();
check('closing removes the control and every mark', !closed.open && closed.markedText === null);

// A use inside a collapsed <details> has no box to scroll to. The landscape page keeps its
// per-layer notes in one, so this leg is the one that would silently land nowhere — the tour
// opens the disclosure of the use it stands on.
await page.click('button.backlink-chip[data-ref-id="R16"][data-doc="landscape"]');
await waitForSettled();
await page.waitForTimeout(300);
const onLandscape = await tourState();
check('a chip can walk into the landscape too', onLandscape.route.includes('/landscape'), onLandscape.route);
check('with a measured count there', /^use 1 of \d+$/.test(onLandscape.count), onLandscape.count);
check(
  'and the use it stands on is rendered, not hidden in a closed disclosure',
  onLandscape.markedText === 'R16' && onLandscape.inViewport,
  `top=${onLandscape.markedTop}`,
);

// Leaving the document the tour is in ends it rather than leaving a control pointing nowhere.
// The tour must actually be OPEN first: the chips only exist on /requirements, so this opens
// one there and then leaves, rather than clicking a selector that cannot match.
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(1200);
await page.click('button.backlink-chip[data-ref-id="R25"][data-doc="requirements"]');
await page.waitForTimeout(1400);
const beforeLeaving = await tourState();
check('a tour is open before the leave test (otherwise it proves nothing)', beforeLeaving.open, beforeLeaving.count);
await page.evaluate(() => {
  location.hash = '#/brief';
});
await page.waitForTimeout(1400);
const away = await tourState();
check('navigating away ends the tour', !away.open && away.markedText === null);

// A chip must never lead somewhere with nothing to step to. The chips are decided by counting
// the markdown source; the tour can only walk RENDERED links. Three reviewers independently
// flagged that those two can disagree (a mention inside a code fence is never a link), so this
// asserts the agreement across every document and every id that carries a chip.
await page.goto(`file://${dist}#/requirements`);
await page.waitForTimeout(1200);
const chipsByDoc: Record<string, string[]> = await page.evaluate(() => {
  const m: Record<string, string[]> = {};
  for (const b of Array.from(document.querySelectorAll('button.backlink-chip'))) {
    const doc = b.getAttribute('data-doc') ?? '';
    (m[doc] ||= []).push(b.getAttribute('data-ref-id') ?? '');
  }
  return m;
});
for (const [docName, route] of [
  ['requirements', '/requirements'],
  ['spec', '/spec'],
  ['brief', '/brief'],
  ['decisions', '/decisions'],
  ['landscape', '/landscape'],
] as const) {
  const offered = chipsByDoc[docName] ?? [];
  if (!offered.length) continue;
  await page.goto(`file://${dist}#${route}`);
  await page.waitForTimeout(1800);
  const missing: string[] = await page.evaluate((ids: string[]) => {
    const rendered = new Set(Array.from(document.querySelectorAll('a.gr')).map((a) => (a.textContent ?? '').trim()));
    return ids.filter((id) => !rendered.has(id));
  }, offered);
  check(
    `every chip offering the ${docName} leads to a rendered use`,
    missing.length === 0,
    `${offered.length} chip(s)${missing.length ? `, dead: ${missing.slice(0, 6).join(', ')}` : ''}`,
  );
}

// Arriving on an anchored URL starts a settle loop that re-scrolls to that anchor for up to the
// budget. Clicking a chip on the same route does not change the route, so nothing else stops it —
// it used to yank the viewport back every 80ms while the tour held a use in the reading line. The
// tour must win. Nothing covered this: deleting the takeOverScroll() call that fixes it passed
// every other check in this file.
{
  const anchored = await b.newPage({ viewport: { width: 1400, height: 950 } });
  watchPage(anchored);
  await anchored.goto(`file://${dist}#/requirements#R60`);
  // Deliberately inside the settle budget, while the anchor loop is still re-scrolling.
  await anchored.waitForTimeout(300);
  await anchored.click('button.backlink-chip[data-ref-id="R25"][data-doc="requirements"]');
  await anchored.waitForFunction(
    () => /^use \d+ of \d+$/.test(document.querySelector('.ut-count')?.textContent ?? ''),
    {
      timeout: 8000,
    },
  );
  // Past the budget: if the anchor loop were still alive it has had every chance to win.
  await anchored.waitForTimeout(2600);
  const held = await anchored.evaluate(() => {
    const now = document.querySelector('a.gr.usenow') as HTMLElement | null;
    const r60 = document.getElementById('R60');
    return {
      marked: now?.textContent ?? null,
      offLine: now ? Math.abs(Math.round(now.getBoundingClientRect().top) - Math.round(window.innerHeight * 0.35)) : -1,
      r60Top: r60 ? Math.round(r60.getBoundingClientRect().top) : null,
    };
  });
  check(
    'a chip clicked during a cold anchor jump wins the viewport instead of being dragged back',
    held.marked === 'R25' && held.offLine >= 0 && held.offLine < 40,
    `standing on ${held.marked}, ${held.offLine}px off the reading line (anchor #R60 at ${held.r60Top})`,
  );
  await anchored.close();
}

// prefers-reduced-motion: window.scrollBy({behavior:'smooth'}) ignores the media query, so the
// downgrade to an instant step is enforced in JS and has to be checked there. A smooth scroll of
// the ~900px between R25's two uses is still mid-flight at 150ms; an instant one has landed.
const calm = await b.newPage({ viewport: { width: 1400, height: 950 }, reducedMotion: 'reduce' });
watchPage(calm);
await calm.goto(`file://${dist}#/requirements`);
await calm.waitForTimeout(1200);
await calm.click('button.backlink-chip[data-ref-id="R25"][data-doc="requirements"]');
await calm.waitForTimeout(1400);
await calm.click('.usetour .ut-next');
await calm.waitForTimeout(150);
const calmLanded = await calm.evaluate(() => {
  const el = document.querySelector('a.gr.usenow');
  if (!el) return null;
  return Math.round(el.getBoundingClientRect().top - window.innerHeight * 0.35);
});
check(
  'a step under prefers-reduced-motion lands at once instead of animating',
  calmLanded !== null && Math.abs(calmLanded) < 60,
  `off the reading line by ${calmLanded}px 150ms after the step`,
);
await calm.close();

await b.close();
console.log(bad ? `\n${bad} failure(s)` : '\ndefinitions are plain text, uses are links, and the tour walks them');
process.exit(bad ? 1 : 0);
