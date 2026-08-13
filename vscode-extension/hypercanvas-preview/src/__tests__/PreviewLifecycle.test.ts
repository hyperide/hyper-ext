/**
 * @file PreviewLifecycle pure-reducer tests (HYP-369 Sub-ticket B).
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewLifecycle.test.ts
 * Assumptions: PreviewLifecycle is a PURE reducer (no vscode imports). It names the
 *   panel/devserver/component readiness as explicit lifecycle states and routes every
 *   transition through one place. The lifecycle name is DERIVED from the backing data
 *   (panel attached? + PreviewComponentState + devserver running?) — never stored as a
 *   parallel source of truth — so direct field mutations in PreviewPanel.test.ts cannot
 *   desync it. Behavior-preserving: the reducer encodes the exact guards the HYP-363
 *   commits added by hand (resurrection re-emit, same-path no-op).
 */

import { describe, expect, it } from 'bun:test';
import { createComponentState, selectComponentParam } from '../PreviewComponentState';
import { deriveLifecycle, reduce, type LifecycleContext } from '../PreviewLifecycle';

/** Convenience: a context describing an attached, live (navigable + devserver) panel. */
function liveContext(repoPath = 'src/App.tsx'): LifecycleContext {
  return {
    attached: true,
    devServerRunning: true,
    component: selectComponentParam(createComponentState(), repoPath, repoPath),
  };
}

describe('deriveLifecycle — names the four states from backing data', () => {
  it('Detached when no panel is attached', () => {
    expect(deriveLifecycle({ attached: false, devServerRunning: false, component: createComponentState() })).toBe(
      'Detached',
    );
    // Detached holds even with a retained component record (post-dispose resurrection seed).
    expect(
      deriveLifecycle({
        attached: false,
        devServerRunning: true,
        component: selectComponentParam(createComponentState(), 'src/App.tsx', 'src/App.tsx'),
      }),
    ).toBe('Detached');
  });

  it('Attached_NoComponent when panel exists but no repoPath is resolved', () => {
    expect(deriveLifecycle({ attached: true, devServerRunning: true, component: createComponentState() })).toBe(
      'Attached_NoComponent',
    );
  });

  it('Attached_ComponentPending when a component is chosen but not yet navigable', () => {
    const component = { ...createComponentState(), repoPath: 'src/App.tsx', navigable: false };
    expect(deriveLifecycle({ attached: true, devServerRunning: true, component })).toBe('Attached_ComponentPending');
  });

  it('Attached_Live when the component is navigable and the dev server runs', () => {
    expect(deriveLifecycle(liveContext())).toBe('Attached_Live');
  });

  it('stays Attached_ComponentPending when navigable but dev server is NOT running', () => {
    const component = selectComponentParam(createComponentState(), 'src/App.tsx', 'src/App.tsx');
    expect(deriveLifecycle({ attached: true, devServerRunning: false, component })).toBe('Attached_ComponentPending');
  });
});

describe('reduce — attach transition (createOrShow / restorePanel / setupPanel)', () => {
  it('Detached -> Attached_NoComponent on attach with no component', () => {
    const result = reduce(
      { attached: false, devServerRunning: false, component: createComponentState() },
      {
        type: 'attach',
      },
    );
    expect(result.context.attached).toBe(true);
    expect(deriveLifecycle(result.context)).toBe('Attached_NoComponent');
  });

  it('attach retains the previously selected component (resurrection seed) and clears regeneration', () => {
    const detachedWithRecord: LifecycleContext = {
      attached: false,
      devServerRunning: true,
      component: { repoPath: 'src/App.tsx', previewPath: 'src/App.tsx', navigable: false, needsRegeneration: true },
    };
    const result = reduce(detachedWithRecord, { type: 'attach' });
    expect(result.context.component.repoPath).toBe('src/App.tsx');
    expect(result.context.attached).toBe(true);
    expect(result.context.component.needsRegeneration).toBe(false);
  });

  it('attach of an already-live panel (no pending regeneration) emits NO selection', () => {
    // createOrShow on a live panel just re-pushes existing state — it must not re-emit.
    const result = reduce(liveContext('src/App.tsx'), { type: 'attach' });
    expect(result.effects.filter((e) => e.type === 'emitSelection')).toHaveLength(0);
  });
});

describe('reduce — dispose transition (onDidDispose / dispose)', () => {
  it('Attached_Live -> Detached, retains repoPath, marks regeneration, drops navigable', () => {
    const result = reduce(liveContext(), { type: 'dispose' });
    expect(deriveLifecycle(result.context)).toBe('Detached');
    expect(result.context.attached).toBe(false);
    expect(result.context.component.repoPath).toBe('src/App.tsx'); // retained
    expect(result.context.component.navigable).toBe(false); // dropped
    expect(result.context.component.needsRegeneration).toBe(true); // re-attach must regenerate
  });
});

