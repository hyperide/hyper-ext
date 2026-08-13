/**
 * @file Preview revival after window reload (HYP-1164) — unit tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/preview-revival.test.ts
 * Assumptions: the orchestration is vscode-free; extension.ts injects memento,
 *   dev-server, panel, and StateHub seams. All collaborators are mocked here.
 * Architecture: after workbench.action.reloadWindow the extension host restarts
 *   with zero in-memory state; the revived webview panel must re-apply the
 *   persisted component selection and re-attach (HYP-1160 attach-first) or
 *   respawn the dev server so the iframe URL is pushed without manual re-open.
 */

import { describe, expect, it, mock } from 'bun:test';
import {
  clearPreviewRevivalSnapshot,
  persistPreviewRevivalSnapshot,
  PREVIEW_REVIVAL_STATE_KEY,
  readPreviewRevivalSnapshot,
  revivePreviewAfterReload,
  type PreviewRevivalDeps,
  type PreviewRevivalSnapshot,
  type RevivalMemento,
} from '../services/preview-revival';

export interface FakeMemento extends RevivalMemento {
  store: Map<string, unknown>;
}

function createMemento(initial?: unknown): FakeMemento {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set(PREVIEW_REVIVAL_STATE_KEY, initial);
  return {
    store,
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
      return Promise.resolve();
    },
  };
}

const SNAPSHOT: PreviewRevivalSnapshot = {
  component: { name: 'Button', path: 'packages/ui/src/Button.tsx' },
  projectPath: '/repo',
  url: 'http://localhost:3000',
  savedAt: 1_700_000_000_000,
};

interface Harness {
  deps: PreviewRevivalDeps;
  calls: string[];
  memento: FakeMemento;
  startDevServer: ReturnType<typeof mock>;
  setPreviewUrl: ReturnType<typeof mock>;
  reselectComponent: ReturnType<typeof mock>;
  reroot: ReturnType<typeof mock>;
}

function createHarness(opts?: {
  snapshot?: unknown;
  activeProjectRoot?: string;
  startResult?: { status: string; url?: string | null };
  startError?: Error;
}): Harness {
  const calls: string[] = [];
  const memento = createMemento(opts && 'snapshot' in opts ? opts.snapshot : SNAPSHOT);
  const reroot = mock((target: string) => {
    calls.push(`reroot:${target}`);
    return Promise.resolve();
  });
  const startDevServer = mock(() => {
    calls.push('start');
    if (opts?.startError) return Promise.reject(opts.startError);
    return Promise.resolve(opts?.startResult ?? { status: 'running', url: 'http://localhost:3000' });
  });
  const setPreviewUrl = mock((url: string) => {
    calls.push(`setPreviewUrl:${url}`);
  });
  const reselectComponent = mock((c: { name: string; path: string }) => {
    calls.push(`reselect:${c.path}`);
  });
  const deps: PreviewRevivalDeps = {
    memento,
    getActiveProjectRoot: () => opts?.activeProjectRoot ?? '/repo',
    rerootPreviewPipeline: reroot,
    startDevServer,
    setPreviewUrl,
    reselectComponent,
  };
  return { deps, calls, memento, startDevServer, setPreviewUrl, reselectComponent, reroot };
}

describe('snapshot persistence', () => {
  it('round-trips a snapshot through the memento under the revival key', () => {
    const memento = createMemento();
    persistPreviewRevivalSnapshot(memento, SNAPSHOT);
    expect(memento.store.get(PREVIEW_REVIVAL_STATE_KEY)).toEqual(SNAPSHOT);
    expect(readPreviewRevivalSnapshot(memento)).toEqual(SNAPSHOT);
  });

  it('clearPreviewRevivalSnapshot removes the key', () => {
    const memento = createMemento();
    persistPreviewRevivalSnapshot(memento, SNAPSHOT);
    clearPreviewRevivalSnapshot(memento);
    expect(readPreviewRevivalSnapshot(memento)).toBeUndefined();
  });

  it('rejects snapshots without a component path', () => {
    expect(readPreviewRevivalSnapshot(createMemento({ projectPath: '/repo' }))).toBeUndefined();
    expect(
      readPreviewRevivalSnapshot(createMemento({ component: { name: 'X', path: '' }, projectPath: '/repo' })),
    ).toBeUndefined();
  });

  it('rejects snapshots without a projectPath', () => {
    expect(readPreviewRevivalSnapshot(createMemento({ component: { name: 'X', path: 'a/b.tsx' } }))).toBeUndefined();
  });

  it('rejects non-object garbage in the memento', () => {
    expect(readPreviewRevivalSnapshot(createMemento('not-an-object'))).toBeUndefined();
    expect(readPreviewRevivalSnapshot(createMemento(42))).toBeUndefined();
  });
});

