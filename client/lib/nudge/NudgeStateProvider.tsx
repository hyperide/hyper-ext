/**
 * @file NudgeStateProvider — supplies a NudgeStatePort to the Nudge HUD via React context
 *
 * Accessed via: <NudgeStateProvider> wraps the inspector tree (SaaS CanvasEditor and the
 *   VS Code webview-right RightPanelApp). Components read state with useNudgeState(selector)
 *   and actions with useNudgeActions() — never `import { nudgeStore }`.
 * Assumptions: under D1-A both Browser and the extension back the port with an in-realm
 *   zustand store; the port is the seam where a cross-realm (D1-B / StateHub) impl would slot.
 * Architecture: D1-A, docs/specs/2026-06-04-crossrealm-webview-bridge.md
 */
import { type AdapterName, findNearestToken, getTokenScale } from '@lib/tokens/token-scales';
import { createContext, type ReactNode, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { createNudgeStore, nudgeStore } from '@/stores/nudgeStore';
import type { NudgeSnapshot, NudgeStatePort } from './NudgeStatePort';

/** Active project styling kit, or 'none' when no token scale applies. Mirrors NudgeHUD's prop. */
type NudgeAdapter = AdapterName | 'none';

/** Wrap a zustand nudge store as a NudgeStatePort (the in-realm realization of the capability). */
function portFromStore(store: {
  getState: () => NudgeSnapshot;
  subscribe: (l: () => void) => () => void;
}): NudgeStatePort {
  return {
    getSnapshot: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
  };
}

/** A fresh in-realm port (new non-persisted store). Use for the extension webview and tests. */
export function createNudgeStatePort(): NudgeStatePort {
  return portFromStore(createNudgeStore());
}

/** Default port, backed by the persisted shared singleton — used when no provider is present. */
const browserNudgePort: NudgeStatePort = portFromStore(nudgeStore);

const NudgeStateContext = createContext<NudgeStatePort | null>(null);

interface NudgeStateProviderProps {
  /** Optional override; defaults to a stable per-provider in-realm port. */
  port?: NudgeStatePort;
  children: ReactNode;
}

export function NudgeStateProvider({ port, children }: NudgeStateProviderProps) {
  // Stable port for the provider's lifetime when none is injected.
  const fallbackRef = useRef<NudgeStatePort | null>(null);
  if (!port && !fallbackRef.current) fallbackRef.current = createNudgeStatePort();
  const value = port ?? (fallbackRef.current as NudgeStatePort);
  return <NudgeStateContext.Provider value={value}>{children}</NudgeStateContext.Provider>;
}

/**
 * Resolve the active port. Falls back to the SaaS singleton-backed port when no provider is
 * present, so generic NumericInputs (no styleKey, no HUD) work anywhere without a wrapper.
 * The inspector mount points still inject an explicit port — fresh per VS Code webview, or a
 * test-isolated one — which is the actual DI seam.
 */
function usePort(): NudgeStatePort {
  return useContext(NudgeStateContext) ?? browserNudgePort;
}

/**
 * Subscribe to a slice of nudge state. Selector should return a primitive (or a stable
 * reference) — matching how the HUD selects `s.visible`, `s.mode`, etc. — to avoid tearing.
 */
export function useNudgeState<T>(selector: (s: NudgeSnapshot) => T): T {
  const port = usePort();
  return useSyncExternalStore(
    port.subscribe,
    () => selector(port.getSnapshot()),
    () => selector(port.getSnapshot()),
  );
}

/** Read the action functions (stable across renders) without subscribing to state changes. */
export function useNudgeActions(): NudgeSnapshot {
  return usePort().getSnapshot();
}

/**
 * Nudge HUD keyboard routing — intercept t/n/s/Escape when the HUD is visible.
 *
 * Realm-agnostic: this attaches to the same `port` the HUD reads, so it works identically in
 * SaaS (singleton-backed fallback port) and each VS Code inspector webview (its own in-realm
 * port) without any direct `nudgeStore` coupling. Mounted by <NudgeHUD>, which both realms
 * already render. Capture phase + `e.code` so it fires even while a numeric input is focused;
 * gated on `visible` so it never collides with the editor's other hotkeys.
 *
 * Reads state via `port.getSnapshot()` INSIDE the handler (not a captured snapshot) to avoid a
 * stale closure — `port` is stable for the provider's lifetime, so the listener attaches once.
 */
export function useNudgeKeyboard(adapter: NudgeAdapter): void {
  const port = usePort();

  useEffect(() => {
    const handleNudgeKeys = (e: KeyboardEvent) => {
      const nudge = port.getSnapshot();
      if (!nudge.visible) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        // Stop here so dismissing the HUD doesn't also reach the editor's document Escape handler
        // (which would clear the canvas/board selection). Capture phase runs before that listener.
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (nudge.editingTarget) {
          nudge.stopEditing();
        } else {
          nudge.hide();
        }
        return;
      }
      // The t/n/s nudge shortcuts are plain keypresses — never hijack modified combos
      // (Cmd/Ctrl+T new tab, Cmd/Ctrl+S save, Alt+… ) just because the HUD is open.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Guarded on !editingTarget: toggling mode while editing swaps NumericMode → TokenMode,
      // unmounting EditNudgeInput before its typed value is applied (same data-loss as KeyS).
      if (e.code === 'KeyT' && !nudge.editingTarget) {
        e.preventDefault();
        const wasNumeric = nudge.mode === 'numeric';
        nudge.toggleMode();
        // Entering token mode: re-snap the current value to the nearest token on the scale.
        if (wasNumeric && nudge.activeProperty && adapter !== 'none') {
          const fresh = port.getSnapshot();
          const scale = getTokenScale(fresh.activeProperty ?? '', adapter);
          const nearest = findNearestToken(fresh.currentValue, scale);
          if (nearest) fresh.updateCurrentValue(nearest.value);
        }
        return;
      }
      if (e.code === 'KeyN' && !nudge.editingTarget) {
        e.preventDefault();
        nudge.startEditing(nudge.highlightedTarget);
      }
      // KeyS while editing is intentionally NOT handled here: EditNudgeInput owns it (its onKeyDown
      // applies the freshly typed value, THEN saveForLater). A window capture-phase handler would
      // run first, save the stale store value and unmount the input before it could apply — losing
      // the edit. Leave save-while-editing to the focused input.
    };
    window.addEventListener('keydown', handleNudgeKeys, { capture: true });
    return () => window.removeEventListener('keydown', handleNudgeKeys, { capture: true });
  }, [port, adapter]);
}
