import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { buildEntry } from '../preview-build-entry';
import { generatePreviewContent } from '../generator';
import type { PreviewComponentEntry } from '../types';

const root = '/project';

/** Minimal FileIO returning a fixed source for the single component under test. */
function ioWith(source: string): FileIO {
  return {
    async readFile() {
      return source;
    },
    async writeFile() {},
    async access() {},
  };
}

const ROUTED_APP = `
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  import { AuthProvider } from './auth';
  export default function App() {
    return (
      <AuthProvider>
        <BrowserRouter>
          <Routes><Route path="/" element={<Home />} /></Routes>
        </BrowserRouter>
      </AuthProvider>
    );
  }`;

// HYP-45/HYP-16: the SAME routed App, but it is ALSO its own createRoot bootstrap (HyperIDE's
// real client/App.tsx shape — router shell + `createRoot(...).render(<App/>)` in ONE file). The
// preview iframe already runs this bootstrap, so rendering it raw in app-mode A double-mounts it
// → nested <BrowserRouter> → `NotFoundError: removeChild … not a child`.
const SELF_BOOTSTRAP_APP = `
  import { createRoot } from 'react-dom/client';
  import { BrowserRouter, Routes, Route } from 'react-router-dom';
  function App() {
    return (
      <BrowserRouter>
        <Routes><Route path="/" element={<Home />} /></Routes>
      </BrowserRouter>
    );
  }
  createRoot(document.getElementById('root')!).render(<App />);
  export default App;`;

// Provider-only self-bootstrap: createRoot mount + a provider shell, NO router. Self-mounting then
// re-rendering raw would double-fire the provider's consumer hooks (HYP-45/HYP-16 provider sub-case).
const SELF_BOOTSTRAP_PROVIDER_APP = `
  import { createRoot } from 'react-dom/client';
  import { AuthProvider } from './auth';
  function App() { return <AuthProvider><Home /></AuthProvider>; }
  createRoot(document.getElementById('root')!).render(<App />);
  export default App;`;

// HYP-758: real-world App.tsx that imports a *Provider to wrap its own layout content, but
// does NOT forward {children} — it IS a real previewable component, NOT a provider shell.
// Previously excluded by the over-broad detectProviderShell check (any *Provider import →
// excluded), which left it stuck on "Generating sample..." forever. Now correctly entered.
const PROVIDER_CONSUMER_APP = `
  import { TooltipProvider } from '@/components/ui/tooltip';
  import { Sidebar } from '@/components/Sidebar';
  import { FilterBar } from '@/components/FilterBar';
  function App() {
    return (
      <TooltipProvider delayDuration={200}>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <FilterBar />
        </div>
      </TooltipProvider>
    );
  }
  export default App;`;

