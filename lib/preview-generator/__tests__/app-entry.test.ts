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
});
