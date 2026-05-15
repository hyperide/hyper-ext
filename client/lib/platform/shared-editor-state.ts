/**
 * Shared Editor State — Zustand store synced via PlatformProvider
 *
 * In VS Code: state changes are sent/received via state:update messages
 * through the canvas message bus. StateHub (extension host) is the
 * source of truth and broadcasts diffs to all panels.
 *
 * In browser: single webview, no cross-panel sync needed.
 * The store still works as local state for the editor UI.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { SharedEditorState } from '../../../lib/types';
import type { CanvasAdapter } from './types';

// ============================================================================
// Store
// ============================================================================

interface SharedEditorActions {
  /** Apply a partial update locally (does NOT send to other panels) */
  applyPatch: (patch: Partial<SharedEditorState>) => void;

  /** Reset to full state (used on state:init from extension host) */
  init: (state: SharedEditorState) => void;
}

type SharedEditorStore = SharedEditorState & SharedEditorActions;

/**
 * Merge an incoming `state:init` snapshot against the current local store.
 *
 * `state:init` arrives whenever the webview reconnects (initial load and HMR
 * full-reload). The extension host's snapshot can race against the user's
 * own selection: if the user selected an element, then triggered an action
 * that causes a reload (i18n write → HMR), the host may broadcast the
 * pre-action default `selectedIds: []` *after* the user's selection is
 * already in our local store. Adopting that empty default visibly clears
 * the selection rect for one frame.
 *
 * Rule: an incoming EMPTY selection never wipes a non-empty local one.
 * Same idea for `selectedItemIndices` — they're tied to selection.
 * Everything else (currentComponent, mode flags, etc.) is replaced
 * normally because those fields ARE expected to be authoritative from the
 * host snapshot.
 *
 * Exported for unit testing.
 */
export function mergeInitState(incoming: SharedEditorState, local: SharedEditorState): SharedEditorState {
  const localHasSelection = Array.isArray(local.selectedIds) && local.selectedIds.length > 0;
  const incomingHasSelection = Array.isArray(incoming.selectedIds) && incoming.selectedIds.length > 0;

  if (localHasSelection && !incomingHasSelection) {
    return {
      ...incoming,
      selectedIds: local.selectedIds,
      // selectedItemIndices is keyed by selectedIds; preserve in lockstep
      selectedItemIndices: local.selectedItemIndices,
    };
  }

  return incoming;
}

export const useSharedEditorState = create<SharedEditorStore>((set) => ({
  // Initial state
  selectedIds: [],
  hoveredId: null,
  currentComponent: null,
  astStructure: null,
  canvasMode: 'single',
  engineMode: 'design',
  insertTargetId: null,

  // Actions
  applyPatch: (patch) => set((state) => ({ ...state, ...patch })),
  init: (newState) => set((local) => mergeInitState(newState, local as SharedEditorState)),
}));

// ============================================================================
// Sync hook — wire store to canvas message bus
// ============================================================================

/**
 * Subscribes to state:update and state:init messages from the canvas bus.
 * Call once in a top-level provider component.
 */
export function useSharedEditorStateSync(canvas: CanvasAdapter): void {
  useEffect(() => {
    const { applyPatch, init } = useSharedEditorState.getState();

    const unsubUpdate = canvas.onEvent('state:update', (msg) => {
      const { patch } = msg as { patch: Partial<SharedEditorState> };
      applyPatch(patch);
    });

    const unsubInit = canvas.onEvent('state:init', (msg) => {
      const { state } = msg as { state: SharedEditorState };
      init(state);
    });

    // Signal that subscriptions are active and we're ready for state:init
    canvas.sendEvent({ type: 'webview:ready' });

    return () => {
      unsubUpdate();
      unsubInit();
    };
  }, [canvas]);
}

// ============================================================================
// Convenience selectors
// ============================================================================

export function useSelectedIds(): string[] {
  return useSharedEditorState((s) => s.selectedIds);
}

export function useHoveredId(): string | null {
  return useSharedEditorState((s) => s.hoveredId);
}

export function useCurrentComponent(): SharedEditorState['currentComponent'] {
  return useSharedEditorState((s) => s.currentComponent);
}

export function useCanvasMode(): SharedEditorState['canvasMode'] {
  return useSharedEditorState((s) => s.canvasMode);
}

export function useEngineMode(): SharedEditorState['engineMode'] {
  return useSharedEditorState((s) => s.engineMode);
}

// ============================================================================
// Dispatch helpers (send to other panels via canvas bus)
// ============================================================================

/**
 * Create a dispatcher that updates local state AND sends to other panels.
 * Use this for user-initiated state changes (click to select, etc.)
 */
export function createSharedDispatch(canvas: CanvasAdapter) {
  return (patch: Partial<SharedEditorState>) => {
    // Update local store immediately
    useSharedEditorState.getState().applyPatch(patch);

    // Broadcast to other panels via extension host
    canvas.sendEvent({ type: 'state:update', patch });
  };
}