describe('buildEntry — app-mode opt-in', () => {
  it('rejects a routed/provider App root by default (the reported bug)', async () => {
    const entry = await buildEntry(root, ioWith(ROUTED_APP), undefined, 'client/App.tsx', '/project/client', {
      entryRootPaths: new Set(['client/App']),
    });
    expect(entry).toBeNull();
  });

  it('builds the SAME root as an app entry when its path is in appEntryPaths', async () => {
    const entry = await buildEntry(root, ioWith(ROUTED_APP), undefined, 'client/App.tsx', '/project/client', {
      entryRootPaths: new Set(['client/App']),
      appEntryPaths: new Set(['client/App']),
    });
    expect(entry).not.toBeNull();
    expect(entry?.isAppEntry).toBe(true);
    expect(entry?.componentName).toBe('App');
  });

  it('rejects a @hyperide-managed-patched router root even as an app entry (avoids nested router)', async () => {
    // The vite-spa-jsx-router patcher injects `import CanvasPreview from './__canvas_preview__'`
    // (+ a managed marker) into the router file. Rendering it raw in app-mode would mount its
    // <BrowserRouter> inside the already-mounted app router (the iframe loads at the patched
    // /test-preview route). It must be rejected in BOTH modes.
    const patched = `import CanvasPreview from './__canvas_preview__'; // @hyperide-managed
${ROUTED_APP}`;
    const asApp = await buildEntry(root, ioWith(patched), undefined, 'client/App.tsx', '/project/client', {
      entryRootPaths: new Set(['client/App']),
      appEntryPaths: new Set(['client/App']),
    });
    expect(asApp).toBeNull();
  });

  it('excludes a router self-bootstrap root from app-entry candidacy even when opted in', async () => {
    // HYP-45/HYP-16. A file that is its own createRoot bootstrap AND a router shell is dropped from
    // app-mode A regardless of the appEntryPaths opt-in (the ordering bug froze appEntryPaths before
    // the @hyperide-managed patch landed, so it slipped through to raw render → double-mount). It is
    // dropped from the registry by the router-shell exclusion → app-mode B drives the already-mounted
    // router instead, so no second <App/> mount occurs.
    const entry = await buildEntry(root, ioWith(SELF_BOOTSTRAP_APP), undefined, 'client/App.tsx', '/project/client', {
      entryRootPaths: new Set(['client/App']),
      appEntryPaths: new Set(['client/App']),
    });
    expect(entry).toBeNull();
  });

  it('excludes a PROVIDER-only self-bootstrap root (createRoot + provider, no router) when opted in', async () => {
    // HYP-45/HYP-16, provider-only sub-case: no router, so the router-shell exclusion does not fire;
    // the provider-shell exclusion drops it (entryRootPaths must list the path). A provider-only
    // shell self-mounting then re-rendered raw would double-fire its provider consumer hooks.
    const entry = await buildEntry(
      root,
      ioWith(SELF_BOOTSTRAP_PROVIDER_APP),
      undefined,
      'client/App.tsx',
      '/project/client',
      {
        entryRootPaths: new Set(['client/App']),
        appEntryPaths: new Set(['client/App']),
      },
    );
    expect(entry).toBeNull();
  });

  it('keeps a clean (non-self-bootstrap) routed App as an app entry — no regression of app-mode A', async () => {
    // Contrast: ROUTED_APP has NO createRoot of its own (the mount lives in a separate main.tsx),
    // so it is not a self-bootstrap and must keep going to app-mode A raw render.
    const entry = await buildEntry(root, ioWith(ROUTED_APP), undefined, 'client/App.tsx', '/project/client', {
      entryRootPaths: new Set(['client/App']),
      appEntryPaths: new Set(['client/App']),
    });
    expect(entry).not.toBeNull();
    expect(entry?.isAppEntry).toBe(true);
  });

  it('does not mark unrelated components as app entries', async () => {
    const entry = await buildEntry(
      root,
      ioWith('export default function Button(){return <button/>;}'),
      undefined,
      'src/Button.tsx',
      '/project/src',
      { appEntryPaths: new Set(['client/App']) },
    );
    expect(entry?.isAppEntry).toBeUndefined();
  });

  it('HYP-758: ALLOWS a provider-consumer App.tsx in entryRootPaths (shadcn-linear pattern)', async () => {
    // App.tsx imports TooltipProvider but does NOT forward {children} — it is a real
    // previewable component that uses a provider for its own layout. Before HYP-758 the
    // broad detectProviderShell returned true (any *Provider import = shell) and excluded
    // it, leaving the preview stuck on "Generating sample..." forever. Now it enters the
    // registry and renders normally.
    const entry = await buildEntry(root, ioWith(PROVIDER_CONSUMER_APP), undefined, 'src/App.tsx', '/project/src', {
      entryRootPaths: new Set(['src/App']),
    });
    expect(entry).not.toBeNull();
    expect(entry?.componentName).toBe('App');
  });

  it('HYP-758: still EXCLUDES a pure Providers.tsx wrapper shell in entryRootPaths', async () => {
    // A file that imports *Provider symbols AND exports a component accepting {children}
    // is a true provider-wrapper shell — not a standalone component. Still excluded.
    const providersShell = `
      import { ThemeProvider } from './theme';
      import { QueryClientProvider } from '@tanstack/react-query';
      import type { ReactNode } from 'react';
      export function Providers({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={new QueryClient()}>
            <ThemeProvider>{children}</ThemeProvider>
          </QueryClientProvider>
        );
      }`;
    const entry = await buildEntry(root, ioWith(providersShell), undefined, 'src/providers.tsx', '/project/src', {
      entryRootPaths: new Set(['src/providers']),
    });
    expect(entry).toBeNull();
  });
});

