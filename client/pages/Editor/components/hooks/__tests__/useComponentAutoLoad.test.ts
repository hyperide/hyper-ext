/**
 * Tests the exported pure functions that useComponentAutoLoad uses internally.
 * Covers the race-condition fix (HYP-224): server returning success: false
 * must NOT mark components as loaded, allowing retry on next event.
 *
 * Also covers the stale-in-flight guard (HYP-227): a slow fetch for the previously
 * active project must NOT auto-load its components after the active project switched.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { ComponentsAPIResponse } from '@/utils/fetchComponents';

// ── Mocks (must precede the hook import so the mocked module is bound) ──────────
// Control fetch resolution timing so we can interleave a slow project-A fetch with
// a fast project-B fetch and resolve A last.
const fetchComponentsJSON = mock(
  (_projectId: string | null): Promise<ComponentsAPIResponse> => Promise.resolve({ success: true }),
);
mock.module('@/utils/fetchComponents', () => ({
  fetchComponentsJSON,
  cancelComponentsFetch: mock(),
}));
mock.module('@/lib/storage', () => ({
  loadPersistedState: () => ({ openedComponent: null }),
}));

import { useProjectActivationStore } from '@/stores/projectActivationStore';
import {
  type AvailableComponents,
  type ComponentInfo,
  flattenComponentGroups,
  hasNoRenderableComponents,
  isEntryPoint,
  selectComponentToLoad,
  useComponentAutoLoad,
} from '../useComponentAutoLoad';

/** A success payload tagging its single atom with the owning project, so we can
 *  tell which project's components were loaded. */
function payloadFor(project: string): ComponentsAPIResponse {
  return {
    success: true,
    atomGroups: [{ dirPath: project, components: [{ name: project, path: `${project}.tsx` }] }],
    compositeGroups: [],
    pageGroups: [],
  };
}

describe('flattenComponentGroups', () => {
  it('returns null when server reports failure', () => {
    const result = flattenComponentGroups({ success: false });
    expect(result).toBeNull();
  });

  it('returns null for "No active project" error', () => {
    const result = flattenComponentGroups({
      success: false,
      atomGroups: [],
      compositeGroups: [],
    });
    expect(result).toBeNull();
  });

  it('flattens grouped components into flat arrays', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [
        { dirPath: 'src', components: [{ name: 'Button', path: 'src/Button.tsx' }] },
        { dirPath: 'src', components: [{ name: 'Input', path: 'src/Input.tsx' }] },
      ],
      compositeGroups: [{ dirPath: 'src', components: [{ name: 'Form', path: 'src/Form.tsx' }] }],
    });

    expect(result).toEqual({
      atoms: [
        { name: 'Button', path: 'src/Button.tsx' },
        { name: 'Input', path: 'src/Input.tsx' },
      ],
      composites: [{ name: 'Form', path: 'src/Form.tsx' }],
      pages: [],
    });
  });

  // HYP-680: pages are a renderable category — must not be dropped on the floor.
  it('flattens pageGroups so a page-only project exposes its page', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [],
      compositeGroups: [],
      pageGroups: [{ dirPath: 'src', components: [{ name: 'App.tsx', path: 'src/App.tsx' }] }],
    });

    expect(result).toEqual({
      atoms: [],
      composites: [],
      pages: [{ name: 'App.tsx', path: 'src/App.tsx' }],
    });
  });

  // HYP-680 / Codex P2: monorepos leave flat pageGroups empty and carry pages under
  // subProjects[].pageGroups. A page-only monorepo app must still surface its page.
  it('folds sub-project pageGroups into pages for monorepos', () => {
    const result = flattenComponentGroups({
      success: true,
      isMonorepo: true,
      atomGroups: [],
      compositeGroups: [],
      pageGroups: [],
      subProjects: [
        {
          name: 'web',
          path: 'apps/web',
          supported: true,
          atomGroups: [],
          compositeGroups: [],
          pageGroups: [{ dirPath: 'apps/web/src', components: [{ name: 'App.tsx', path: 'apps/web/src/App.tsx' }] }],
        },
      ],
    });

    expect(result).toEqual({
      atoms: [],
      composites: [],
      pages: [{ name: 'App.tsx', path: 'apps/web/src/App.tsx' }],
    });
  });

  it('handles missing groups gracefully', () => {
    const result = flattenComponentGroups({ success: true });
    expect(result).toEqual({ atoms: [], composites: [], pages: [] });
  });

  it('handles empty groups', () => {
    const result = flattenComponentGroups({
      success: true,
      atomGroups: [],
      compositeGroups: [],
    });
    expect(result).toEqual({ atoms: [], composites: [], pages: [] });
  });
});

// HYP-680: the NoComponentOverlay gate. Pages are renderable, so a page-only
// project must render the page — NOT show the "no components" overlay.
describe('hasNoRenderableComponents', () => {
  const make = (over: Partial<AvailableComponents>): AvailableComponents => ({
    atoms: [],
    composites: [],
    pages: [],
    isLoaded: true,
    ...over,
  });

  it('is true when there are no atoms, composites, or pages', () => {
    expect(hasNoRenderableComponents(make({}))).toBe(true);
  });

  it('is false when only pages exist (page-only project must render)', () => {
    expect(hasNoRenderableComponents(make({ pages: [{ name: 'App.tsx', path: 'src/App.tsx' }] }))).toBe(false);
  });

  it('is false when atoms exist', () => {
    expect(hasNoRenderableComponents(make({ atoms: [{ name: 'Button', path: 'src/Button.tsx' }] }))).toBe(false);
  });

  it('is false when composites exist', () => {
    expect(hasNoRenderableComponents(make({ composites: [{ name: 'Form', path: 'src/Form.tsx' }] }))).toBe(false);
  });
});

