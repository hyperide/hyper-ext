/** Dual-mode router: real History API paths when served over http(s) — hashes stay free for
 *  in-page anchors and back/forward works natively; hash-based routing only as the file:// fallback
 *  (the committed single-file dist opened from disk). */
import { useEffect, useState } from 'react';

export const HISTORY_MODE = typeof location !== 'undefined' && location.protocol !== 'file:';

export function currentRoute(): string {
  if (HISTORY_MODE) return location.pathname.replace(/\/+$/, '') || '/';
  const h = location.hash.replace(/^#/, '');
  return (h.split('#')[0] || '/').replace(/\/+$/, '') || '/';
}
export function currentAnchor(): string {
  if (HISTORY_MODE) return location.hash.replace(/^#/, '');
  const h = location.hash.replace(/^#/, '');
  return h.split('#')[1] || '';
}
/** Build an href for a route (optionally with an in-page anchor). */
export function href(route: string, anchor?: string): string {
  const a = anchor ? `#${anchor}` : '';
  return HISTORY_MODE ? route + a : `#${route}${anchor ? `#${anchor}` : ''}`;
}
/** Static HTML fragments (`src/content/*.html`) cannot call `href()`, so they write
 *  route links in one fixed shape — `href="#/repl/cancellation"` — and this rewrites
 *  them for whichever mode the page is actually in. Without it a fragment link works
 *  from disk and silently does nothing when served, which is the mode the site is
 *  read in. In-page anchors (`href="#term"`, no slash) are left exactly as they are.
 */
export function rewriteRouteLinks(html: string): string {
  return html.replace(
    /href="#(\/[^"#]*)(#([^"]*))?"/g,
    (_m, route: string, _h, anchor?: string) => `href="${href(route, anchor)}"`,
  );
}

export function navigate(route: string, anchor?: string) {
  if (HISTORY_MODE) {
    history.pushState(null, '', href(route, anchor));
    dispatchEvent(new PopStateEvent('popstate'));
  } else location.hash = href(route, anchor).slice(1);
}

export function useRoute(): string {
  const [r, setR] = useState(currentRoute());
  useEffect(() => {
    const on = () => setR(currentRoute());
    addEventListener('popstate', on);
    addEventListener('hashchange', on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener('hashchange', on);
    };
  }, []);
  return r;
}

/**
 * The in-page anchor, tracked the way `useRoute` tracks the route. A link to
 * `#/decisions#d12` from a row on /decisions changes the anchor and NOT the
 * route, so an effect keyed on the route alone never re-runs and the page does
 * not move — the reported bug. Key the scroll effect on both.
 */
export function useAnchor(): string {
  const [a, setA] = useState(currentAnchor());
  useEffect(() => {
    const on = () => setA(currentAnchor());
    addEventListener('popstate', on);
    addEventListener('hashchange', on);
    return () => {
      removeEventListener('popstate', on);
      removeEventListener('hashchange', on);
    };
  }, []);
  return a;
}

/** Intercept same-origin route clicks in history mode so <a href="/x"> doesn't reload the page. */
export function installLinkInterceptor() {
  if (!HISTORY_MODE) return;
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest('a');
    if (
      !a ||
      a.target ||
      a.hasAttribute('download') ||
      a.hasAttribute('data-native') ||
      a.origin !== location.origin ||
      /\.(md|txt|xml|svg|png|json)$/.test(a.pathname)
    )
      return;
    const path = a.pathname.replace(/\/+$/, '') || '/';
    e.preventDefault();
    if (path === currentRoute() && a.hash) {
      // Pure anchor jump on the same route. Same route means no re-render, so nothing else
      // would stop a cold load's settle loop still running on the anchor the reader arrived at.
      takeOverScroll();
      history.pushState(null, '', a.pathname + a.hash);
      dispatchEvent(new PopStateEvent('popstate'));
      document.getElementById(a.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    history.pushState(null, '', a.pathname + a.hash);
    dispatchEvent(new PopStateEvent('popstate'));
  });
}

/** After a route renders, honour the anchor in the URL (R69).
 *
 *  Three separate things can go wrong on a cold load of a long page, and a fixed number of
 *  retries only covers the first: the element may not exist yet (React has not committed),
 *  the page may still be growing beneath it (fonts, tables and images settle late, and the
 *  master spec is a quarter of a megabyte of markdown), and the sticky navigation covers
 *  the top of the viewport.
 *
 *  So this does not retry blindly — it scrolls, measures where the target actually ended
 *  up, and scrolls again while the answer keeps changing. It stops as soon as the target
 *  is where it should be, which on a short page is the first attempt.
 *
 *  It also disables CSS smooth scrolling for the duration. Smooth is right when a reader
 *  clicks a heading — they can see where they are going. It is wrong for a cold link:
 *  animating sixty thousand pixels of the master spec took 2.1 seconds of scenery before
 *  landing, and every measurement in between is mid-animation, so the settle loop chases
 *  a moving target. Landing is instant; the smooth behaviour is restored afterwards.
 */
export const headerOffset = () =>
  Math.ceil(document.querySelector('nav.top')?.getBoundingClientRect().height ?? 64) + 16;
/** How long to keep waiting for a target that has not rendered or has not stopped moving.
 *  Exported because the reference tour waits for the same thing, in the same document, for the
 *  same reason — two independently-tuned budgets would drift apart silently. */
export const SETTLE_BUDGET_MS = 2500;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Turning off CSS smooth scrolling is a change to ONE global, and more than one settle loop
 *  can be in flight (an anchor jump and a tour step, or two anchor jumps in quick succession).
 *  Saving and restoring it per call loses: the second caller saves the first caller's `auto`,
 *  and whichever finishes last writes it back — leaving the whole site on instant scrolling
 *  for good. So the override is counted, the real prior value is captured once, and each
 *  holder releases at most once. */
let instantHolders = 0;
let behaviorBeforeOverride = '';
function holdInstantScroll(): () => void {
  const root = document.documentElement;
  if (instantHolders === 0) {
    behaviorBeforeOverride = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
  }
  instantHolders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--instantHolders === 0) root.style.scrollBehavior = behaviorBeforeOverride;
  };
}

/** The settle loop itself, over anything the caller can find. `line` is where in the viewport
 *  the target should end up; `smooth` is for a target on a page that is already laid out — the
 *  reader can see it move, and there is nothing to settle, so it scrolls once and stops.
 *
 *  Returns a canceller. A caller that can be superseded mid-flight (the tour, whose reader may
 *  press "next" while a cold arrival is still settling) MUST call it: a loop left running keeps
 *  scrolling the page back to the target it was given, so the control says "use 2" while the
 *  viewport shows use 1. */
function settleTo(find: () => Element | null, line: number, smooth: boolean): () => void {
  const started = Date.now();
  let lastTop = Number.NaN;
  let timer = 0;
  let cancelled = false;
  const release = smooth ? null : holdInstantScroll();
  const done = () => release?.();

  const settle = () => {
    if (cancelled) return;
    const el = find();
    if (!el) {
      // Not rendered yet. Keep looking until the budget runs out.
      if (Date.now() - started < SETTLE_BUDGET_MS) timer = window.setTimeout(settle, 60);
      else done();
      return;
    }
    const top = el.getBoundingClientRect().top;
    if (Math.abs(top - line) < 4) {
      done(); // already where it belongs
      return;
    }
    if (smooth) {
      window.scrollBy({ top: top - line, behavior: 'smooth' });
      done();
      return;
    }

    window.scrollBy({ top: top - line, behavior: 'auto' });

    // If this attempt moved the target by the same amount as the last one, the page has
    // stopped growing and we are done; otherwise it is still reflowing under us.
    const settledHere = Math.abs(top - lastTop) < 2;
    lastTop = top;
    if (!settledHere && Date.now() - started < SETTLE_BUDGET_MS) timer = window.setTimeout(settle, 80);
    else done();
  };
  // Web fonts are the reflow this loop cannot out-wait by polling: they land in
  // one step, long after two consecutive attempts have already agreed the page
  // had stopped moving, and they change every line height in a document that
  // can be seventy thousand pixels tall. So the loop is re-armed once when the
  // fonts are ready — this is what the harness caught after the type on the
  // documentation pages changed, landing 200-800px short of the anchor.
  document.fonts?.ready
    .then(() => {
      if (cancelled) return;
      const el = find();
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (Math.abs(top - line) >= 4) {
        const hold = holdInstantScroll();
        window.scrollBy({ top: top - line, behavior: 'auto' });
        hold();
      }
    })
    .catch(() => undefined);
  timer = window.setTimeout(settle, 30);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    done();
  };
}