describe('reduce — componentChanged (StateHub.onChange / _setCurrentComponent)', () => {
  it('adopting a NEW path drops navigability and emits a selection effect exactly once', () => {
    const result = reduce(liveContext('src/App.tsx'), { type: 'componentChanged', repoPath: 'src/Feed.tsx' });
    expect(result.context.component.repoPath).toBe('src/Feed.tsx');
    expect(result.context.component.navigable).toBe(false);
    const emits = result.effects.filter((e) => e.type === 'emitSelection');
    expect(emits).toHaveLength(1);
    expect(emits[0]).toEqual({ type: 'emitSelection', repoPath: 'src/Feed.tsx' });
  });

  it('same path PRESERVES navigability (no needless iframe re-wait)', () => {
    const result = reduce(liveContext('src/App.tsx'), { type: 'componentChanged', repoPath: 'src/App.tsx' });
    // withCurrentComponent no-ops navigability/previewPath for an unchanged repoPath.
    expect(result.context.component.navigable).toBe(true);
    expect(result.context.component.previewPath).toBe('src/App.tsx');
  });

  it('same path still emits at reducer level — re-emit dedup is the host StateHub seam', () => {
    // The reducer must NOT suppress same-path emits: legacy _setCurrentComponent re-synced
    // StateHub even on an unchanged repoPath when StateHub had drifted. The StateHub
    // name+path compare in PreviewPanel._runSelectionEffects is the real dedup; the
    // feedback-loop break is the StateHub.onChange listener discarding effects.
    const result = reduce(liveContext('src/App.tsx'), { type: 'componentChanged', repoPath: 'src/App.tsx' });
    expect(result.effects).toEqual([{ type: 'emitSelection', repoPath: 'src/App.tsx' }]);
  });
});

describe('reduce — selectComponentParam (Pending -> Live once navigable)', () => {
  it('marks the component navigable and clears regeneration', () => {
    const pending: LifecycleContext = {
      attached: true,
      devServerRunning: true,
      component: { ...createComponentState(), repoPath: 'src/App.tsx', navigable: false, needsRegeneration: true },
    };
    const result = reduce(pending, {
      type: 'selectComponentParam',
      repoPath: 'src/App.tsx',
      previewPath: 'src/App.tsx',
    });
    expect(deriveLifecycle(result.context)).toBe('Attached_Live');
    expect(result.context.component.navigable).toBe(true);
    expect(result.context.component.needsRegeneration).toBe(false);
    expect(result.context.component.previewPath).toBe('src/App.tsx');
  });
});

describe('reduce — devserverStatusChanged', () => {
  it('flips the running axis without touching the component record', () => {
    const stopped = reduce(liveContext(), { type: 'devserverStatusChanged', running: false });
    expect(stopped.context.devServerRunning).toBe(false);
    expect(stopped.context.component.repoPath).toBe('src/App.tsx');

    const started = reduce(stopped.context, { type: 'devserverStatusChanged', running: true });
    expect(started.context.devServerRunning).toBe(true);
    expect(deriveLifecycle(started.context)).toBe('Attached_Live');
  });
});

describe('reduce — workspaceReset (setWorkspaceRoot full reset)', () => {
  it('clears the component record and devserver, keeping panel attachment', () => {
    const result = reduce(liveContext(), { type: 'workspaceReset' });
    expect(result.context.component.repoPath).toBeUndefined();
    expect(result.context.component.navigable).toBe(false);
    expect(result.context.component.needsRegeneration).toBe(false);
    expect(result.context.devServerRunning).toBe(false);
    expect(result.context.attached).toBe(true);
    expect(deriveLifecycle(result.context)).toBe('Attached_NoComponent');
  });
});

describe('REGRESSION (f33e5ff0): resurrection path Live -> dispose -> attach', () => {
  it('restores the same repoPath and re-emits the component exactly once', () => {
    // Live: user previewing src/App.tsx with a running dev server.
    const live = liveContext('src/App.tsx');
    expect(deriveLifecycle(live)).toBe('Attached_Live');

    // User closes the Hyper Canvas tab.
    const afterDispose = reduce(live, { type: 'dispose' });
    expect(deriveLifecycle(afterDispose.context)).toBe('Detached');
    expect(afterDispose.context.component.repoPath).toBe('src/App.tsx'); // record retained

    // User reopens it via createOrShow -> attach.
    const afterAttach = reduce(afterDispose.context, { type: 'attach' });
    expect(afterAttach.context.component.repoPath).toBe('src/App.tsx'); // same component restored

    // re-attach must re-emit the retained component exactly once (regression for f33e5ff0).
    const reEmits = afterAttach.effects.filter((e) => e.type === 'emitSelection');
    expect(reEmits).toHaveLength(1);
    expect(reEmits[0]).toEqual({ type: 'emitSelection', repoPath: 'src/App.tsx' });
  });

  it('attach with no retained component does NOT re-emit a selection', () => {
    const result = reduce(
      { attached: false, devServerRunning: false, component: createComponentState() },
      {
        type: 'attach',
      },
    );
    expect(result.effects.filter((e) => e.type === 'emitSelection')).toHaveLength(0);
  });
});