describe('isEntryPoint', () => {
  it.each(['main.tsx', 'index.ts', '_app.jsx', 'Main.TSX', 'INDEX.js'])('returns true for %s', (name) => {
    expect(isEntryPoint(name)).toBe(true);
  });

  it.each(['Button.tsx', 'Header.ts', 'App.tsx', 'main-layout.tsx'])('returns false for %s', (name) => {
    expect(isEntryPoint(name)).toBe(false);
  });
});

describe('selectComponentToLoad', () => {
  const atoms: ComponentInfo[] = [{ name: 'Button', path: 'src/Button.tsx' }];
  const composites: ComponentInfo[] = [{ name: 'Form', path: 'src/Form.tsx' }];
  const pages: ComponentInfo[] = [{ name: 'App.tsx', path: 'src/App.tsx' }];

  it('restores persisted component when no current component', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: 'src/Button.tsx',
    });
    expect(result).toBe('src/Button.tsx');
  });

  it('restores a persisted page when no current component (HYP-680)', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: 'src/App.tsx',
    });
    expect(result).toBe('src/App.tsx');
  });

  it('ignores persisted component when current component exists', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'Header',
      mode: 'design',
      persistedOpenedComponent: 'src/Button.tsx',
    });
    // Current component is not an entry point, so no auto-select
    expect(result).toBeNull();
  });

  it('prefers composites over atoms for auto-select', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Form.tsx');
  });

  it('falls back to first atom when no composites', () => {
    const result = selectComponentToLoad({
      atoms,
      composites: [],
      pages: [],
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Button.tsx');
  });

  // HYP-680: a page-only project (no atoms, no composites) must auto-render its page.
  it('auto-selects a page when there are no atoms or composites', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages,
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/App.tsx');
  });

  it('returns null when no components available', () => {
    const result = selectComponentToLoad({
      atoms: [],
      composites: [],
      pages: [],
      currentComponentName: undefined,
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });

  it('skips auto-select in code mode', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: undefined,
      mode: 'code',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });

  it('auto-selects when current component is an entry point', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'index.tsx',
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBe('src/Form.tsx');
  });

  it('does not auto-select when current component is a regular component', () => {
    const result = selectComponentToLoad({
      atoms,
      composites,
      pages,
      currentComponentName: 'Header',
      mode: 'design',
      persistedOpenedComponent: undefined,
    });
    expect(result).toBeNull();
  });
});

// HYP-227: a slow fetch for the project that was active at dispatch time must not
// auto-load its components after the active project has switched. Repro: project A
// fetch is slow, user switches to B, B resolves first, then A resolves late.
describe('useComponentAutoLoad — stale in-flight guard', () => {
  /** A promise plus its resolver, so the test controls when each fetch settles. */
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  // Tell React this is an act() environment so updates driven through act()/waitFor()
  // are recognised and don't emit spurious "not wrapped in act(...)" warnings. The
  // shared test setup doesn't set it globally, so scope it to this async-render block.
  const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let priorActEnv: boolean | undefined;

  beforeEach(() => {
    priorActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
    actEnv.IS_REACT_ACT_ENVIRONMENT = true;
    fetchComponentsJSON.mockReset();
    useProjectActivationStore.setState({ activatedProjectId: null });
  });

  afterEach(() => {
    actEnv.IS_REACT_ACT_ENVIRONMENT = priorActEnv;
    useProjectActivationStore.setState({ activatedProjectId: null });
  });

  it('does not load project A components after switching to project B (A resolves late)', async () => {
    const a = deferred<ComponentsAPIResponse>();
    const b = deferred<ComponentsAPIResponse>();
    // Project A's fetch is slow (deferred), project B's is fast (deferred, resolved
    // first by the test). Key by the project id so any spurious effect re-run for the
    // same project reuses the same pending promise instead of an undefined payload.
    fetchComponentsJSON.mockImplementation((projectId: string | null) => {
      if (projectId === 'A') return a.promise;
      if (projectId === 'B') return b.promise;
      return Promise.resolve({ success: true });
    });

    const loadComponent = mock((_path: string) => {});

    // Project A active.
    act(() => {
      useProjectActivationStore.setState({ activatedProjectId: 'A' });
    });
    const { rerender } = renderHook((props) => useComponentAutoLoad(props), {
      initialProps: {
        activeProjectId: 'A',
        activeProjectStatus: 'running',
        currentComponentName: undefined,
        mode: 'design' as const,
        loadComponent,
      },
    });

    // Let project A's mount effect settle (no resolution yet — fetch A is still pending).
    await act(async () => {
      await Promise.resolve();
    });

    // Switch to project B before A's fetch resolves.
    await act(async () => {
      useProjectActivationStore.setState({ activatedProjectId: 'B' });
      rerender({
        activeProjectId: 'B',
        activeProjectStatus: 'running',
        currentComponentName: undefined,
        mode: 'design' as const,
        loadComponent,
      });
      await Promise.resolve();
    });

    // Drain enough microtask ticks for the hook's `await fetchComponentsJSON` + its
    // synchronous continuation (flatten + setState + loadComponent) to settle inside act.
    const settle = async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    };

    // B resolves first — its auto-load runs inside act.
    await act(async () => {
      b.resolve(payloadFor('B'));
      await settle();
    });

    expect(loadComponent).toHaveBeenCalledWith('B.tsx');

    // A resolves late — its components must NOT be auto-loaded into B.
    await act(async () => {
      a.resolve(payloadFor('A'));
      await settle();
    });

    expect(loadComponent).not.toHaveBeenCalledWith('A.tsx');
  });
});
