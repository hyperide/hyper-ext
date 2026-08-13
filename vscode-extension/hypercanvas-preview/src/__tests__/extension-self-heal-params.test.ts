/**
 * @file Unit tests for resolveSelfHealComponentParams — the monorepo
 * missing-component self-heal path must re-supply BOTH the repo-relative and
 * the sub-project-relative component paths to setComponentParam.
 *
 * Accessed via: extension.ts activate() → previewPanel.onComponentMissing
 *               (HYP-435 monorepo in-canvas edit re-rooting).
 * Assumptions: the iframe's componentMissing signal carries the PREVIEW
 *              (sub-project-relative, `?component=` query) path, e.g.
 *              `src/app/page.tsx`. The dev-server-rooted activeWorkspaceRoot is
 *              the sub-project; the VS Code folder root is the repo root.
 * Past bugs: P2 #280 (codex) — the self-heal path called
 *            `setComponentParam(relPath)` with a single arg, so
 *            previewComponentPath defaulted to the same value, deriveSubProjectPrefix
 *            returned '' and the AstBridge prefix was cleared. Subsequent
 *            iframe AST edits in the regenerated preview were sent as `src/...`
 *            again and either failed or hit suffix collisions across targets.
 */
import { describe, expect, it } from 'bun:test';
import {
  isActivationStale,
  isFailureSignalForCurrentSelection,
  resolveSelfHealComponentParams,
} from '../extension-utils';

describe('resolveSelfHealComponentParams', () => {
  it('monorepo: returns repo-relative componentPath + sub-relative previewComponentPath', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: 'src/app/page.tsx', // iframe-supplied preview (sub-relative) path
      activeWorkspaceRoot: '/repo/targets/conloca-app',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'targets/conloca-app/src/app/page.tsx',
      previewComponentPath: 'src/app/page.tsx',
    });
  });

  it('single-package: repo root === active root → both paths coincide (prefix becomes empty)', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: 'src/Button.tsx',
      activeWorkspaceRoot: '/repo',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'src/Button.tsx',
      previewComponentPath: 'src/Button.tsx',
    });
  });

  it('absolute iframe path: resolved against both roots independently', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: '/repo/targets/conloca-app/src/app/page.tsx',
      activeWorkspaceRoot: '/repo/targets/conloca-app',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'targets/conloca-app/src/app/page.tsx',
      previewComponentPath: 'src/app/page.tsx',
    });
  });
});

/**
 * codex P1-D: a render-failure signal (componentMissing / componentError) from the OLD iframe during
 * an A→B selection switch can still pass the panel sender guard. The app-mode-retry branch must NOT
 * latch + activate for the WRONG (current) selection that never failed. isFailureSignalForCurrentSelection
 * binds the reported repo-relative path (resolveSelfHealComponentParams(...).componentPath) to the
 * current selection (stateHub.state.currentComponent?.path) up front. Both are repo-relative / same
 * astBridge identity, so an exact (separator-normalized) match means the signal belongs to the
 * current component; anything else is treated as stale and the app-mode retry is skipped.
 */
