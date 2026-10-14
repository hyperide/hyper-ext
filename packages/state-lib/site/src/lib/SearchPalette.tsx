import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { href, navigate } from './router';
import { runSearch, type SearchHit } from './search';
import { PRIMARY, DOCS } from './routes';
import type { Heading } from './Toc';
import { filterPageEntries, pageEntries, resultExcerpt, type NavigationScope } from './navigation-search';

export function SearchButton({
  className,
  expanded,
  onClick,
}: {
  className: string;
  expanded: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label="Menu and search"
      aria-expanded={expanded}
      aria-controls="site-menu"
      aria-haspopup="dialog"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 6h14M3 12h6M3 18h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="16" cy="13" r="4" stroke="currentColor" strokeWidth="1.7" />
        <path d="m19 16 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      <span className="searchbtn-label">Menu & search</span>
      <kbd className="searchbtn-kbd">⌘K</kbd>
    </button>
  );
}

const pages: SearchHit[] = [['/', 'Home'], ...PRIMARY, ...DOCS].map(([route, title]) => ({
  route,
  title: title.replace('→', ' → '),
  anchor: '',
  kind: 'page',
  body: '',
  score: 0,
}));
const kinds: Record<string, string> = {
  page: 'Page',
  heading: 'On this page',
  example: 'Interactive example',
  requirement: 'Requirement',
  decision: 'Decision',
  spec: 'Specification',
  concept: 'Concept',
  landscape: 'Library',
};

type Props = {
  mode: NavigationScope | null;
  focusSearch?: boolean;
  route: string;
  pageTitle: string;
  headings: Heading[];
  activeHeading: string;
  onClose: () => void;
  onScope: (scope: NavigationScope) => void;
  onOpen: () => void;
};

