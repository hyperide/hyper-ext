import { useEffect, useRef, useState } from 'react';
import { takeOverScroll, href, currentRoute, headerOffset } from './router';
import { createPortal } from 'react-dom';
import { useDragScroll } from './useDragScroll';

/** R82 — a sidebar contents list that tracks the heading currently being read.
 *
 *  It reads the headings out of the rendered DOM rather than from the markdown, so it
 *  works for a page built from JSX just as well as for one rendered from a document,
 *  and it cannot disagree with what is actually on screen. */
export type Heading = { id: string; text: string; level: number };

/** Which heading is "current" is a judgement call, and the obvious answers are both wrong:
 *  the topmost visible heading flickers on fast scrolls, and the closest-to-centre one
 *  jumps ahead of what the reader is looking at. The rule here is the one that matches
 *  reading: the last heading whose top has passed a line near the top of the viewport. */

export function useHeadings(container: string, deps: unknown[] = []): Heading[] {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const previousDeps = useRef(deps);
  if (
    deps.length !== previousDeps.current.length ||
    deps.some((value, index) => !Object.is(value, previousDeps.current[index]))
  )
    previousDeps.current = deps;
  const stableDeps = previousDeps.current;
  useEffect(() => {
    const root = document.querySelector(container);
    if (!root) return;
    const found: Heading[] = [];
    const used = new Set<string>();
    for (const el of Array.from(root.querySelectorAll('h2, h3'))) {
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      // A heading rendered from markdown has no id, so one is derived from its words.
      // Deliberately NOT numbered by position: an ordinal renumbers every anchor below
      // any heading that gets inserted, silently breaking every inbound link to them.
      // Collisions take a suffix, so only a genuine duplicate title is ever affected.
      if (!el.id) {
        const base = `h-${text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48)}`;
        let id = base;
        for (let k = 2; used.has(id); k++) id = `${base}-${k}`;
        el.id = id;
      }
      used.add(el.id);
      found.push({ id: el.id, text, level: el.tagName === 'H2' ? 2 : 3 });
    }
    setHeadings(found);
  }, [container, stableDeps]);
  return headings;
}

export function Toc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState('');
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const ribbon = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  useDragScroll(ribbon, false, slot && headings.length >= 3);
  useEffect(() => {
    setSlot(document.getElementById('page-toc-slot'));
  }, []);
  useEffect(() => {
    if (!headings.length) return;
    let frame = 0;
    const pick = () => {
      frame = 0;
      let current = headings[0].id;
      const line = headerOffset() + 12;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= line) current = h.id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    pick();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [headings]);
  useEffect(() => {
    // Scroll ONLY the local scroller. scrollIntoView() can also move the article.
    const a = aside.current?.querySelector<HTMLElement>('a.on');
    if (a && aside.current) {
      const box = a.getBoundingClientRect(),
        root = aside.current.getBoundingClientRect();
      if (box.top < root.top) aside.current.scrollTop += box.top - root.top;
      else if (box.bottom > root.bottom) aside.current.scrollTop += box.bottom - root.bottom;
    }
    const el = ribbon.current;
    if (!el || el.matches(':hover, :focus-within')) return;
    const on = el.querySelector<HTMLElement>('a.on');
    if (on) el.scrollLeft = on.offsetLeft - el.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
  }, [active, slot]);
  const links = headings.map((h) => (
    <a
      key={h.id}
      href={href(currentRoute(), h.id)}
      className={(h.level === 3 ? 'sub' : '') + (h.id === active ? ' on' : '')}
      aria-current={h.id === active ? 'location' : undefined}
      onClick={(e) => {
        e.preventDefault();
        takeOverScroll();
        setActive(h.id);
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(h.id)?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
        history.replaceState(null, '', href(currentRoute(), h.id));
      }}
    >
      {h.text}
    </a>
  ));
  if (headings.length < 3) return null;
  return (
    <>
      <nav className="toc" ref={aside} aria-label="On this page">
        <p className="toc-head">On this page</p>
        {links}
      </nav>
      {slot &&
        createPortal(
          <nav className="toc-mobile" aria-label="On this page (horizontal)">
            <span className="toc-mobile-label">On this page</span>
            <div className="toc-ribbon" ref={ribbon}>
              {links}
            </div>
          </nav>,
          slot,
        )}
    </>
  );
}
