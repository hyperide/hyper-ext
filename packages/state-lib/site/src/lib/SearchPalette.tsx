/** Site search: a ⌘K/Ctrl+K palette over the Orama index in search.ts. Two exports because
 *  the trigger has to sit inline in the nav row (desktop strip and phone header both), while
 *  the overlay itself is one instance mounted once at the top of the app — a tiny external
 *  store (the smallest one that could work; this site is not going to pull in a context
 *  provider to toggle a boolean) keeps the two in sync regardless of which button was clicked. */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { navigate } from './router';
import { runSearch, ensureIndex, type SearchHit } from './search';

let openState = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  openState = v;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function useOpen(): boolean {
  return useSyncExternalStore(subscribe, () => openState);
}

export function SearchButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={() => setOpen(true)} aria-label="Search the site">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10 10L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className="searchbtn-label">Search</span>
      <kbd className="searchbtn-kbd">⌘K</kbd>
    </button>
  );
}

const KIND_LABEL: Record<string, string> = {
  page: 'Page',
  concept: 'Concept',
  compare: 'Compare',
  landscape: 'Landscape',
  example: 'REPL example',
  effect: 'No useEffect',
  requirement: 'Requirement',
  decision: 'Decision',
  spec: 'Master spec',
  brief: 'Research brief',
  dive: 'Deep dive',
};

export function SearchPalette() {
  const open = useOpen();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!openState);
      } else if (e.key === 'Escape' && openState) {
        setOpen(false);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      void ensureIndex();
      inputRef.current?.focus();
    } else {
      setQ('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!q.trim()) {
      setHits([]);
      return;
    }
    void runSearch(q).then((r) => {
      if (!cancelled) {
        setHits(r);
        setActive(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  useEffect(() => {
    resultRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const go = (hit: SearchHit) => {
    setOpen(false);
    navigate(hit.route, hit.anchor || undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <div
      className="searchmodal"
      role="dialog"
      aria-modal="true"
      aria-label="Site search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="searchpanel">
        <input
          ref={inputRef}
          className="searchinput"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages, glossary, requirements, decisions, spec…"
          aria-label="Search query"
        />
        <div className="searchresults">
          {q.trim() && hits.length === 0 && <div className="searchempty">No matches for “{q}”</div>}
          {hits.map((h, i) => (
            <button
              key={h.kind + h.route + h.anchor + h.title}
              ref={(el) => {
                resultRefs.current[i] = el;
              }}
              type="button"
              className={`searchresult${i === active ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
            >
              <span className="searchresult-kind">{KIND_LABEL[h.kind] ?? h.kind}</span>
              <span className="searchresult-title">{h.title}</span>
              {h.body && <span className="searchresult-body">{h.body.slice(0, 140)}</span>}
            </button>
          ))}
          {!q.trim() && (
            <div className="searchempty">Type to search — try a requirement id, a library name, or “datalog”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
