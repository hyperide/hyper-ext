/**
 * @file NudgeStatePort — the capability the Nudge HUD depends on, decoupled from any store
 *
 * Accessed via: useNudgeState / useNudgeActions (client/lib/nudge), injected through
 *   NudgeStateProvider. UI components depend on THIS interface, never on the module-level
 *   `nudgeStore` singleton — that singleton encodes "one JS realm", which is false in the
 *   VS Code extension (split webviews). The port is the DI seam: Browser and each extension
 *   webview back it with their own in-realm store, while the components stay identical.
 * Assumptions: getSnapshot returns a stable reference until subscribe fires (zustand contract).
 * Architecture: D1-A, docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */

/** State + actions exposed to the HUD. Mirrors the nudge store's public surface. */
export interface NudgeSnapshot {
  mode: 'numeric' | 'token';
  altStep: number;
  shiftStep: number;
  customAltStep: boolean;
  customShiftStep: boolean;
  editingTarget: 'alt' | 'shift' | null;
  highlightedTarget: 'alt' | 'shift';
  visible: boolean;
  activeProperty: string | null;
  currentValue: string;
  projectId: string;

  show: (property: string, value: string) => void;
  hide: () => void;
  toggleMode: () => void;
  setAltStep: (step: number) => void;
  setShiftStep: (step: number) => void;
  startEditing: (target: 'alt' | 'shift') => void;
  stopEditing: () => void;
  setHighlightedTarget: (target: 'alt' | 'shift') => void;
  updateCurrentValue: (value: string) => void;
  setProjectId: (id: string) => void;
  saveForLater: () => void;
  getStepForModifiers: (shift: boolean, alt: boolean, unit: string) => number;
  reset: () => void;
}

/**
 * The transport-agnostic capability. Deliberately the minimal external-store surface
 * (subscribe + getSnapshot) so it binds with React's useSyncExternalStore and can later be
 * realized over StateHub for a cross-realm variant (D1-B) without touching consumers.
 */
export interface NudgeStatePort {
  getSnapshot: () => NudgeSnapshot;
  subscribe: (listener: () => void) => () => void;
}