describe('revivePreviewAfterReload', () => {
  it('returns no-snapshot and touches nothing when nothing was persisted', async () => {
    const { deps, startDevServer, reselectComponent, setPreviewUrl } = createHarness({ snapshot: undefined });
    // createMemento with explicit undefined stores nothing
    const outcome = await revivePreviewAfterReload(deps);
    expect(outcome).toBe('no-snapshot');
    expect(reselectComponent).not.toHaveBeenCalled();
    expect(startDevServer).not.toHaveBeenCalled();
    expect(setPreviewUrl).not.toHaveBeenCalled();
  });

  it('restores a single-package preview: reselect, start, setPreviewUrl — no reroot', async () => {
    const { deps, calls, reroot } = createHarness({ activeProjectRoot: '/repo' });
    const outcome = await revivePreviewAfterReload(deps);
    expect(outcome).toBe('restored');
    expect(reroot).not.toHaveBeenCalled();
    expect(calls).toEqual(['reselect:packages/ui/src/Button.tsx', 'start', 'setPreviewUrl:http://localhost:3000']);
  });

  it('re-roots to the persisted monorepo sub-project BEFORE starting the dev server', async () => {
    const snapshot: PreviewRevivalSnapshot = { ...SNAPSHOT, projectPath: '/repo/apps/web' };
    const { deps, calls } = createHarness({ snapshot, activeProjectRoot: '/repo' });
    const outcome = await revivePreviewAfterReload(deps);
    expect(outcome).toBe('restored');
    const rerootIdx = calls.indexOf('reroot:/repo/apps/web');
    expect(rerootIdx).toBeGreaterThanOrEqual(0);
    expect(rerootIdx).toBeLessThan(calls.indexOf('start'));
    expect(calls[calls.length - 1]).toBe('setPreviewUrl:http://localhost:3000');
  });

  it('reselects the component BEFORE starting the dev server so the pipeline can re-root concurrently', async () => {
    const { deps, calls } = createHarness();
    await revivePreviewAfterReload(deps);
    expect(calls.indexOf('reselect:packages/ui/src/Button.tsx')).toBeLessThan(calls.indexOf('start'));
  });

  it('returns server-failed without pushing a URL when the server ends in error', async () => {
    const { deps, setPreviewUrl, reselectComponent } = createHarness({
      startResult: { status: 'error', url: null },
    });
    const outcome = await revivePreviewAfterReload(deps);
    expect(outcome).toBe('server-failed');
    expect(setPreviewUrl).not.toHaveBeenCalled();
    // The selection was still re-applied so a manual start lands on the right component.
    expect(reselectComponent).toHaveBeenCalledTimes(1);
  });

  it('returns server-failed when running comes back without a URL', async () => {
    const { deps, setPreviewUrl } = createHarness({ startResult: { status: 'running', url: null } });
    expect(await revivePreviewAfterReload(deps)).toBe('server-failed');
    expect(setPreviewUrl).not.toHaveBeenCalled();
  });

  it('returns server-failed when start() rejects (spawn failure)', async () => {
    const { deps, setPreviewUrl } = createHarness({ startError: new Error('No dev or start script found') });
    expect(await revivePreviewAfterReload(deps)).toBe('server-failed');
    expect(setPreviewUrl).not.toHaveBeenCalled();
  });

  it('treats a corrupt persisted snapshot as no-snapshot', async () => {
    const { deps, startDevServer } = createHarness({ snapshot: '{"broken' });
    expect(await revivePreviewAfterReload(deps)).toBe('no-snapshot');
    expect(startDevServer).not.toHaveBeenCalled();
  });
});
