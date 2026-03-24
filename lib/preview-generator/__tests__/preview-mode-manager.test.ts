import { describe, expect, it, mock } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { PreviewModeManager, type WatcherFactory } from '../preview-mode-manager';

/** Minimal FileIO that simulates file presence/absence */
function makeIO(files: Record<string, string> = {}): FileIO {
  return {
    async readFile(p: string) {
      if (p in files) return files[p];
      throw new Error(`ENOENT: ${p}`);
    },
    async writeFile() {},
    async access(p: string) {
      if (p in files) return;
      // Check if it looks like a directory (some paths are accessed as dirs)
      const hasChild = Object.keys(files).some((k) => k.startsWith(`${p}/`));
      if (hasChild) return;
      throw new Error(`ENOENT: ${p}`);
    },
    async deleteFile() {},
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

  it('falls back to entry patching for vite-spa-jsx-router without router file', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
    });
    const m = new PreviewModeManager({ projectRoot: root, io, watcherFactory: noopWatcher });
    const result = await m.onComponentSelected();
    expect(result).toBe('ok');
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
    expect(entry).not.toContain("'__preview', './__canvas_preview__'");

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
