import { useCallback, useEffect, useRef, useState } from 'react';
import { BACKLINK_CHIP, REF_LINK, referenceDocs, type RefDoc } from './linkify';
import { SETTLE_BUDGET_MS, currentRoute, navigate, scrollToElement, useRoute } from './router';

/** R54 — "where is R25 actually used?", answered by walking the uses.
 *
 *  A backlink chip at a definition used to link to the route, which put the reader at the top
 *  of a document and left them to find one of seven mentions by eye. Clicking a chip now opens
 *  this control, which stands on one use at a time: it scrolls to it, marks it, and steps to
 *  the next with a key or a click. When it runs out of uses in one document it moves to the
 *  next document the id appears in.
 *
 *  Targets are found in the rendered document rather than counted in the markdown, because
 *  those two numbers are not the same — a mention inside a code fence is never a link. The
 *  count in the control is therefore always the count of things the reader can actually be
 *  taken to.
 */

/** Must match the `usehit` keyframe duration in state.css (1.4s). The class is removed when
 *  the animation ends; a shorter timer truncates the flash, a longer one leaves it stuck. */
const HIT_MS = 1400;
const POLL_MS = 80;
/** Reference links sit in the middle of prose, and the control sits at the bottom of the
 *  viewport. A third of the way down puts the sentence in the reader's eye line with its
 *  surrounding paragraph visible, and clear of the control. */
const readingLine = () => Math.round(window.innerHeight * 0.35);

/** `useIndex` is an index into the uses found on the current document, except for the sentinel
 *  LAST_USE, which means "whichever turns out to be the last one" — the reader stepped backwards
 *  over a document boundary, before the count for the document they are arriving at is known. */
const LAST_USE = -1;
type Tour = { id: string; docs: RefDoc[]; docIndex: number; useIndex: number };

/** Every rendered reference to `id` on this page, in document order. The definition itself is
 *  not among them: it renders as plain text inside `.ref-def`, not as a link. A pure query —
 *  it must be, because it runs on every poll tick of a cold arrival. */
function usesOf(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(REF_LINK)).filter(
    (a) => (a.textContent || '').trim() === id,
  );
}

/** A use inside a collapsed `<details>` has no box to scroll to — the landscape page keeps its
 *  per-layer notes in one. Open the ancestors of the one use the tour is standing on, at the
 *  moment it stands on it. Deliberately not "open every match while counting": that would
 *  re-open a disclosure the reader had just closed, on every poll tick, for uses they never
 *  asked to see. */
function reveal(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement) p.open = true;
  }
}

function clearMarks() {
  for (const el of Array.from(document.querySelectorAll('.usenow, .usehit'))) {
    el.classList.remove('usenow', 'usehit');
  }
}

/** The arrow keys belong to the tour only while nothing else has claimed them. The control takes
 *  focus when it opens, so the normal case is the bar itself; a click on plain prose leaves the
 *  body focused, which is still the tour's. Anything else the reader has focused — a text field,
 *  a horizontally scrollable code block, the REPL — keeps its own arrow keys.
 *
 *  A backlink chip counts as the tour's own surface. Clicking one is how a tour is started or
 *  pointed at another id, and browsers focus a button on mousedown, so without this the reader
 *  would arrive at a use with the arrows dead until they clicked the bar. */
function tourOwnsArrows(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return true;
  return !!el.closest(`.usetour, .${BACKLINK_CHIP}`);
}

