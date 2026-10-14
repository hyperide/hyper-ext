import { SiteIcon } from './lib/SiteIcon';
import { useEffect, useRef, useState } from 'react';
import { DiagramViewer } from './lib/DiagramViewer';
import Home from './pages/Home';
import Snippet from './pages/Snippet';
import Api from './pages/Api';
import { SnippetActions } from './lib/SnippetActions';
import './docs-refresh.css';
import practicalMd from '../../docs/guides/2026-09-08-practical-concepts.md?raw';
import adaptersMd from '../../docs/guides/2026-09-08-framework-adapters.md?raw';
import queryResearchMd from '../../docs/research/2026-09-08-query-syntax-and-tanstack-db.md?raw';
import Concepts from './pages/Concepts';
import Landscape from './pages/Landscape';
import Doc from './pages/Doc';
import Bench from './pages/Bench';
import Compare from './pages/Compare';
import Devtools from './pages/Devtools';
import Cli from './pages/Cli';
import Init from './pages/Init';
import Effects from './pages/Effects';
import Library from './pages/Library';
import Repl from './pages/Repl';
import SelectorsVsDatalog from './pages/SelectorsVsDatalog';
import OperatorCorpus from './pages/OperatorCorpus';
import requirements from './content/requirements.md?raw';
import decisions from './content/decisions.md?raw';
import spec from './content/spec.md?raw';
import learning from './content/learning.md?raw';
import brief from './content/brief.md?raw';
import diveData from './content/dive-data.md?raw';
import diveStores from './content/dive-stores.md?raw';
import { useRoute, useAnchor, href, installLinkInterceptor, scrollToAnchor } from './lib/router';
import { useDragScroll } from './lib/useDragScroll';
import { ReferenceTour } from './lib/ReferenceTour';
import { SearchButton, SearchPalette } from './lib/SearchPalette';
import { useHeadings } from './lib/Toc';
import { useActiveHeading } from './lib/useActiveHeading';
import type { NavigationScope } from './lib/navigation-search';
import './navigation.css';
import { CopyPage } from './lib/CopyPage';
import { HeadingLinks } from './lib/HeadingLinks';
/** The brand is the home link, so `/` is deliberately not a menu item, and the
 *  playground and the REPL are one page under one name. Sixteen top-level
 *  links wrapped to two rows on a desktop and five on a phone — 182px of
 *  sticky header, a fifth of the screen, on every page. */
import { ROUTES, PRIMARY, DOCS } from './lib/routes';

let interceptorInstalled = false;

const isOn = (route: string, r: string) => route.startsWith(r) || (r === '/repl' && route.startsWith('/playground'));

/** The phone header's middle slot (bulka.rs shape): logo, then the current
 *  section's name, then the burger — so which page you're on is visible
 *  without opening the sheet. `ROUTES` misses two paths that route to real
 *  pages (`/lib/*`, `/validation`), so they get an explicit label here rather
 *  than showing nothing. */
function currentLabel(route: string): string | null {
  if (route === '/') return 'Home';
  if (route.startsWith('/repl/snippet')) return 'Source reference';
  if (route.startsWith('/concepts/practical')) return 'Practical concepts';
  if (route === '/lib') return 'Libraries';
  const hit = [...ROUTES]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([r]) => route === r || route.startsWith(`${r}/`));
  if (hit) return hit[1];
  if (route.startsWith('/lib/')) return `Library: ${route.split('/')[2] ?? ''}`;
  if (route.startsWith('/validation')) return 'Landscape';
  return null;
}