export function SearchPalette({
  mode,
  focusSearch = true,
  route,
  pageTitle,
  headings,
  activeHeading,
  onClose,
  onScope,
  onOpen,
}: Props) {
  const open = mode !== null;
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelTitle = useRef<HTMLSpanElement>(null);
  const resultRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitsQuery, setHitsQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const localEntries = useMemo(() => (mode === 'page' ? pageEntries(headings, route) : []), [headings, route, mode]);
  const results =
    mode === 'page' ? filterPageEntries(localEntries, query) : query.trim() ? (hitsQuery === query ? hits : []) : pages;
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      setQuery('');
      setHits([]);
      setError('');
      node.showModal();
    } else if (!open && node.open) node.close();
    if (open) (focusSearch ? input.current : panelTitle.current)?.focus({ preventScroll: true });
  }, [open, focusSearch]);
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.isComposing) return;
      event.preventDefault();
      if (open) onClose();
      else onOpen();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open, onClose, onOpen]);
  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setHitsQuery('');
    setError('');
    if (!open || mode === 'page' || !query.trim()) {
      setPending(false);
      return;
    }
    setPending(true);
    void runSearch(query)
      .then((found) => {
        if (!cancelled) {
          setHits(found);
          setHitsQuery(query);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Search is unavailable. Use the page links below.');
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, mode, open]);
  useEffect(() => {
    if (!open) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const resize = () => {
      const viewport = window.visualViewport;
      const top = Math.max(12, document.querySelector('nav.top')?.getBoundingClientRect().bottom ?? 60);
      dialog.current?.style.setProperty('--menu-top', `${top}px`);
      dialog.current?.style.setProperty(
        '--menu-height',
        `${Math.max(120, (viewport?.height ?? innerHeight) + (viewport?.offsetTop ?? 0) - top - 12)}px`,
      );
    };
    resize();
    window.visualViewport?.addEventListener('resize', resize);
    addEventListener('resize', resize);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.visualViewport?.removeEventListener('resize', resize);
      removeEventListener('resize', resize);
    };
  }, [open]);
  const clearScope = () => {
    onScope('site');
    input.current?.focus({ preventScroll: true });
  };
  const go = (hit: SearchHit) => {
    dialog.current?.close();
    onClose();
    navigate(hit.route, hit.anchor || undefined);
    requestAnimationFrame(() => {
      const target = hit.anchor
        ? document.getElementById(hit.anchor)
        : document.querySelector<HTMLElement>('#page-content h1');
      target?.setAttribute('tabindex', '-1');
      target?.focus({ preventScroll: true });
    });
  };
  const visible = error && mode === 'site' ? pages : results;
  const searching = mode === 'site' && !!query.trim() && (pending || (!error && hitsQuery !== query));
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target === input.current) {
      if (event.key === 'Backspace' && query === '' && mode === 'page') {
        event.preventDefault();
        clearScope();
      }
      if (event.key === 'ArrowDown' && visible.length) {
        event.preventDefault();
        resultRefs.current[0]?.focus();
      }
      if (event.key === 'Enter' && visible[0] && !searching) {
        event.preventDefault();
        go(visible[0]);
      }
      return;
    }
    const at = resultRefs.current.indexOf(event.target as HTMLAnchorElement);
    if (at < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && at === 0) {
      input.current?.focus();
      return;
    }
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? visible.length - 1
          : Math.min(visible.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1));
    resultRefs.current[next]?.focus();
  };
  return (
    <dialog
      ref={dialog}
      id="site-menu"
      className="navigation-dialog"
      aria-label="Menu and search"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={keyDown}
    >
      <div className="navigation-panel">
        <div className="navigation-panel-top">
          <span ref={panelTitle} tabIndex={-1}>
            {mode === 'page' ? pageTitle : 'Explore state'}
          </span>
          <button className="menu-close" type="button" onClick={onClose} aria-label="Close menu and search">
            ×
          </button>
        </div>
        <div className="navigation-search-field">
          {mode === 'page' && (
            <button
              type="button"
              className="search-scope"
              onClick={clearScope}
              aria-label={`Remove In page filter; search the whole site`}
              title={`Searching ${pageTitle}. Remove to search the whole site.`}
            >
              In page <span aria-hidden="true">×</span>
            </button>
          )}
          <input
            ref={input}
            className="searchinput"
            type="search"
            value={query}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => {
              const nextQuery = event.target.value;
              if (nextQuery === query) return;
              setError('');
              setHitsQuery('');
              setQuery(nextQuery);
            }}
            aria-label={mode === 'page' ? 'Search this page' : 'Search the site'}
            aria-describedby="navigation-search-scope"
            placeholder={mode === 'page' ? 'Find a heading or text…' : 'Search pages, examples, concepts…'}
          />
        </div>
        <p id="navigation-search-scope" className="search-scope-hint" aria-live="polite">
          {mode === 'page'
            ? `Only in ${pageTitle}. Remove In page to search the whole site.`
            : 'All pages, examples and documentation.'}
        </p>
        <div className="navigation-results" aria-busy={searching}>
          <p className="navigation-results-label">
            {mode === 'page' ? 'On this page' : query.trim() && !error ? 'Search results' : 'Pages & documentation'}
          </p>
          {searching && <p role="status">Searching…</p>}
          {error && mode === 'site' && <p role="status">{error}</p>}
          {!searching && !visible.length && (
            <p role="status" className="searchempty">
              {query.trim()
                ? `No matches${mode === 'page' ? ' on this page' : ''} for “${query}”.`
                : 'No section headings on this page.'}
            </p>
          )}
          <nav
            className={`navigation-links${mode === 'site' && !query.trim() ? ' navigation-pages' : ''}`}
            aria-label={mode === 'page' ? 'Headings on this page' : 'Pages and search results'}
          >
            {visible.map((hit, index) => (
              <a
                key={`${hit.route}#${hit.anchor}:${hit.title}`}
                href={href(hit.route, hit.anchor || undefined)}
                aria-label={hit.title}
                ref={(element) => {
                  resultRefs.current[index] = element;
                }}
                data-search-result
                data-level={'level' in hit ? hit.level : undefined}
                className="searchresult"
                aria-current={
                  hit.route === route && (mode === 'site' ? !hit.anchor : hit.anchor === activeHeading)
                    ? mode === 'page'
                      ? 'location'
                      : 'page'
                    : undefined
                }
                onClick={(event) => {
                  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  go(hit);
                }}
              >
                {mode !== 'page' && query.trim() && (
                  <span className="searchresult-kind">{kinds[hit.kind] ?? hit.kind}</span>
                )}
                <span className="searchresult-title">{hit.title}</span>
                {query.trim() && hit.body && (
                  <span className="searchresult-body">{resultExcerpt(hit.body, query)}</span>
                )}
              </a>
            ))}
          </nav>
        </div>
        <footer className="navigation-footer">
          {mode === 'page' ? (
            <button type="button" className="linkish" onClick={clearScope}>
              Search the whole site →
            </button>
          ) : (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                onScope('page');
                input.current?.focus();
              }}
            >
              Search only {pageTitle} →
            </button>
          )}
          <span>Esc to close</span>
        </footer>
      </div>
    </dialog>
  );
}
