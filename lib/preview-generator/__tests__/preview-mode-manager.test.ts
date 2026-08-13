import { describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { PreviewModeManager, type WatcherFactory } from '../preview-mode-manager';

/** Minimal FileIO that simulates file presence/absence */
function makeIO(initialFiles: Record<string, string> = {}): FileIO {
  const files: Record<string, string> = { ...initialFiles };
  return {
    async readFile(p: string) {
      if (p in files) return files[p];
      throw new Error(`ENOENT: ${p}`);
    },
    async writeFile(p: string, c: string) {
      files[p] = c;
    },
    async access(p: string) {
      if (p in files) return;
      // Check if it looks like a directory (some paths are accessed as dirs)
      const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
      if (hasChild) return;
      throw new Error(`ENOENT: ${p}`);
    },
    async deleteFile(p: string) {
      delete files[p];
    },
  };
}

/** A watcher factory that never fires (tests call onWrapperCreated/Deleted manually) */
const noopWatcher: WatcherFactory = () => () => {};

const root = '/project';

describe('PreviewModeManager — initial mode', () => {
  it('starts in app-shell mode', () => {
    const io = makeIO({ [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }) });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    expect(m.mode).toBe('app-shell');
  });
});

describe('PreviewModeManager — onComponentSelected (app-shell)', () => {
  it('returns ok for Next.js app-router', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '',
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    const result = await m.onComponentSelected();
    expect(result).toBe('ok');
  });

  it('returns unsupported for unknown framework', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { react: '^18' } }),
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    const result = await m.onComponentSelected();
    expect(result).toBe('unsupported');
  });

  it('returns needs-patch for vite-spa-jsx-router when no router and no entry file found', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    const result = await m.onComponentSelected();
    expect(result).toBe('needs-patch');
  });

  it('writes src/pages/test-preview.astro and returns ok for an Astro project (no react-router, no JS entry)', async () => {
    // Mirrors the conloca website: astro dep + astro.config.mjs, no src/pages/, no
    // react-router markers, no src/main.tsx. Before the astro tier this fell into
    // vite-spa-jsx-router → detectRouterFile() null → _detectEntryFile() null → 'needs-patch'.
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { astro: '^6', react: '^19' } }),
      [`${root}/astro.config.mjs`]: 'export default {};',
    };
    const written: string[] = [];
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.push(p);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile() {},
      async mkdir() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    const result = await m.onComponentSelected();

    // Return value AND the actual file write — asserting only the return value would
    // pass even if no route file was generated (getRouteFilePaths default → '' → 'ok').
    expect(result).toBe('ok');
    expect(written).toContain(`${root}/src/pages/test-preview.astro`);
    const routeContent = files[`${root}/src/pages/test-preview.astro`];
    expect(routeContent).toContain('@hyperide-managed');
    expect(routeContent).toContain('client:only="react"');
    expect(routeContent).toContain('CanvasPreview');
  });
});

