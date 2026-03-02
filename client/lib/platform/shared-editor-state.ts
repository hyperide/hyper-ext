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
  init: (newState) => set(newState),
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