/** The ANCHOR jump in flight, if any. Two settle loops running at once fight over the viewport for
 *  up to the whole budget, and only one anchor jump can be current, so the previous one is
 *  cancelled rather than left to argue with its successor. */
let cancelAnchorScroll: (() => void) | null = null;

/** Stop the anchor jump in flight. A gesture that takes the viewport somewhere else calls this
 *  first, or the two swing the page between two targets for the rest of the settle budget.
 *
 *  Exported because the callers are not all in this file: a click on a contents entry scrolls the
 *  heading into view itself, and a long document can still be settling when that click arrives.
 *
 *  Scoped to ANCHOR jumps deliberately. Registering every settle loop in one slot — so a contents
 *  click would also stop the reference tour's own loop — reads better and was tried; it breaks the
 *  tour. A child's effects run before its parent's, so on a route change the tour claims the slot
 *  and then App's `scrollToAnchor` cancels it, and a tour walking into another document lands at
 *  the top of it instead of on the use. The remaining gap is small and the reverse of harmful: a
 *  contents click during the tour's cold arrival can be pulled back for up to the budget. */
export function takeOverScroll() {
  cancelAnchorScroll?.();
  cancelAnchorScroll = null;
}

export function scrollToAnchor() {
  takeOverScroll();
  const anchor = currentAnchor();
  if (!anchor) {
    window.scrollTo(0, 0);
    return;
  }
  cancelAnchorScroll = settleTo(() => document.getElementById(anchor), headerOffset(), false);
}

/** Same loop, for a target that has no id to put in the URL — the reference tour steps between
 *  links found in the rendered document. Returns a canceller, which a caller that can be
 *  superseded must call. (`find` is a function for the same reason `scrollToAnchor` needs it —
 *  the loop re-reads the target on every attempt. The tour has already found its element by the
 *  time it calls, so it passes a constant; the contract is the loop's, not the tour's.)
 *
 *  A smooth request is downgraded to an instant one when the reader asked for reduced motion:
 *  CSS `scroll-behavior` honours that media query, `window.scrollBy({behavior:'smooth'})` does
 *  not, so the preference has to be enforced here. */
export function scrollToElement(
  find: () => Element | null,
  opts: { line?: number; smooth?: boolean } = {},
): () => void {
  // A cold load of `/requirements#R60` starts an anchor jump that runs for up to the settle
  // budget. Clicking a chip on that same page does not change the route, so nothing else would
  // stop it, and it would yank the viewport back to #R60 every 80ms while the tour tried to
  // hold a use in the reading line. The newer request wins: this call IS the reader asking to
  // be somewhere else.
  takeOverScroll();
  const smooth = (opts.smooth ?? false) && !prefersReducedMotion();
  return settleTo(find, opts.line ?? headerOffset(), smooth);
}