describe('generatePreviewContent — app-mode output', () => {
  const appEntry: PreviewComponentEntry = {
    componentPath: 'client/App.tsx',
    componentName: 'App',
    exportStyle: 'default-named',
    sampleExports: [],
    importPath: './App',
    isAppEntry: true,
  };

  it('emits appEntrySet containing the app entry path', () => {
    const content = generatePreviewContent([appEntry]);
    expect(content).toContain('const appEntrySet = new Set<string>([');
    expect(content).toContain("'client/App.tsx',");
  });

  it('emits both app-mode branches and the route-navigation listener', () => {
    const content = generatePreviewContent([appEntry]);
    // App-mode dispatch + branch A (raw render of a registered app entry)
    expect(content).toContain("if (mode === 'app')");
    expect(content).toContain('if (appEntrySet.has(componentPath) && Component)');
    // App-mode branch B (drive the patched app's own router)
    expect(content).toContain('return <_AppRouteDriver />;');
    expect(content).toContain('function _AppRouteDriver()');
    // Route navigation: host-only source guard + history drive
    expect(content).toContain("e.data?.type !== 'hypercanvas:navigateRoute'");
    expect(content).toContain('e.source !== window.parent');
    expect(content).toContain("window.dispatchEvent(new PopStateEvent('popstate'))");
  });

  it('app-mode B installs a PERSISTENT window-level route listener (survives the driver unmount)', () => {
    const content = generatePreviewContent([appEntry]);
    // The bridge registers a global, idempotent window listener — not a React effect — so that
    // after _AppRouteDriver unmounts (the app router navigates away) the address bar can still
    // drive the app on the 2nd, 3rd, … navigation.
    expect(content).toContain('function _installPersistentRouteListener()');
    expect(content).toContain('__hyperRouteNavInstalled');
    expect(content).toContain('function _AppModeBridge()');
  });

  it('app-mode A also mounts the bridge so the raw app router leaves the /test-preview mount path', () => {
    const content = generatePreviewContent([appEntry]);
    // BOTH branches render <_AppModeBridge />: it drives the app router off /test-preview to the
    // real route on mount (a BrowserRouter app would otherwise match no route), and installs the
    // persistent navigate listener.
    const appBranch = content.slice(content.indexOf("if (mode === 'app')"));
    const rawRenderBlock = appBranch.slice(0, appBranch.indexOf('return <_AppRouteDriver />;'));
    expect(rawRenderBlock).toContain('<_AppModeBridge />');
    expect(rawRenderBlock).toContain('<Component />');
    expect(content).toContain('function _driveInitialAppRoute()');
  });

  it('app entry not present in appEntrySet when isAppEntry is unset', () => {
    const plain: PreviewComponentEntry = { ...appEntry, isAppEntry: undefined };
    const content = generatePreviewContent([plain]);
    expect(content).toContain('const appEntrySet = new Set<string>([\n]);');
  });

  it('route-report cleans the query ONLY on the byte-for-byte bootstrap URL, never after navigation', () => {
    // The reporter must not echo the preview query into the address bar (the mount entry
    // `/?component=client/App.tsx` would otherwise filter every suggestion out of the dropdown). It
    // distinguishes the preview bootstrap from later APP-OWNED URLs by TIME: it snapshots the boot
    // href and reports just the PATH while the URL is still exactly that bootstrap; after ANY app
    // navigation (the URL differs) it reports the search VERBATIM, so every real app param survives
    // (`/gallery?mode=multi`, `/feed?app=1`, duplicates) — codex review. Never suppresses the report.
    const content = generatePreviewContent([appEntry]);
    // The boot-href snapshot is SSR-GUARDED (no module-top-level `window` access) — the module is
    // imported by SSR preview routes (Next/Remix/Astro) where `window` is undefined at load.
    expect(content).toContain(
      "const _hyperBootHref = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';",
    );
    // The UNGUARDED form must never be emitted (it would crash SSR import before React mounts).
    expect(content).not.toContain('const _hyperBootHref = window.location.pathname + window.location.search;');
    // The cleanup is a ONE-SHOT boot phase (a plain boolean — SSR-safe), GATED on the module loading at
    // a harness MOUNT: the mount PATH (root `/` or `/test-preview`, proxy prefix stripped) AND the
    // injected `component` param. A module (re)loading on a real app URL — `/gallery?mode=multi` (no
    // component) OR `/gallery?component=hero` (non-mount path) — never enters boot phase (codex review).
    expect(content).toContain("const _isMountPath = _p === '/' || _p.indexOf('/test-preview') === 0;");
    expect(content).toContain("return _isMountPath && new URLSearchParams(window.location.search).has('component');");
    expect(content).toContain('if (_href !== _hyperBootHref) _hyperInBootPhase = false;');
    expect(content).toContain('const _onBootstrap = _hyperInBootPhase && _href === _hyperBootHref;');
    expect(content).toContain('const full = path + _search + window.location.hash;');
    expect(content).not.toContain('has("component")) return;');
  });

  it('route-report cleaning BEHAVIOR: boot-gate (mount path + component) + one-shot — else verbatim', () => {
    // SYNC mirror of the inline `_reportRouteToHost` boot-gate + cleaning in generator.ts. Proves every
    // case codex raised: a module that LOADS on a real app URL never cleans — whether it has no
    // `component` (`/gallery?mode=multi`) OR a real `?component=hero` on a NON-mount path
    // (`/gallery?component=hero`); after the first navigation the boot phase ends forever; navigating
    // BACK to the exact mount URL is a real route. Real shared-key params (`?mode`, `?app`) survive.
    const makeReporter = (loadPath: string, loadSearch: string) => {
      const bootHref = loadPath + loadSearch;
      const p = loadPath.replace(/^\/project-preview\/[a-fA-F0-9-]+/, '') || '/';
      const isMountPath = p === '/' || p.indexOf('/test-preview') === 0;
      let inBoot = isMountPath && new URLSearchParams(loadSearch.replace(/^\?/, '')).has('component');
      return (pathname: string, search: string): string => {
        const href = pathname + search;
        if (href !== bootHref) inBoot = false;
        return pathname + (inBoot && href === bootHref ? '' : search);
      };
    };
    // Module LOADS on a real app URL → no boot phase → verbatim:
    expect(makeReporter('/gallery', '?mode=multi')('/gallery', '?mode=multi')).toBe('/gallery?mode=multi');
    // …even a real `?component=hero` on a NON-mount path (codex round-9 case):
    expect(makeReporter('/gallery', '?component=hero')('/gallery', '?component=hero')).toBe('/gallery?component=hero');
    // Module loads at the harness mount → first render cleans, then everything verbatim:
    const onMount = makeReporter('/', '?component=client/App.tsx&app=1');
    expect(onMount('/', '?component=client/App.tsx&app=1')).toBe('/'); // untouched mount → path only
    expect(onMount('/gallery', '?mode=multi')).toBe('/gallery?mode=multi'); // real nav → verbatim, phase ends
    expect(onMount('/', '?component=client/App.tsx&app=1')).toBe('/?component=client/App.tsx&app=1'); // back → verbatim
  });
});
