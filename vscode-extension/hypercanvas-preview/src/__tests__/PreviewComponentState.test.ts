/**
 * @file PreviewComponentState value-object tests (HYP-369 Sub-ticket A).
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewComponentState.test.ts
 * Assumptions: this is the single source of truth for PreviewPanel's component
 *   identity (repoPath / previewPath / navigable / needsRegeneration). It encodes
 *   the exact derived `navigable` invariant and `needsRegeneration` reset rules that
 *   previously lived as scattered shadow fields in PreviewPanel.ts. Pure refactor —
 *   behavior must stay byte-identical with the legacy field logic.
 */

import { describe, expect, it } from 'bun:test';
import {
  canNavigate,
  createComponentState,
  needsNavigationWait,
  selectComponentParam,
  withCurrentComponent,
  withNavigable,
  withNeedsRegeneration,
  type PreviewComponentState,
} from '../PreviewComponentState';

describe('PreviewComponentState — initial value', () => {
  it('starts empty: no paths, not navigable, no pending regeneration', () => {
    const state = createComponentState();
    expect(state.repoPath).toBeUndefined();
    expect(state.previewPath).toBeUndefined();
    expect(state.navigable).toBe(false);
    expect(state.needsRegeneration).toBe(false);
  });
});

describe('PreviewComponentState — navigable invariant (was PreviewPanel.ts:1208)', () => {
  // Legacy: canNavigateCurrentComponent = !_currentComponent || _navigableComponent === _currentComponent
  it('canNavigate is true when there is no component (empty state is unobservable)', () => {
    expect(canNavigate(createComponentState())).toBe(true);
  });

  it('canNavigate is false when a component is chosen but not yet navigable', () => {
    const state = withCurrentComponent(createComponentState(), 'src/App.tsx');
    expect(state.navigable).toBe(false);
    expect(canNavigate(state)).toBe(false);
  });

  it('canNavigate is true once the chosen component is marked navigable', () => {
    let state = withCurrentComponent(createComponentState(), 'src/App.tsx');
    state = withNavigable(state, 'src/App.tsx');
    expect(state.navigable).toBe(true);
    expect(canNavigate(state)).toBe(true);
  });

  // Legacy: _currentComponent && _navigableComponent !== _currentComponent (lines 1324, 1398)
  it('needsNavigationWait is true while a component is pending navigation', () => {
    const state = withCurrentComponent(createComponentState(), 'src/App.tsx');
    expect(needsNavigationWait(state)).toBe(true);
  });

  it('needsNavigationWait is false once navigable', () => {
    let state = withCurrentComponent(createComponentState(), 'src/App.tsx');
    state = withNavigable(state, 'src/App.tsx');
    expect(needsNavigationWait(state)).toBe(false);
  });

  it('needsNavigationWait is false when no component is selected', () => {
    expect(needsNavigationWait(createComponentState())).toBe(false);
  });
});

describe('PreviewComponentState — withCurrentComponent (was _setCurrentComponent:1286-1292)', () => {
  it('changing the component drops navigable and previewPath (stale sub-project path)', () => {
    let state = selectComponentParam(createComponentState(), 'src/App.tsx', 'sub/App.tsx');
    expect(state.navigable).toBe(true);
    expect(state.previewPath).toBe('sub/App.tsx');

    state = withCurrentComponent(state, 'src/Other.tsx');
    expect(state.repoPath).toBe('src/Other.tsx');
    expect(state.navigable).toBe(false);
    expect(state.previewPath).toBeUndefined();
  });

  it('re-setting the same component keeps navigable and previewPath intact', () => {
    let state = selectComponentParam(createComponentState(), 'src/App.tsx', 'sub/App.tsx');
    state = withCurrentComponent(state, 'src/App.tsx');
    expect(state.navigable).toBe(true);
    expect(state.previewPath).toBe('sub/App.tsx');
  });
});

describe('PreviewComponentState — navigable assignment (was _navigableComponent reset rules)', () => {
  // Legacy _initializeComponent:1162-1163: if _navigableComponent !== stateComponent.path -> undefined
  it('marking navigable with a non-matching path leaves it not navigable', () => {
    let state = withCurrentComponent(createComponentState(), 'src/App.tsx');
    state = withNavigable(state, 'src/Other.tsx');
    expect(state.navigable).toBe(false);
  });

  it('clearing navigable (undefined) never marks an empty state navigable', () => {
    // Guards against setWorkspaceRoot (140-141): repoPath undefined, navigable cleared
    // must NOT become navigable=true via undefined === undefined.
    const state = withNavigable(createComponentState(), undefined);
    expect(state.navigable).toBe(false);
  });
});

describe('PreviewComponentState — needsRegeneration reset rules', () => {
  it('selectComponentParam clears needsRegeneration (was setComponentParam:1436)', () => {
    let state = withNeedsRegeneration(createComponentState(), true);
    state = selectComponentParam(state, 'src/App.tsx', 'src/App.tsx');
    expect(state.needsRegeneration).toBe(false);
    expect(state.navigable).toBe(true);
  });

  it('withNeedsRegeneration(true) flags regeneration (was dispose:1418 / onDidDispose:329)', () => {
    const state = withNeedsRegeneration(createComponentState(), true);
    expect(state.needsRegeneration).toBe(true);
  });

  it('withNeedsRegeneration(false) clears the flag (was _initializeComponent:1148/1166)', () => {
    let state = withNeedsRegeneration(createComponentState(), true);
    state = withNeedsRegeneration(state, false);
    expect(state.needsRegeneration).toBe(false);
  });
});

describe('PreviewComponentState — selectComponentParam (was setComponentParam:1433-1436)', () => {
  it('sets repoPath, previewPath, navigable=true, needsRegeneration=false', () => {
    const state: PreviewComponentState = selectComponentParam(
      createComponentState(),
      'targets/conloca-app/src/app/page.tsx',
      'src/app/page.tsx',
    );
    expect(state.repoPath).toBe('targets/conloca-app/src/app/page.tsx');
    expect(state.previewPath).toBe('src/app/page.tsx');
    expect(state.navigable).toBe(true);
    expect(state.needsRegeneration).toBe(false);
  });
});

describe('PreviewComponentState — immutability', () => {
  it('transitions return a new object, never mutate the input', () => {
    const base = createComponentState();
    const next = withCurrentComponent(base, 'src/App.tsx');
    expect(base.repoPath).toBeUndefined();
    expect(next).not.toBe(base);
  });
});