describe('PreviewModeManager — onComponentSelected (isolated mode)', () => {
  it('returns ok without calling ensurePreviewFiles when already isolated', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '',
      [`${root}/.hyperide/preview.tsx`]: '// user wrapper',
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    // Transition to isolated first
    await m.onWrapperCreated();
    expect(m.mode).toBe('isolated');

    const result = await m.onComponentSelected();
    expect(result).toBe('ok');
  });

  it('updates __canvas_preview_standalone__.tsx when a component is selected in isolated mode', async () => {
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/src/__canvas_preview__.tsx`]:
        'const componentRegistry = {};\nexport default function CanvasPreview() {}\n',
    };
    const written: string[] = [];
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.push(p);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    await m.onWrapperCreated();
    written.length = 0; // Reset after setup

    const result = await m.onComponentSelected();
    expect(result).toBe('ok');
    expect(written).toContain(`${root}/src/__canvas_preview_standalone__.tsx`);
  });
});

describe('PreviewModeManager — mode transitions', () => {
  it('onWrapperCreated switches mode to isolated and calls onModeChange(true)', async () => {
    const onModeChange = mock(() => {});
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
    });
    const m = new PreviewModeManager({ projectRoot: root, io, onModeChange, watcherFactory: noopWatcher });
    await m.onWrapperCreated();
    expect(m.mode).toBe('isolated');
    expect(onModeChange).toHaveBeenCalledWith(true);
  });

  it('onWrapperDeleted switches mode to app-shell and calls onModeChange(false)', async () => {
    const onModeChange = mock(() => {});
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '',
    });
    const m = new PreviewModeManager({ projectRoot: root, io, onModeChange, watcherFactory: noopWatcher });
    // First go to isolated
    await m.onWrapperCreated();
    expect(m.mode).toBe('isolated');

    await m.onWrapperDeleted();
    expect(m.mode).toBe('app-shell');
    expect(onModeChange).toHaveBeenCalledWith(false);
  });
});

describe('PreviewModeManager — Tier 3: Next.js Isolated mode', () => {
  it('onWrapperCreated generates isolated layout.tsx with PreviewWrapper for Next.js', async () => {
    const written = new Map<string, string>();
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '// root layout',
      [`${root}/src/__canvas_preview__.tsx`]: 'export function CanvasPreview() {}',
    };
    // Simulate App Shell having already written a blank layout (the common scenario after
    // user first selects a component, then creates .hyperide/preview.tsx).
    // Without cleanupPreviewFiles() first, _writeIfSafe skips @hyperide-managed files.
    files[`${root}/app/test-preview/layout.tsx`] =
      `// @hyperide-managed\nimport type { ReactNode } from 'react';\nexport default function PreviewLayout({ children }: { children: ReactNode }) {\n  return <>{children}</>;\n}\n`;
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.set(p, c);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile(p: string) {
        delete files[p];
      },
      async mkdir() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    await m.onWrapperCreated();

    const layoutPath = `${root}/app/test-preview/layout.tsx`;
    const layout = written.get(layoutPath);
    expect(layout).toBeDefined();
    expect(layout).toContain('PreviewWrapper');
    expect(layout).toContain('.hyperide/preview');
    // Must not be blank layout
    expect(layout).not.toContain('<>{children}</>');
    expect(m.mode).toBe('isolated');
  });

  it('onWrapperDeleted reverts Next.js isolated layout to blank layout', async () => {
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '// root layout',
      [`${root}/src/__canvas_preview__.tsx`]: 'export function CanvasPreview() {}',
    };
    const written = new Map<string, string>();
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.set(p, c);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile(p: string) {
        delete files[p];
        written.delete(p);
      },
      async mkdir() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    await m.onWrapperCreated();
    await m.onWrapperDeleted();

    const layoutPath = `${root}/app/test-preview/layout.tsx`;
    const layout = written.get(layoutPath);
    expect(layout).toBeDefined();
    // After wrapper deleted, layout should be blank (no PreviewWrapper)
    expect(layout).not.toContain('PreviewWrapper');
    expect(layout).toContain('<>{children}</>');
    expect(m.mode).toBe('app-shell');
  });
});

describe('PreviewModeManager — Astro Isolated mode (HYP-466)', () => {
  /** Build an IO that genuinely deletes (so a route-deletion regression turns the test red). */
  function makeAstroIO(files: Record<string, string>, written: Map<string, string>): FileIO {
    return {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.set(p, c);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile(p: string) {
        delete files[p];
        written.delete(p);
      },
      async mkdir() {},
    };
  }

  const ROUTE_PATH = `${root}/src/pages/test-preview.astro`;
  const PREVIEW_PATH = `${root}/src/__canvas_preview__.tsx`;

  function astroFiles(): Record<string, string> {
    return {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { astro: '^6', react: '^19' } }),
      [`${root}/astro.config.mjs`]: 'export default {};',
      [PREVIEW_PATH]: 'const componentRegistry = {};\nexport default function CanvasPreview() {}\n',
      // App Shell already generated the route (the common scenario before the user
      // creates .hyperide/preview.tsx).
      [ROUTE_PATH]: `---\n// @hyperide-managed\nimport CanvasPreview from '../__canvas_preview__';\n---\n<div id="root"><CanvasPreview client:only="react" /></div>\n`,
      [`${root}/.hyperide/preview.tsx`]: 'export function PreviewWrapper({ children }) { return children; }',
    };
  }

  it('stays in app-shell when a wrapper appears (route preserved, no 404, no proxy swap)', async () => {
    const onModeChange = mock(() => {});
    const files = astroFiles();
    const written = new Map<string, string>();
    const io = makeAstroIO(files, written);
    const m = new PreviewModeManager({ projectRoot: root, io, onModeChange, watcherFactory: noopWatcher });

    await m.onWrapperCreated();

    // Astro does not support isolated mode — it must NOT transition. Entering isolated mode
    // would fire onModeChange(true) → proxy Tier-1 script swap → clobbers the island script
    // with a non-existent __canvas_preview_standalone__.tsx.
    expect(m.mode).toBe('app-shell');
    expect(onModeChange).not.toHaveBeenCalledWith(true);
    // The route file must still exist — Astro 404s a deleted route (no SPA fallback),
    // which would leave the proxy with no HTML entry to serve.
    expect(files[ROUTE_PATH]).toBeDefined();
    expect(files[ROUTE_PATH]).toContain('@hyperide-managed');
  });

  it('round-trips back to App Shell on wrapper deletion (route still present)', async () => {
    const files = astroFiles();
    const written = new Map<string, string>();
    const io = makeAstroIO(files, written);
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });

    await m.onWrapperCreated();
    await m.onWrapperDeleted();

    expect(m.mode).toBe('app-shell');
    // Route still present and back to the plain App Shell island.
    expect(files[ROUTE_PATH]).toBeDefined();
    expect(files[ROUTE_PATH]).toContain('@hyperide-managed');
    expect(files[ROUTE_PATH]).toContain('client:only="react"');
  });
});

