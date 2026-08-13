/**
 * @file PreviewComponentState — immutable value object for PreviewPanel's
 *   component identity (HYP-369 Sub-ticket A).
 *
 * Accessed via: PreviewPanel.ts (the only consumer).
 * Assumptions: this is the single source of truth that replaces four scattered
 *   shadow fields PreviewPanel used to track "which component the preview shows":
 *
 *     - `repoPath`         was `_currentComponent`  (repo-relative, the astBridge key)
 *     - `previewPath`      was `_previewComponent`  (project-root-relative iframe ?component= path)
 *     - `navigable`        replaces the derived `_navigableComponent === _currentComponent` check
 *     - `needsRegeneration` was `_requiresPreviewRegeneration`
 *
 *   `repoPath` vs `previewPath` MUST stay distinct: in a monorepo the iframe sees
 *   the sub-project-relative path while astBridge keys files repo-relative
 *   (deriveSubProjectPrefix, HYP-420/430/435). Collapsing them reintroduces the
 *   sub-project suffix-collision bug.
 *
 *   This is a dumb immutable record plus pure transition/derivation helpers — NOT
 *   an FSM. The explicit lifecycle reducer is HYP-369 Sub-ticket B.
 */

export interface PreviewComponentState {
  /** Repo-relative component path. Old `_currentComponent`. Identity for AST edits. */
  readonly repoPath?: string;
  /**
   * Project-root-relative component path used to build the iframe ?component= URL.
   * Old `_previewComponent`. For a monorepo this is the sub-project-relative path;
   * falls back to `repoPath` when the project and repo roots coincide.
   */
  readonly previewPath?: string;
  /**
   * Whether the iframe can navigate to `repoPath` right now (preview generation /
   * registry is ready). Replaces the old `_navigableComponent === _currentComponent`
   * derived check.
   */
  readonly navigable: boolean;
  /** Whether the preview must be regenerated on re-attach. Old `_requiresPreviewRegeneration`. */
  readonly needsRegeneration: boolean;
}

/** Empty initial state — no component, not navigable, no pending regeneration. */
export function createComponentState(): PreviewComponentState {
  return { repoPath: undefined, previewPath: undefined, navigable: false, needsRegeneration: false };
}

/**
 * Whether the current component may be pushed to the iframe.
 * Mirrors legacy `!_currentComponent || _navigableComponent === _currentComponent`
 * (PreviewPanel.ts:1208). The empty-state `navigable` value is unobservable here
 * because the `!repoPath` short-circuit covers it.
 */
export function canNavigate(state: PreviewComponentState): boolean {
  return !state.repoPath || state.navigable;
}

/**
 * Whether a component is chosen but not yet navigable (iframe navigation must wait).
 * Mirrors legacy `_currentComponent && _navigableComponent !== _currentComponent`
 * (PreviewPanel.ts:1324, :1398).
 */
export function needsNavigationWait(state: PreviewComponentState): boolean {
  return Boolean(state.repoPath) && !state.navigable;
}

/**
 * Set the current (repo-relative) component. When the component changes, navigable
 * and the stale sub-project previewPath are dropped — the extension re-supplies the
 * preview path via `selectComponentParam` when this component is (re)selected.
 * Mirrors legacy `_setCurrentComponent` (PreviewPanel.ts:1286-1292).
 */
export function withCurrentComponent(state: PreviewComponentState, repoPath: string): PreviewComponentState {
  if (state.repoPath === repoPath) {
    return { ...state, repoPath };
  }
  return { ...state, repoPath, navigable: false, previewPath: undefined };
}

/**
 * Mark navigability for a specific path. `navigable` becomes true only when the
 * given path is defined and matches the current `repoPath`; otherwise it is cleared.
 * The `!== undefined` guard prevents `undefined === undefined` from flipping an
 * empty state to navigable (setWorkspaceRoot clears repoPath then navigable —
 * PreviewPanel.ts:140-141). Mirrors legacy `_navigableComponent` assignment
 * (PreviewPanel.ts:1162-1163, :1313).
 */
export function withNavigable(state: PreviewComponentState, navigablePath: string | undefined): PreviewComponentState {
  return { ...state, navigable: navigablePath !== undefined && navigablePath === state.repoPath };
}

/** Set the `needsRegeneration` flag. Old `_requiresPreviewRegeneration` write. */
export function withNeedsRegeneration(state: PreviewComponentState, needsRegeneration: boolean): PreviewComponentState {
  return { ...state, needsRegeneration };
}

/**
 * Adopt a component selected through the full pipeline (preview generated, registry
 * ready). Sets repoPath + previewPath, marks navigable, clears needsRegeneration.
 * Mirrors legacy `setComponentParam` field writes (PreviewPanel.ts:1433-1436).
 */
export function selectComponentParam(
  state: PreviewComponentState,
  repoPath: string,
  previewPath: string,
): PreviewComponentState {
  return { ...state, repoPath, previewPath, navigable: true, needsRegeneration: false };
}
