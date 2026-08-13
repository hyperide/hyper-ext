import { describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { PreviewFileManager } from '../preview-file-manager';
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

  it('a second onComponentSelected keeps the entry file clean (already-present route is not an entry-file fallback, HYP-934)', async () => {
    // The extension's file watcher re-fires onComponentSelected() on the router file's own patch
    // write, so a second selection is routine. patchRouterConfig() returns 'already-present' (not
    // 'written') on that second run — which must NOT be mistaken for an unpatchable file, or the
    // entry file gets managed too and the routed app shell is bypassed (codex review finding).
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    expect(await m.onComponentSelected()).toBe('ok');
    expect(await m.onComponentSelected()).toBe('ok');

    const appContent = await io.readFile(`${root}/src/App.tsx`);
    // Still exactly one managed route, and the entry file is never touched.
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

describe('PreviewModeManager — data-router app with no literal <Routes> (HYP-934)', () => {
  // detectRouterFile() matches on createBrowserRouter/createHashRouter/createMemoryRouter as
  // well as a literal <Routes>, but patchRouterConfig() can only inject a <Route> into a
  // literal <Routes> JSX element. A react-router v6.4+ data-router (createBrowserRouter([...])
  // + <RouterProvider>, NO <Routes>) therefore MATCHES detection but patchRouterConfig() no-ops
  // (console.warn + returns false). Before the fix both call sites ignored that false and
  // reported success, leaving the app unpatched (no /test-preview route, no entry-file
  // fallback). The fix falls back to entry-file patching when patchRouterConfig() returns false.
  const DATA_ROUTER_SOURCE = `import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Home } from './pages/Home';

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
`;
  const ENTRY_SOURCE = `import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
`;

  function viteDataRouterFiles(): Record<string, string> {
    return {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5', 'react-router-dom': '^6' } }),
      [`${root}/index.html`]: '<script type="module" src="/src/main.tsx"></script>',
      [`${root}/src/App.tsx`]: DATA_ROUTER_SOURCE,
      [`${root}/src/main.tsx`]: ENTRY_SOURCE,
    };
  }

  function bunDataRouterFiles(): Record<string, string> {
    return {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { react: '^18', 'react-router-dom': '^6' } }),
      [`${root}/bun.lock`]: '',
      [`${root}/src/App.tsx`]: DATA_ROUTER_SOURCE,
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    };
  }

  it('detectRouterFile() matches a data router (createBrowserRouter) but patchRouterConfig() no-ops on it', async () => {
    const io = makeIO(viteDataRouterFiles());
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    // The premise of the bug: detection MATCHES (so the router branch is taken)...
    expect(await m.detectRouterFile()).toBe(`${root}/src/App.tsx`);
    // ...but the JSX-<Routes> injector cannot patch it and leaves it untouched.
    const fileManager = new PreviewFileManager({ projectRoot: root, io });
    expect(await fileManager.patchRouterConfig(`${root}/src/App.tsx`)).toBe('no-routes');
    expect(await io.readFile(`${root}/src/App.tsx`)).not.toContain('@hyperide-managed');
  });

  it('onComponentSelected falls back to entry-file patching for a vite data-router app', async () => {
    const io = makeIO(viteDataRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    const result = await m.onComponentSelected();

    expect(result).toBe('ok');
    // Entry file gets the App-Shell fallback patch...
    const entry = await io.readFile(`${root}/src/main.tsx`);
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
    // ...and the un-patchable router file is left completely alone.
    const app = await io.readFile(`${root}/src/App.tsx`);
    expect(app).not.toContain('@hyperide-managed');
    expect(app).not.toContain('/test-preview');
  });

  it('onComponentSelected falls back to entry-file patching for a bun data-router app', async () => {
    const io = makeIO(bunDataRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    const result = await m.onComponentSelected();

    expect(result).toBe('ok');
    const entry = await io.readFile(`${root}/src/index.tsx`);
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
    const app = await io.readFile(`${root}/src/App.tsx`);
    expect(app).not.toContain('@hyperide-managed');
    expect(app).not.toContain('/test-preview');
  });

  it('falls back to entry-file patching for a vite data-router app after an isolated-mode round trip', async () => {
    const io = makeIO(viteDataRouterFiles());
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

    const entry = await io.readFile(`${root}/src/main.tsx`);
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
    expect(await io.readFile(`${root}/src/App.tsx`)).not.toContain('@hyperide-managed');
  });

  it('falls back to entry-file patching for a bun data-router app after an isolated-mode round trip', async () => {
    const io = makeIO(bunDataRouterFiles());
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
    expect(await io.readFile(`${root}/src/App.tsx`)).not.toContain('@hyperide-managed');
  });

  it('vite data-router entry fallback awaits the barrier before onModeChange(false) and does not arm the webpack gate (HYP-934 review)', async () => {
    // On the isolated→app-shell round trip a vite data-router falls back to entry-file patching.
    // That fallback must use the same options as onComponentSelected: never arm the webpack
    // recompile gate (vite emits no webpack marker) and await the HMR barrier before the
    // extension is told the mode changed and refreshes the iframe.
    const order: string[] = [];
    const io = makeIO(viteDataRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onModeChange: (isolated: boolean) => order.push(`mode-change:${isolated}`),
      onBeforeWebpackEntryPatch: () => order.push('arm-gate'),
      waitForPreviewRouteUpdate: mock(() => {
        order.push('wait-route-update');
      }),
    });

    await m.onWrapperCreated();
    await m.onWrapperDeleted();

    expect(order).not.toContain('arm-gate');
    const waitIdx = order.indexOf('wait-route-update');
    const modeFalseIdx = order.indexOf('mode-change:false');
    expect(waitIdx).toBeGreaterThanOrEqual(0);
    expect(modeFalseIdx).toBeGreaterThan(waitIdx);
  });

  const LITERAL_ROUTES_SOURCE = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App() {
  return <BrowserRouter><Routes><Route path="/" element={<div />} /></Routes></BrowserRouter>;
}
`;

  it('reverts the stale entry patch when a data-router app is converted to a literal <Routes> (HYP-934 review)', async () => {
    // Data-router first selection → entry-file fallback (entry managed). The user then converts
    // createBrowserRouter([...]) into a literal <Routes>. The next selection must patch the router
    // AND drop the now-stale entry patch, or the entry redirect keeps bypassing the routed shell.
    const io = makeIO(viteDataRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    expect(await io.readFile(`${root}/src/main.tsx`)).toContain('@hyperide-managed');

    await io.writeFile(`${root}/src/App.tsx`, LITERAL_ROUTES_SOURCE);
    await m.onComponentSelected();

    // Router now managed, entry patch dropped — exactly one strategy is active.
    expect((await io.readFile(`${root}/src/App.tsx`)).match(/path="\/test-preview"/g)?.length).toBe(1);
    expect(await io.readFile(`${root}/src/main.tsx`)).not.toContain('@hyperide-managed');
  });

  it('waits for HMR after reverting the stale entry patch, so the LAST write is barriered (HYP-934 review)', async () => {
    // The stale-entry revert is a later write than the router patch. The route-update barrier must
    // fire AFTER that revert write, or the extension navigates while the dev server still serves
    // the old entry patch. Instrument writes + waits and assert the ordering on the transition.
    const order: string[] = [];
    const files: Record<string, string> = { ...viteDataRouterFiles() };
    const io: FileIO = {
      async readFile(p: string) {
        if (p in files) return files[p];
        throw new Error(`ENOENT: ${p}`);
      },
      async writeFile(p: string, c: string) {
        files[p] = c;
        order.push(`write:${p.replace(root, '')}`);
      },
      async access(p: string) {
        if (p in files) return;
        if (Object.keys(files).some((k) => k.startsWith(`${p}/`))) return;
        throw new Error(`ENOENT: ${p}`);
      },
      async deleteFile(p: string) {
        delete files[p];
      },
    };
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {
        order.push('wait');
      }),
    });

    await m.onComponentSelected(); // data-router → entry fallback (entry managed)
    files[`${root}/src/App.tsx`] = LITERAL_ROUTES_SOURCE;
    order.length = 0; // only care about the transition selection
    await m.onComponentSelected(); // <Routes> → router patch + stale-entry revert

    const lastEntryWrite = order.lastIndexOf('write:/src/main.tsx');
    const lastWait = order.lastIndexOf('wait');
    expect(lastEntryWrite).toBeGreaterThanOrEqual(0);
    expect(lastWait).toBeGreaterThan(lastEntryWrite);
  });

  it('reverts the stale router patch when a <Routes> app is converted to a data router (HYP-934 review)', async () => {
    // Reverse transition: <Routes> first selection → router managed. The user converts it to a
    // createBrowserRouter data router. The next selection must fall back to entry-file patching
    // AND drop the now-dangling managed router import.
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5', 'react-router-dom': '^6' } }),
      [`${root}/index.html`]: '<script type="module" src="/src/main.tsx"></script>',
      [`${root}/src/App.tsx`]: LITERAL_ROUTES_SOURCE,
      [`${root}/src/main.tsx`]: ENTRY_SOURCE,
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    expect(await io.readFile(`${root}/src/App.tsx`)).toContain('@hyperide-managed');
    expect(await io.readFile(`${root}/src/main.tsx`)).not.toContain('@hyperide-managed');

    await io.writeFile(`${root}/src/App.tsx`, DATA_ROUTER_SOURCE);
    await m.onComponentSelected();

    // Entry now managed (fallback), router patch reverted — exactly one strategy is active.
    expect(await io.readFile(`${root}/src/main.tsx`)).toContain('@hyperide-managed');
    expect(await io.readFile(`${root}/src/App.tsx`)).not.toContain('@hyperide-managed');
  });

  it('awaits the route-update barrier before onModeChange(false) when _applyPatchIfNeeded patches a real <Routes> router (HYP-934 gap 3)', async () => {
    // A genuinely patchable JSX <Routes> bun app. On the isolated→app-shell round trip
    // _applyPatchIfNeeded patches the router; the barrier must be awaited before the extension
    // is told the mode changed (onModeChange(false)), matching onComponentSelected's ordering.
    const order: string[] = [];
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { react: '^18', 'react-router-dom': '^6' } }),
      [`${root}/bun.lock`]: '',
      [`${root}/src/App.tsx`]: `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div />} />
      </Routes>
    </BrowserRouter>
  );
}
`,
      [`${root}/src/index.tsx`]: ENTRY_SOURCE,
    });
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      onModeChange: (isolated: boolean) => order.push(`mode-change:${isolated}`),
      waitForPreviewRouteUpdate: mock(() => {
        order.push('wait-route-update');
      }),
    });

    await m.onWrapperCreated();
    await m.onWrapperDeleted();

    const waitIdx = order.indexOf('wait-route-update');
    const modeFalseIdx = order.indexOf('mode-change:false');
    expect(waitIdx).toBeGreaterThanOrEqual(0);
    expect(modeFalseIdx).toBeGreaterThan(waitIdx);
  });
});

describe('PreviewModeManager — custom (non-react-router) router app falls back to entry patching (conloca WorkspaceRouter, HYP-934)', () => {
  // conloca-app is a Vite SPA whose App renders a bespoke history/subdomain-based
  // <WorkspaceRouter> — it imports NO react-router and has none of detectRouterFile's markers
  // (<Routes>/<BrowserRouter>/createBrowserRouter/…). detectRouterFile() therefore returns null
  // and the app correctly uses entry-file patching. This locks in that a custom-router app is
  // never mistaken for a react-router app and never left unpatched.
  const CUSTOM_ROUTER_APP = `import WorkspaceRouter from './workspace/WorkspaceRouter';

export default function App() {
  const bootstrap = useBootstrap();
  return <WorkspaceRouter bootstrap={bootstrap} />;
}
`;
  const ENTRY_SOURCE = `import { createRoot } from 'react-dom/client';
import App from './app/App';

createRoot(document.getElementById('root')!).render(<App />);
`;

  function conlocaLikeFiles(): Record<string, string> {
    return {
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
      [`${root}/index.html`]: '<script type="module" src="/src/main.tsx"></script>',
      [`${root}/src/app/App.tsx`]: CUSTOM_ROUTER_APP,
      [`${root}/src/main.tsx`]: ENTRY_SOURCE,
    };
  }

  it('detectRouterFile() returns null for a custom router app (no react-router markers)', async () => {
    const io = makeIO(conlocaLikeFiles());
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    expect(await m.detectRouterFile()).toBeNull();
  });

  it('onComponentSelected patches the entry file (not the App) for a custom router app', async () => {
    const io = makeIO(conlocaLikeFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    const result = await m.onComponentSelected();

    expect(result).toBe('ok');
    const entry = await io.readFile(`${root}/src/main.tsx`);
    expect(entry).toContain('@hyperide-managed');
    expect(entry).toContain('./__canvas_preview__');
    expect(await io.readFile(`${root}/src/app/App.tsx`)).not.toContain('@hyperide-managed');
  });
});

// HYP-945: a crash between the @hyperide-managed router-patch injection and the canvas-preview
// swap used to leave the target app's OWN tracked source dirty. The manager now snapshots the
// pre-injection bytes and reverts on any crash/teardown. Self-contained fixtures (this block was
// relocated out of the HYP-931 describe during the HYP-934 merge).
describe('PreviewModeManager — crash-revert of managed injections (HYP-945)', () => {
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

  it('reverts the injected router patch byte-identical on crash/teardown (snapshot restore, HYP-945)', async () => {
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    // Sanity: the injection actually landed in the target's own App.tsx.
    expect(await io.readFile(`${root}/src/App.tsx`)).toContain('@hyperide-managed');

    // Simulate a crash/teardown BETWEEN injection and the canvas-preview swap.
    await m.revertManagedInjections();

    // The target app's own source is byte-identical to pre-injection — nothing left
    // dirty in the client working tree, and the untouched entry file is unchanged.
    expect(await io.readFile(`${root}/src/App.tsx`)).toBe(ROUTER_SOURCE);
    expect(await io.readFile(`${root}/src/index.tsx`)).toBe(ENTRY_SOURCE);
  });

  it('sweeps a stale injection a prior crashed session left behind with no snapshot (startup sweep, HYP-945)', async () => {
    const io = makeIO(bunWithRouterFiles());
    const opts = {
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    };

    // Session 1 injects, then hard-crashes: its in-memory snapshot dies with the process.
    const crashed = new PreviewModeManager(opts);
    await crashed.onComponentSelected();
    expect(await io.readFile(`${root}/src/App.tsx`)).toContain('@hyperide-managed');

    // Session 2 activates fresh — owns NO snapshot, so it must AST-revert the stale marker.
    const fresh = new PreviewModeManager(opts);
    await fresh.revertManagedInjections();

    const app = await io.readFile(`${root}/src/App.tsx`);
    expect(app).not.toContain('@hyperide-managed');
    expect(app).not.toContain('/test-preview');
    // The user's own route + router survive the sweep.
    expect(app).toContain('path="/"');
    expect(app).toContain('BrowserRouter');
  });

  it('is a safe no-op when nothing was ever injected', async () => {
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.revertManagedInjections();

    expect(await io.readFile(`${root}/src/App.tsx`)).toBe(ROUTER_SOURCE);
    expect(await io.readFile(`${root}/src/index.tsx`)).toBe(ENTRY_SOURCE);
  });

  it('preserves a user edit made on top of a live injection (surgical AST revert, not byte-clobber, HYP-945)', async () => {
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();

    // The user adds their own route WHILE the injection is live — now the file differs
    // from what we wrote, so the pre-injection snapshot must NOT be restored over it.
    const injected = await io.readFile(`${root}/src/App.tsx`);
    const edited = injected.replace(
      '<Route path="/" element={<Home />} />',
      '<Route path="/" element={<Home />} />\n        <Route path="/dashboard" element={<Home />} />',
    );
    expect(edited).not.toBe(injected); // guard: the replace actually landed
    await io.writeFile(`${root}/src/App.tsx`, edited);

    await m.revertManagedInjections();

    const result = await io.readFile(`${root}/src/App.tsx`);
    expect(result).toContain('path="/dashboard"'); // the user's edit survived
    expect(result).not.toContain('@hyperide-managed'); // our injection was stripped
    expect(result).not.toContain('/test-preview');
  });

  it('reverts an injected ENTRY-file patch byte-identical on crash/teardown (router-less bun/webpack tier, HYP-945)', async () => {
    // Exercises the _applyEntryPatch snapshot path — a distinct code branch from the
    // router path above. Router-less bun app → entry-file patching.
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

    await m.onComponentSelected();
    expect(await io.readFile(`${root}/src/index.tsx`)).toContain('@hyperide-managed');

    await m.revertManagedInjections();

    expect(await io.readFile(`${root}/src/index.tsx`)).toBe(ENTRY_SOURCE);
  });

  it('re-captures a fresh baseline across a patch → revert → patch cycle (HYP-945)', async () => {
    // The snapshot is dropped on every revert, so a second patch must snapshot a fresh
    // pristine baseline — otherwise a later crash-revert would restore stale bytes.
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    await m.revertManagedInjections();
    expect(await io.readFile(`${root}/src/App.tsx`)).toBe(ROUTER_SOURCE);

    // Second cycle — the injection is fresh, and the crash-revert still lands byte-identical.
    await m.onComponentSelected();
    expect(await io.readFile(`${root}/src/App.tsx`)).toContain('@hyperide-managed');
    await m.revertManagedInjections();
    expect(await io.readFile(`${root}/src/App.tsx`)).toBe(ROUTER_SOURCE);
  });

  it('does not resurrect pre-injection bytes when the user already removed the marker (git discard, HYP-945)', async () => {
    const io = makeIO(bunWithRouterFiles());
    const m = new PreviewModeManager({
      projectRoot: root,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    // User runs `git discard` on the injected file, restoring it themselves. The snapshot's
    // `after` no longer matches disk, so revert must leave the current bytes untouched.
    await io.writeFile(`${root}/src/App.tsx`, ROUTER_SOURCE);

    await m.revertManagedInjections();

    expect(await io.readFile(`${root}/src/App.tsx`)).toBe(ROUTER_SOURCE);
  });
});