export function ReferenceTour() {
  const [tour, setTour] = useState<Tour | null>(null);
  // null while the document is still being searched; a number once it has been.
  const [count, setCount] = useState<number | null>(null);
  const route = useRoute();
  const barRef = useRef<HTMLDivElement | null>(null);
  // The route the tour last successfully landed on. A document it has not landed on yet is
  // "cold": still reflowing, so it needs the settle loop rather than one smooth scroll.
  const arrivedRef = useRef<string>('');

  const close = useCallback(() => {
    clearMarks();
    arrivedRef.current = '';
    setTour(null);
    setCount(null);
  }, []);

  /** Enter (or move) the tour: stand on `useIndex` of `docs[docIndex]`, navigating if needed. */
  const enter = useCallback((next: Tour) => {
    clearMarks();
    setCount(null);
    setTour(next);
    const { route: target } = next.docs[next.docIndex];
    if (currentRoute() !== target) navigate(target);
  }, []);

  const goToDoc = useCallback(
    (docIndex: number, useIndex: number) => {
      if (!tour || docIndex < 0 || docIndex >= tour.docs.length) return;
      // Only a DIFFERENT document is cold. The pill for the document already open is a live
      // button, and re-entering it should hop smoothly like every other same-document move.
      if (docIndex !== tour.docIndex) arrivedRef.current = '';
      enter({ ...tour, docIndex, useIndex });
    },
    [tour, enter],
  );

  /** Whether there is anywhere to go in that direction. The buttons' `disabled` and `step`
   *  itself both read this, so a keyboard press and a click can never disagree about where the
   *  tour ends. While the arriving document is still being searched the count is unknown, so
   *  "is there a next use here?" has no answer and the tour holds still rather than falling
   *  through to the change-document branch and silently skipping a whole document. */
  const canStep = useCallback(
    (delta: number): boolean => {
      if (!tour || count === null) return false;
      const next = tour.useIndex + delta;
      if (next >= 0 && next < count) return true;
      const nextDoc = tour.docIndex + Math.sign(delta);
      return nextDoc >= 0 && nextDoc < tour.docs.length;
    },
    [tour, count],
  );

  const step = useCallback(
    (delta: number) => {
      if (!tour || count === null || !canStep(delta)) return;
      const next = tour.useIndex + delta;
      if (next >= 0 && next < count) setTour({ ...tour, useIndex: next });
      else goToDoc(tour.docIndex + Math.sign(delta), delta > 0 ? 0 : LAST_USE);
    },
    [tour, count, canStep, goToDoc],
  );

  // A chip is raw HTML inside the rendered document, so the click is caught by delegation.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const chip = target?.closest?.('[data-ref-id]') as HTMLElement | null;
      if (!chip) return;
      // An empty id would build /\b\b/, which matches at every word boundary — every document
      // would "reference" it and the control would open on nothing. Only reachable through raw
      // HTML in the markdown, but one line is cheaper than trusting that it stays that way.
      const id = chip.dataset.refId ?? '';
      if (!id) return;
      const docs = referenceDocs(id);
      if (!docs.length) return;
      const at = docs.findIndex((d) => d.name === chip.dataset.doc);
      arrivedRef.current = '';
      enter({ id, docs, docIndex: at < 0 ? 0 : at, useIndex: 0 });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [enter]);

  // Find the use this tour is standing on, mark it, and bring it into view. Re-runs whenever
  // the tour moves or the route changes, because both change what is on the page.
  useEffect(() => {
    if (!tour) return;
    const doc = tour.docs[tour.docIndex];
    if (route !== doc.route) {
      // Either the navigation this tour asked for has not rendered yet (the route dependency
      // will fire again when it has), or the reader went somewhere else — in which case the
      // tour ends rather than leaving a control pointing into a document they have left.
      if (currentRoute() !== doc.route) close();
      return;
    }
    let cancelled = false;
    let timer = 0;
    let hitTimer = 0;
    let cancelScroll: (() => void) | null = null;
    const started = Date.now();
    const cold = arrivedRef.current !== doc.route;

    const locate = () => {
      if (cancelled) return;
      const found = usesOf(tour.id);
      if (!found.length) {
        if (Date.now() - started < SETTLE_BUDGET_MS) {
          timer = window.setTimeout(locate, POLL_MS);
          return;
        }
        setCount(0); // every mention here is inside code; the reader can still step onward
        return;
      }
      const idx = tour.useIndex === LAST_USE ? found.length - 1 : Math.min(tour.useIndex, found.length - 1);
      setCount(found.length);
      if (idx !== tour.useIndex) {
        setTour((t) => (t ? { ...t, useIndex: idx } : t)); // normalise, then this effect re-runs
        return;
      }
      arrivedRef.current = doc.route;
      clearMarks();
      const el = found[idx];
      reveal(el);
      el.classList.add('usenow', 'usehit');
      hitTimer = window.setTimeout(() => el.classList.remove('usehit'), HIT_MS);
      cancelScroll = scrollToElement(() => el, { line: readingLine(), smooth: !cold });
    };
    locate();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(hitTimer);
      // A cold arrival's settle loop keeps scrolling to ITS target; left running it would drag
      // the page back to the previous use the moment the reader steps on.
      cancelScroll?.();
    };
  }, [tour, route, close]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape closes from anywhere, unlike the arrows: a reader who has typed into the REPL
      // and wants the control gone should not have to work out what currently holds focus.
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if (!tourOwnsArrows()) return;
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tour, step, close]);

  // Take focus so the arrow keys work without a click, but never scroll the page to do it —
  // the tour has just put the reader exactly where it wants them.
  //
  // Keyed on which reference is being walked, not merely on "is the tour open": clicking a
  // second chip while the control is already open leaves focus on that chip, which is outside
  // `.usetour` and therefore does not own the arrow keys — they would go dead until the reader
  // clicked the bar. Focus is NOT taken back when it is already inside the control, or every
  // press of the ‹ / › buttons would move focus off the button being clicked.
  const open = !!tour;
  // Empty when the tour is closed, so this one value carries both "is it open" and "which
  // reference is being walked" — and it is read in the effect body, so it is a real dependency
  // rather than one the exhaustive-deps rule would flag as unnecessary.
  const walkKey = tour ? `${tour.id}@${tour.docIndex}` : '';
  useEffect(() => {
    if (!walkKey) return;
    const bar = barRef.current;
    if (bar && !bar.contains(document.activeElement)) bar.focus({ preventScroll: true });
  }, [walkKey]);

  // Reserve room at the foot of the document so the control never covers the last line of prose.
  useEffect(() => {
    document.body.classList.toggle('touring', open);
    return () => document.body.classList.remove('touring');
  }, [open]);

  useEffect(() => clearMarks, []);

  if (!tour) return null;
  const doc = tour.docs[tour.docIndex];
  const where =
    count === null ? 'looking…' : count === 0 ? 'no reference in view' : `use ${tour.useIndex + 1} of ${count}`;

  return (
    <div className="usetour" role="region" aria-label={`References to ${tour.id}`} tabIndex={-1} ref={barRef}>
      <span className="ut-id">{tour.id}</span>
      <span className="ut-where">in {doc.label}</span>
      <button className="ut-step ut-prev" onClick={() => step(-1)} disabled={!canStep(-1)} aria-label="Previous use">
        ‹
      </button>
      <span className="ut-count" aria-live="polite">
        {where}
      </span>
      <button className="ut-step ut-next" onClick={() => step(1)} disabled={!canStep(1)} aria-label="Next use">
        ›
      </button>
      <span className="ut-docs">
        {tour.docs.map((d, i) => (
          <button
            key={d.name}
            className={`ut-doc${i === tour.docIndex ? ' on' : ''}`}
            onClick={() => goToDoc(i, 0)}
            aria-current={i === tour.docIndex || undefined}
          >
            {d.name}
          </button>
        ))}
      </span>
      <button className="ut-close" onClick={close} aria-label="Close">
        ✕
      </button>
    </div>
  );
}