describe('isFailureSignalForCurrentSelection', () => {
  it('matches when the reported repo-relative path equals the current selection', () => {
    expect(isFailureSignalForCurrentSelection('targets/app/src/App.tsx', 'targets/app/src/App.tsx')).toBe(true);
  });

  it('rejects a STALE signal whose reported path differs from the current selection (mid A→B switch)', () => {
    // The iframe reported a crash for the OLD component (Other) after the user switched to App.
    expect(isFailureSignalForCurrentSelection('targets/app/src/Other.tsx', 'targets/app/src/App.tsx')).toBe(false);
  });

  it('rejects when there is no current selection', () => {
    expect(isFailureSignalForCurrentSelection('src/App.tsx', undefined)).toBe(false);
  });

  it('normalizes path separators so a Windows `\\` vs `/` mismatch is not a spurious reject', () => {
    expect(isFailureSignalForCurrentSelection('targets\\app\\src\\App.tsx', 'targets/app/src/App.tsx')).toBe(true);
  });

  // P2 (this round, HYP-487 hardening): the provider-context branch of onComponentError used to run
  // ensureIsolationWrapper() (writes .hyperide/preview.tsx) WITHOUT checking the reported path against
  // the current selection. A late provider error from the OLD iframe after an A→B switch would then
  // generate the isolation wrapper for the current workspace even though B never failed. The handler
  // now resolves the reported path to its repo-relative form (resolveSelfHealComponentParams) and
  // gates the whole branch on this guard — a stale provider signal returns WITHOUT writing the
  // wrapper. These cases pin the decision the handler delegates to.
  it('STALE provider-context error: reported OLD component ≠ current selection → wrapper must NOT generate', () => {
    // The iframe reported a provider-context crash for the OLD component (Other) after the user
    // switched to App. The provider branch gates on this returning false → no ensureIsolationWrapper.
    expect(isFailureSignalForCurrentSelection('targets/app/src/Other.tsx', 'targets/app/src/App.tsx')).toBe(false);
  });

  it('CURRENT provider-context error: reported path === current selection → wrapper generation allowed', () => {
    expect(isFailureSignalForCurrentSelection('targets/app/src/App.tsx', 'targets/app/src/App.tsx')).toBe(true);
  });

  it('provider-context error with no current selection → wrapper must NOT generate', () => {
    expect(isFailureSignalForCurrentSelection('targets/app/src/App.tsx', undefined)).toBe(false);
  });
});

/**
 * codex P1-3: the ext app-mode fallback's `isStale` closure used to check ONLY path equality
 * (`currentComponent.path !== capturedPath`). During an A→B→A occupancy churn the path string is A
 * again, so a pure-path check returns "not stale" and a STALE activation from the first A occupancy
 * commits app-mode for the fresh A occupancy. isActivationStale adds a selection-generation check
 * (bumped on every switch, captured at signal time) to invalidate a prior occupancy even when the
 * path repeats — mirroring the SaaS hook's selectionTokenRef. Stale iff generation OR path differs.
 *
 * The handlers call isActivationStale at TWO points with the same captured generation: (1) right after
 * the async candidacy read resolves, BEFORE latching appModeRetryAttempts — so a stale candidacy
 * result for a fresh occupancy can't poison the latch; and (2) inside retryWithAppModeForEntry's
 * isStale, BEFORE the activation commits. The cases below pin the single decision both points share.
 */
describe('isActivationStale', () => {
  it('not stale when generation and path both still match (single in-flight selection)', () => {
    expect(
      isActivationStale({
        capturedGeneration: 3,
        currentGeneration: 3,
        capturedPath: 'targets/app/src/App.tsx',
        currentPath: 'targets/app/src/App.tsx',
      }),
    ).toBe(false);
  });

  it('STALE when the generation was bumped even though the path string repeats (A→B→A case)', () => {
    // Activation started for the first A occupancy at gen 3; user did A→B→A so gen is now 5, but
    // currentComponent.path is A again. Pure path equality would miss this — the generation catches it.
    expect(
      isActivationStale({
        capturedGeneration: 3,
        currentGeneration: 5,
        capturedPath: 'targets/app/src/App.tsx',
        currentPath: 'targets/app/src/App.tsx',
      }),
    ).toBe(true);
  });

  it('STALE when the path changed within the same generation (defensive — path guard still active)', () => {
    expect(
      isActivationStale({
        capturedGeneration: 3,
        currentGeneration: 3,
        capturedPath: 'targets/app/src/App.tsx',
        currentPath: 'targets/app/src/Other.tsx',
      }),
    ).toBe(true);
  });

  it('STALE when the selection cleared (currentPath undefined) even at the same generation', () => {
    expect(
      isActivationStale({
        capturedGeneration: 3,
        currentGeneration: 3,
        capturedPath: 'targets/app/src/App.tsx',
        currentPath: undefined,
      }),
    ).toBe(true);
  });
});