describe('PreviewModeManager — Tier 2: Webpack Isolated mode', () => {
  const ENTRY_SOURCE = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
`;

  it('onWrapperCreated patches webpack entry with standalone import', async () => {
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { webpack: '^5', react: '^18' } }),
      [`${root}/src/__canvas_preview__.tsx`]: 'export function CanvasPreview() {}',
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    };
    const written = new Map<string, string>();
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        written.set(p, c);
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile(p: string) {
        delete files[p];
      },
      async mkdir() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    await m.onWrapperCreated();

    // Entry file should be patched with standalone import (not plain __canvas_preview__)
    const entry = written.get(`${root}/src/index.tsx`);
    expect(entry).toBeDefined();
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('__canvas_preview_standalone__');
    expect(entry).not.toContain("'component', './__canvas_preview__'");

    // Standalone entry should be generated
    const standalone = written.get(`${root}/src/__canvas_preview_standalone__.tsx`);
    expect(standalone).toBeDefined();
    expect(standalone).toContain('createRoot');
    expect(standalone).toContain('PreviewWrapper');

    expect(m.mode).toBe('isolated');
  });

  it('onWrapperDeleted reverts Tier 2 patch to App Shell patch (standalone → __canvas_preview__)', async () => {
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { webpack: '^5', react: '^18' } }),
      [`${root}/src/__canvas_preview__.tsx`]: 'export function CanvasPreview() {}',
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        files[p] = c;
      },
      async access(p: string) {
        const exists = p in files || Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (!exists) throw new Error('ENOENT');
      },
      async deleteFile(p: string) {
        delete files[p];
      },
      async mkdir() {},
    };
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    await m.onWrapperCreated();
    await m.onWrapperDeleted();

    const entry = files[`${root}/src/index.tsx`];
    // App Shell mode re-applies entry patch — standalone is replaced with __canvas_preview__
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
    expect(entry).not.toContain('__canvas_preview_standalone__');
    expect(m.mode).toBe('app-shell');
  });
});

describe('PreviewModeManager — startWatching / stopWatching', () => {
  it('startWatching calls watcherFactory and stopWatching disposes it', () => {
    const dispose = mock(() => {});
    const factory: WatcherFactory = mock(() => dispose);
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: factory });
    m.startWatching();
    expect(factory).toHaveBeenCalledTimes(1);
    m.stopWatching();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('stopWatching is safe to call without startWatching', () => {
    const io = makeIO({ [`${root}/package.json`]: '{}' });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    expect(() => m.stopWatching()).not.toThrow();
  });
});

describe('PreviewModeManager — onBeforeWebpackEntryPatch (HYP-363)', () => {
  it('fires before patching the entry file on webpack projects', async () => {
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { 'react-scripts': '^5' } }),
      [`${root}/src/index.tsx`]:
        "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n",
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
    });

    await m.onComponentSelected();

    expect(onBeforeWebpackEntryPatch).toHaveBeenCalledTimes(1);
    // Gate must be armed strictly before any file write happens
    const armIdx = calls.indexOf('arm-gate');
    const firstWriteIdx = calls.findIndex((c) => c.startsWith('write:'));
    expect(armIdx).toBeGreaterThanOrEqual(0);
    expect(firstWriteIdx).toBeGreaterThan(armIdx);
  });

  it('does NOT fire on Vite projects when no preview patch is written', async () => {
    const onBeforeWebpackEntryPatch = mock(() => {});
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
    });
    await m.onComponentSelected();
    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
  });

  it('waits for SPA route update after patching a Vite JSX router file', async () => {
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
      [`${root}/index.html`]: '<script type="module" src="/client/main.tsx"></script>',
      [`${root}/client/App.tsx`]:
        'import { BrowserRouter, Route, Routes } from \'react-router-dom\';\nexport function App() { return <BrowserRouter><Routes><Route path="*" element={<div />} /></Routes></BrowserRouter>; }\n',
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const waitForPreviewRouteUpdate = mock(() => {
      calls.push('wait-route-update');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });

    await m.onComponentSelected();

    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
    const firstWriteIdx = calls.findIndex((c) => c.startsWith('write:'));
    const waitIdx = calls.indexOf('wait-route-update');
    expect(firstWriteIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(firstWriteIdx);
  });

  it('waits without arming the recompile gate after patching a Vite entry file', async () => {
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
      [`${root}/index.html`]: '<script type="module" src="/src/main.tsx"></script>',
      [`${root}/src/main.tsx`]:
        "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById(\"root\")!).render(<App />);\n",
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const waitForPreviewRouteUpdate = mock(() => {
      calls.push('wait-route-update');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });

    await m.onComponentSelected();

    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
    const firstWriteIdx = calls.findIndex((c) => c.startsWith('write:'));
    const waitIdx = calls.indexOf('wait-route-update');
    expect(firstWriteIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(firstWriteIdx);
  });

  it('waits on the route-update barrier (not the webpack gate) after writing Next.js app-router route files', async () => {
    // GitHub #81 — Next (Turbopack) has no post-write compile marker, so the gate
    // deadlocked navigation. See the file-routed case comment in preview-mode-manager.ts
    // for the full rationale. This pins: gate NOT armed, barrier runs after the write.
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^16' } }),
      [`${root}/app/layout.tsx`]: '',
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
      async mkdir() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const waitForPreviewRouteUpdate = mock(() => {
      calls.push('wait-route-update');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });

    await m.onComponentSelected();

    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
    // Barrier must run AFTER the route file write so the iframe doesn't race the route.
    const firstWriteIdx = calls.findIndex((c) => c.startsWith('write:'));
    const waitIdx = calls.indexOf('wait-route-update');
    expect(firstWriteIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(firstWriteIdx);
  });

  it('patches a Bun HTML module entry without arming the webpack recompile gate', async () => {
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({
        scripts: { dev: 'bun --hot src/index.ts' },
        dependencies: { react: '^19' },
      }),
      [`${root}/bun.lock`]: '',
      [`${root}/src/index.html`]: '<script type="module" src="./frontend.tsx" async></script>',
      [`${root}/src/frontend.tsx`]:
        'import { createRoot } from \'react-dom/client\';\nconst app = <div />;\nconst root = createRoot(document.getElementById("root")!);\nroot.render(app);\n',
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const waitForPreviewRouteUpdate = mock(() => {
      calls.push('wait-route-update');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });

    const result = await m.onComponentSelected();

    expect(result).toBe('ok');
    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
    expect(files[`${root}/src/frontend.tsx`]).toContain('@hyperide-managed');
    expect(files[`${root}/src/frontend.tsx`]).toContain('./__canvas_preview__');
    expect(calls).toContain(`write:${root}/src/frontend.tsx`);
    expect(calls.indexOf(`write:${root}/src/frontend.tsx`)).toBeLessThan(calls.indexOf('wait-route-update'));
  });

  it('uses the route-update barrier (not the gate) for Next.js PAGES router too', async () => {
    // Same #81 root cause covers nextjs-pages-router — it shares the file-routed
    // case body and the same Turbopack-no-compile-marker behavior. (App-router is
    // covered by the dedicated barrier test above; this pins the pages-router path.)
    const onBeforeWebpackEntryPatch = mock(() => {});
    const waitForPreviewRouteUpdate = mock(() => {});
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      // pages/_app.tsx → detectFramework resolves nextjs-pages-router
      [`${root}/pages/_app.tsx`]: '',
      // No pages/test-preview.tsx — will be freshly created
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });
    await m.onComponentSelected();
    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
  });

  it('waits without arming the webpack recompile gate after writing Remix route files', async () => {
    const calls: string[] = [];
    const files: Record<string, string> = {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { '@remix-run/react': '^2' } }),
      [`${root}/app/root.tsx`]: 'export default function Root() { return null; }\n',
    };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        calls.push(`write:${p}`);
        files[p] = c;
      },
      async access(p: string) {
        if (p in files) return;
        const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
        if (hasChild) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile() {},
    };
    const onBeforeWebpackEntryPatch = mock(() => {
      calls.push('arm-gate');
    });
    const waitForPreviewRouteUpdate = mock(() => {
      calls.push('wait-route-update');
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });

    await m.onComponentSelected();

    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).toHaveBeenCalledTimes(1);
    const firstWriteIdx = calls.findIndex((c) => c.startsWith('write:'));
    const waitIdx = calls.indexOf('wait-route-update');
    expect(firstWriteIdx).toBeGreaterThanOrEqual(0);
    expect(waitIdx).toBeGreaterThan(firstWriteIdx);
  });

  it('does NOT wait or arm the gate on Next.js when route files already exist (idempotent)', async () => {
    const onBeforeWebpackEntryPatch = mock(() => {});
    // Inject a mock barrier: without it the manager falls back to the real 4s
    // setTimeout default, taxing the suite ~4s on the first (file-writing) call.
    const waitForPreviewRouteUpdate = mock(() => {});
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^14' } }),
      [`${root}/app/layout.tsx`]: '',
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onBeforeWebpackEntryPatch,
      waitForPreviewRouteUpdate,
    });
    // First call writes files → barrier runs once, gate never armed.
    await m.onComponentSelected();
    onBeforeWebpackEntryPatch.mockClear();
    waitForPreviewRouteUpdate.mockClear();
    // Second call — files already exist with same content — no write → neither
    // the barrier nor the gate runs.
    await m.onComponentSelected();
    expect(onBeforeWebpackEntryPatch).not.toHaveBeenCalled();
    expect(waitForPreviewRouteUpdate).not.toHaveBeenCalled();
  });
});

describe('PreviewModeManager — bun app with its own router (HYP-931)', () => {
  // framework-routing.ts classifies some real Bun apps (e.g. a CMS with its own React
  // Router) as 'bun', which assumes router-less by default. This fixture is unambiguously
  // 'bun' (bun.lock + react dep, NO vite dep/config — otherwise it would misclassify as
  // vite-spa-jsx-router and these tests would silently exercise the wrong branch) and has a
  // REAL router file distinct from its entry file, so a discriminating assertion is possible:
  // the router file must get the /test-preview route, and the entry file must be left alone.
  const ROUTER_SOURCE = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
`;
  const ENTRY_SOURCE = `import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
`;

  function bunWithRouterFiles(): Record<string, string> {
    return {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { react: '^18' } }),
      [`${root}/bun.lock`]: '',
      [`${root}/src/App.tsx`]: ROUTER_SOURCE,
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    };
  }

  it('patches the router file (not the entry file) on first component selection', async () => {
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    const result = await m.onComponentSelected();

    expect(result).toBe('ok');
    const appContent = await io.readFile(`${root}/src/App.tsx`);
    // Exact-count, not .toContain — a non-idempotent double-injection would still pass a
    // substring check (review finding, HYP-931).
    expect(appContent.match(/path="\/test-preview"/g)?.length).toBe(1);
    expect(await io.readFile(`${root}/src/index.tsx`)).not.toContain('@hyperide-managed');
  });

  it('restores router-based patching (not entry patching) after an isolated-mode round trip', async () => {
    // onWrapperCreated/onWrapperDeleted exercise _applyPatchIfNeeded — the same bug existed
    // there independently of onComponentSelected, so this round trip must ALSO end up with
    // the router patched, not the entry file, after returning to app-shell mode.
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onWrapperCreated();
    expect(m.mode).toBe('isolated');
    await m.onWrapperDeleted();
    expect(m.mode).toBe('app-shell');

    const appContent = await io.readFile(`${root}/src/App.tsx`);
    expect(appContent.match(/path="\/test-preview"/g)?.length).toBe(1);
    expect(await io.readFile(`${root}/src/index.tsx`)).not.toContain('@hyperide-managed');
  });

  it('falls back to entry-file patching after an isolated-mode round trip when there is no router (regression guard)', async () => {
    // Same round trip as above, but a genuinely router-less bun app (no App.tsx/router.tsx/
    // routes.tsx matching detectRouterFile's candidates) — must still land on entry-file
    // patching, the original correct behavior for a true bun SPA. detectRouterFile() now runs
    // unconditionally for 'bun' in _applyPatchIfNeeded too, so this guards against it silently
    // finding nothing and leaving the app unpatched instead of falling through (review finding,
    // HYP-931).
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { react: '^18' } }),
      [`${root}/bun.lock`]: '',
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onWrapperCreated();
    expect(m.mode).toBe('isolated');
    await m.onWrapperDeleted();
    expect(m.mode).toBe('app-shell');

    const entry = await io.readFile(`${root}/src/index.tsx`);
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
  });
});
