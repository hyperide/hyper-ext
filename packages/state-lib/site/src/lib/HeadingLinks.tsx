/** A small "copy link to this heading" ghost button, revealed on hover/focus, for every h2/h3/h4
 *  that already carries an id — from `useHeadings` (Toc.tsx: every doc/concepts/page TOC target)
 *  or from a hand-written id elsewhere. Deliberately DOM-driven rather than a per-heading React
 *  component: headings across this site come from three different rendering paths (`marked`
 *  output via `dangerouslySetInnerHTML` in Doc.tsx, a static HTML fragment in Concepts.tsx, and
 *  plain JSX in SelectorsVsDatalog.tsx and friends), and `useHeadings` itself already mutates
 *  heading elements directly for the same reason (see Toc.tsx) — this follows that precedent
 *  instead of fighting it with three separate React implementations.
 *
 *  A MutationObserver (not a route effect) drives it: `useHeadings` assigns ids in its own
 *  effect, which may commit after this one, and a plain route-keyed effect would then decorate
 *  headings that have no id yet. The observer just reacts whenever the DOM actually changes, is
 *  idempotent (skips a heading that already has its button), and the callback is coalesced to
 *  one `decorate()` per animation frame so a busy subtree (the REPL, a live demo) cannot cause
 *  more than that.
 */
import { useEffect } from 'react';
import { href, currentRoute } from './router';

const BTN_CLASS = 'heading-link-btn';
const HEADING_SELECTOR = [
  '.md h2[id]',
  '.md h3[id]',
  '.md h4[id]',
  '.concepts-body h2[id]',
  '.concepts-body h3[id]',
  '.svd-body h2[id]',
  '.svd-body h3[id]',
].join(', ');

const LINK_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.3 9.7a3 3 0 0 0 4.24 0l2-2a3 3 0 1 0-4.24-4.24l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9.7 6.3a3 3 0 0 0-4.24 0l-2 2a3 3 0 1 0 4.24 4.24l1.1-1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the execCommand fallback — some browsers refuse the async API on file://
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    // best effort — nothing else to do if both copy paths refuse
  }
  document.body.removeChild(ta);
}

function decorate() {
  for (const h of document.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (h.querySelector(`.${BTN_CLASS}`)) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-label', 'Copy link to this section');
    btn.dataset.headingId = h.id;
    btn.innerHTML = LINK_ICON;
    h.appendChild(btn);
  }
}

let copyTimer = 0;
let frame = 0;
function scheduleDecorate() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    decorate();
  });
}

export function HeadingLinks() {
  useEffect(() => {
    decorate();
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });

    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest?.(`.${BTN_CLASS}`) as HTMLButtonElement | null;
      if (!btn) return;
      e.preventDefault();
      const id = btn.dataset.headingId;
      if (!id) return;
      void copyText(location.origin + href(currentRoute(), id));
      btn.classList.add('copied');
      btn.innerHTML = CHECK_ICON;
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = LINK_ICON;
      }, 1200);
    };
    document.addEventListener('click', onClick);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(frame);
      frame = 0;
    };
  }, []);
  return null;
}