export default function App() {
  const route = useRoute();
  const anchor = useAnchor();
  const [menuMode, setMenuMode] = useState<NavigationScope | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const openMenu = (scope: NavigationScope, trigger: HTMLButtonElement, search = false) => {
    trigger.focus({ preventScroll: true });
    setFocusSearch(search);
    setMenuMode(scope);
  };
  const headings = useHeadings('#page-content', [route]);
  const activeHeading = useActiveHeading(headings);
  const pageTitle = currentLabel(route) ?? 'Documentation';
  const sectionTitle = headings.find((heading) => heading.id === activeHeading)?.text ?? 'On this page';
  const strip = useRef<HTMLDivElement>(null);
  useDragScroll(strip);
  useEffect(() => {
    const top = document.querySelector('nav.top');
    if (!top) return;
    const resize = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--header-height',
        `${Math.ceil(top.getBoundingClientRect().height)}px`,
      );
    });
    resize.observe(top);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    setMenuMode(null);
  }, [route, anchor]);
  // Keep the current page's link in view in the desktop strip.
  useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('a.on');
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, [route]);
  useEffect(() => {
    if (!interceptorInstalled) {
      installLinkInterceptor();
      interceptorInstalled = true;
    }
  }, []);
  // Both, not just the route: a same-page anchor link changes only the anchor.
  useEffect(() => {
    scrollToAnchor();
  }, [route, anchor]);
  const page = route.startsWith('/queries') ? (
    <OperatorCorpus />
  ) : route.startsWith('/repl/snippet') ? (
    <Snippet />
  ) : route.startsWith('/api') ? (
    <Api />
  ) : route.startsWith('/init') ? (
    <Init />
  ) : route.startsWith('/concepts/practical') ? (
    <Doc title="Practical concepts" md={practicalMd} />
  ) : route.startsWith('/adapters') ? (
    <Doc title="Framework adapters" md={adaptersMd} />
  ) : route.startsWith('/query-research') ? (
    <Doc title="Query syntax and TanStack DB" md={queryResearchMd} wide />
  ) : route.startsWith('/learning') ? (
    <Doc title="Reactivity, synchronisation and readable documentation" md={learning} wide />
  ) : route.startsWith('/concepts') ? (
    <Concepts />
  ) : route.startsWith('/landscape') ? (
    <Landscape />
  ) : // The playground and the REPL are one page: an editor with a step
  // debugger, and the live comparison below it. /repl stays a route because
  // every "run it" button and a good deal of prose links to /repl/<example>.
  route.startsWith('/repl') || route.startsWith('/playground') ? (
    <Repl />
  ) : route.startsWith('/lib') ? (
    <Library id={route.split('/')[2] ?? ''} />
  ) : route.startsWith('/compare') ? (
    <Compare />
  ) : route.startsWith('/selectors-vs-datalog') ? (
    <SelectorsVsDatalog />
  ) : route.startsWith('/bench') ? (
    <Bench />
  ) : route.startsWith('/cli') ? (
    <Cli />
  ) : route.startsWith('/effects') ? (
    <Effects />
  ) : route.startsWith('/devtools') ? (
    <Devtools />
  ) : route.startsWith('/validation') ? (
    <Landscape /> // merged into the landscape (validation layer)
  ) : route.startsWith('/dive-data') ? (
    <Doc title="Deep dive: data & reactivity prior art" md={diveData} wide />
  ) : route.startsWith('/dive-stores') ? (
    <Doc title="Deep dive: store prior art" md={diveStores} wide />
  ) : route.startsWith('/requirements') ? (
    <Doc title="Requirements" md={requirements} />
  ) : route.startsWith('/decisions') ? (
    <Doc title="Decision log" md={decisions} wide />
  ) : route.startsWith('/spec') ? (
    <Doc title="Master spec" md={spec} wide />
  ) : route.startsWith('/brief') ? (
    <Doc title="Research brief" md={brief} wide />
  ) : route === '/' ? (
    <Home />
  ) : (
    <div className="wrap">
      <header className="page">
        <p className="kicker">404</p>
        <h1>Page not found</h1>
        <p>This page is not part of the documentation.</p>
        <a href={href('/')}>Back to state</a>
      </header>
    </div>
  );
  return (
    <>
      <nav className="top">
        <div className="wrap">
          <a className={`brand${route === '/' ? ' on' : ''}`} href={href('/')} title="state — home">
            state
          </a>
          <div className="nav-identity">
            <button
              type="button"
              className="navcurrent"
              aria-label={`${pageTitle} — open site menu`}
              aria-expanded={menuMode === 'site'}
              aria-controls="site-menu"
              aria-haspopup="dialog"
              onClick={(event) => openMenu('site', event.currentTarget)}
            >
              <span>{pageTitle}</span>
              <SiteIcon name="chevron" className="nav-chevron" />
            </button>
            <button
              type="button"
              className="navsection"
              title={sectionTitle}
              aria-label={`On this page: ${sectionTitle}`}
              aria-expanded={menuMode === 'page'}
              aria-controls="site-menu"
              aria-haspopup="dialog"
              onClick={(event) => openMenu('page', event.currentTarget)}
            >
              <span>{sectionTitle}</span>
              <SiteIcon name="chevron" className="nav-chevron" />
            </button>
          </div>
          {/* Desktop: one row that scrolls when it does not fit — wheel, drag, or
              cursor position (useDragScroll) — with the first and last items fully
              visible at the ends. Which layout applies is a DEVICE question
              (pointer: coarse), not a width one: a half-screen browser window on a
              desktop is not a phone and keeps this row. */}
          <div className="navstrip" ref={strip}>
            {PRIMARY.map(([r, label]) => (
              <a key={r} href={href(r)} className={isOn(route, r) ? 'on' : ''}>
                {label}
              </a>
            ))}
            {DOCS.map(([r, label]) => (
              <a key={r} href={href(r)} className={`doc${isOn(route, r) ? ' on' : ''}`}>
                {label}
              </a>
            ))}
          </div>
          <SearchButton
            className="searchbtn nav-menu-search"
            expanded={menuMode !== null}
            onClick={(event) => openMenu('site', event.currentTarget, true)}
          />
        </div>
        <div id="page-toc-slot" />
      </nav>
      <div className={route === '/' ? 'home-copy-actions' : undefined}>
        <CopyPage />
      </div>
      <main id="page-content">{page}</main>
      <ReferenceTour />
      <SearchPalette
        mode={menuMode}
        focusSearch={focusSearch}
        route={route}
        pageTitle={pageTitle}
        headings={headings}
        activeHeading={activeHeading}
        onClose={() => setMenuMode(null)}
        onScope={setMenuMode}
        onOpen={() => {
          setFocusSearch(true);
          setMenuMode('site');
        }}
      />
      <HeadingLinks />
      <SnippetActions />
      <DiagramViewer />
    </>
  );
}
