/**
 * @file PreviewLifecycle — the explicit panel/devserver/component lifecycle FSM
 *   for PreviewPanel (HYP-369 Sub-ticket B).
 *
 * Accessed via: PreviewPanel.ts (the only consumer) and PreviewLifecycle.test.ts.
 * Assumptions:
 *   - This module is PURE. It MUST NOT import vscode (or anything host-bound). It is a
 *     reducer over plain data so the lifecycle is testable in isolation.
 *   - The lifecycle NAME is DERIVED from the backing data PreviewPanel already owns —
 *     `_panel` (attached?), `_componentState` (PreviewComponentState), `_devServerRunning`.
 *     It is NEVER stored as a parallel field. Storing it would reintroduce the
 *     dual-source-of-truth that Sub-ticket A removed, and would silently desync from the
 *     direct field mutations the existing PreviewPanel.test.ts performs.
 *   - The reducer earns its keep through `effects`, not state: the two HYP-363 guards
 *     (resurrection re-emit on f33e5ff0, same-path no-op on the StateHub.onChange loop)
 *     become a single, testable `emitSelection` rule instead of scattered early-returns.
 *
 * The four lifecycle states, grounded in current PreviewPanel code (see the spec
 * "Sub-ticket B" table):
 *   - Detached                 `_panel === undefined` (pre-first-show or post-dispose).
 *   - Attached_NoComponent     panel exists, no `repoPath` resolved yet.
 *   - Attached_ComponentPending component chosen but iframe not yet navigable
 *                              (navigable === false, or navigable but dev server down).
 *   - Attached_Live            navigable component + dev server running.
 */

import {
  createComponentState,
  selectComponentParam as selectComponentParamState,
  withCurrentComponent,
  type PreviewComponentState,
} from './PreviewComponentState';

/** Named lifecycle states. Derived, never stored. */
export type LifecycleState = 'Detached' | 'Attached_NoComponent' | 'Attached_ComponentPending' | 'Attached_Live';

/**
 * The backing data the lifecycle name is derived from. Mirrors the PreviewPanel fields
 * one-to-one so PreviewPanel can build a context at the call site, reduce, and write the
 * result back — without persisting a second copy of the state.
 */
export interface LifecycleContext {
  /** Whether a webview panel is attached (`_panel !== undefined`). */
  readonly attached: boolean;
  /** Whether the dev server is running (`_devServerRunning`). */
  readonly devServerRunning: boolean;
  /** The component identity record (Sub-ticket A value object). */
  readonly component: PreviewComponentState;
}

/** Events that drive lifecycle transitions, named after the PreviewPanel call sites. */
export type LifecycleEvent =
  /** createOrShow / restorePanel / _setupPanel — a panel becomes attached. */
  | { readonly type: 'attach' }
  /** onDidDispose / dispose — the panel goes away; the component record is retained. */
  | { readonly type: 'dispose' }
  /** StateHub.onChange / _setCurrentComponent — a (possibly same) component is chosen. */
  | { readonly type: 'componentChanged'; readonly repoPath: string }
  /** setComponentParam — preview generated, component becomes navigable (Pending -> Live). */
  | { readonly type: 'selectComponentParam'; readonly repoPath: string; readonly previewPath: string }
  /** setPreviewUrl / notifyDevServerStopped — the dev server running axis flips. */
  | { readonly type: 'devserverStatusChanged'; readonly running: boolean }
  /** setWorkspaceRoot — VS Code reused the window for another workspace; full reset. */
  | { readonly type: 'workspaceReset' };

/**
 * Side effects the host (PreviewPanel) must execute after applying the reduced context.
 * Keeping effects out of the reducer body is what makes the lifecycle pure and the
 * HYP-363 guards assertable. `emitSelection` is the single re-emit decision that the
 * scattered guards used to make by hand — it fires when (and only when) the chosen
 * component must be (re)broadcast to StateHub / the iframe.
 */
export type LifecycleEffect = { readonly type: 'emitSelection'; readonly repoPath: string };

export interface LifecycleResult {
  readonly context: LifecycleContext;
  readonly effects: readonly LifecycleEffect[];
}

/**
 * Derive the named lifecycle state from the backing data. This is the single place that
 * decides "which state are we in" — there is no stored authority to drift from it.
 *
 * Attached_ComponentPending covers both "chosen but registry not ready" (navigable
 * false) and "navigable but dev server down" — neither can drive the iframe yet, which
 * is exactly the legacy `needsNavigationWait` / `!_devServerRunning` gating.
 */
export function deriveLifecycle(context: LifecycleContext): LifecycleState {
  if (!context.attached) return 'Detached';
  if (!context.component.repoPath) return 'Attached_NoComponent';
  if (context.component.navigable && context.devServerRunning) return 'Attached_Live';
  return 'Attached_ComponentPending';
}

/**
 * The one reducer. Pure: `(context, event) -> { context, effects }`. PreviewPanel builds
 * the input context from its backing fields, applies the returned context back onto them,
 * and runs the effects. No lifecycle name is persisted.
 */
export function reduce(context: LifecycleContext, event: LifecycleEvent): LifecycleResult {
  switch (event.type) {
    case 'attach': {
      // Resurrection (f33e5ff0): re-attaching after a dispose (needsRegeneration set, the
      // retained component record survived) must re-emit the selection exactly once so the
      // iframe rehydrates the previously-previewed file, then clear the regeneration flag.
      // A plain re-attach of an already-live panel (no pending regeneration) emits nothing —
      // it just pushes existing state, matching the legacy `_initializeComponent` branch.
      const resurrecting = Boolean(context.component.repoPath) && context.component.needsRegeneration;
      if (!resurrecting) {
        return { context: { ...context, attached: true }, effects: [] };
      }
      return {
        context: { ...context, attached: true, component: { ...context.component, needsRegeneration: false } },
        effects: [{ type: 'emitSelection', repoPath: context.component.repoPath as string }],
      };
    }

    case 'dispose': {
      // Retain the component record but force a regeneration and drop navigability — the
      // re-attach must re-derive a fresh, navigable preview (PreviewPanel.ts onDidDispose
      // sets `_navigableComponent = undefined` + `_requiresPreviewRegeneration = true`).
      return {
        context: {
          ...context,
          attached: false,
          component: { ...context.component, navigable: false, needsRegeneration: true },
        },
        effects: [],
      };
    }

    case 'componentChanged': {
      // Always mutate + emit. `withCurrentComponent` already no-ops navigability/previewPath
      // for an unchanged repoPath, so a same-path change preserves navigability. The re-emit
      // dedup is NOT decided here: it lives at the StateHub seam (the host's StateHub
      // name+path compare), faithfully matching legacy `_setCurrentComponent`
      // (PreviewPanel.ts) — which re-synced StateHub even on an unchanged repoPath when
      // StateHub had drifted. The feedback-loop break is a separate concern: the
      // StateHub.onChange listener discards these effects (it never re-fires applyUpdate).
      return {
        context: { ...context, component: withCurrentComponent(context.component, event.repoPath) },
        effects: [{ type: 'emitSelection', repoPath: event.repoPath }],
      };
    }

    case 'selectComponentParam': {
      return {
        context: {
          ...context,
          component: selectComponentParamState(context.component, event.repoPath, event.previewPath),
        },
        effects: [],
      };
    }

    case 'devserverStatusChanged': {
      return { context: { ...context, devServerRunning: event.running }, effects: [] };
    }

    case 'workspaceReset': {
      return {
        context: { ...context, devServerRunning: false, component: createComponentState() },
        effects: [],
      };
    }
  }
}
