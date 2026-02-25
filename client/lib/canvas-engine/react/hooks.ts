/**
 * React hooks for Canvas Engine
 */

import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useCanvasEngineContext } from "./CanvasEngineProvider";
import type {
  CanvasEngine} from "../core/CanvasEngine";
import type {
  ComponentInstance,
  HistoryState,
  SelectionState,
} from "../models/types";

/**
 * Get Canvas Engine instance
 */
export function useCanvasEngine(): CanvasEngine {
  const { engine } = useCanvasEngineContext();
  return engine;
}

/**
 * Get Canvas Store
 */
export function useCanvasStore() {
  const { store } = useCanvasEngineContext();
  return store;
}

/**
 * Get instance by ID
 */
export function useInstance(id: string): ComponentInstance | undefined {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.instances.get(id));
}

/**
 * Get children of instance
 */
export function useChildren(parentId: string): ComponentInstance[] {
  const { store } = useCanvasEngineContext();

  return useStore(
    store,
    useShallow((state) => {
      const parent = state.instances.get(parentId);
      if (!parent) return [];

      return parent.children
        .map((childId) => state.instances.get(childId))
        .filter((child): child is ComponentInstance => child !== undefined);
    })
  );
}

/**
 * Get parent of instance
 */
export function useParent(id: string): ComponentInstance | null {
  const { store } = useCanvasEngineContext();

  return useStore(store, (state) => {
    const instance = state.instances.get(id);
    if (!instance || !instance.parentId) return null;

    return state.instances.get(instance.parentId) ?? null;
  });
}

/**
 * Get root instance
 */
export function useRoot(): ComponentInstance {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.rootInstance);
}

/**
 * Get all instances
 */
export function useAllInstances(): ComponentInstance[] {
  const { store } = useCanvasEngineContext();
  return useStore(store, useShallow((state) => Array.from(state.instances.values())));
}

/**
 * Get selection state
 */
export function useSelection(): SelectionState {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection);
}

/**
 * Get selected instance IDs
 */
export function useSelectedIds(): string[] {
  const { store } = useCanvasEngineContext();
  return useStore(store, useShallow((state) => state.selection.selectedIds));
}

/**
 * Get selected item indices for map-rendered elements
 * Returns Map<uniqId, itemIndex | null>
 */
export function useSelectedItemIndices(): Map<string, number | null> {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection.selectedItemIndices);
}

/**
 * Get selected instances
 */
export function useSelectedInstances(): ComponentInstance[] {
  const { store } = useCanvasEngineContext();
  return useStore(store, useShallow((state) => state.selectedInstances));
}

/**
 * Get first selected instance
 */
export function useSelectedInstance(): ComponentInstance | null {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selectedInstances[0] ?? null);
}

/**
 * Check if instance is selected
 */
export function useIsSelected(id: string): boolean {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection.selectedIds.includes(id));
}

/**
 * Get hovered instance ID
 */
export function useHoveredId(): string | null {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection.hoveredId);
}

/**
 * Get hovered item index for map-rendered elements
 */
export function useHoveredItemIndex(): number | null {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection.hoveredItemIndex);
}

/**
 * Check if instance is hovered
 */
export function useIsHovered(id: string): boolean {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.selection.hoveredId === id);
}

/**
 * Get history state
 */
export function useHistory(): HistoryState {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.history);
}

/**
 * Can undo?
 */
export function useCanUndo(): boolean {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.history.canUndo);
}

/**
 * Can redo?
 */
export function useCanRedo(): boolean {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.history.canRedo);
}

/**
 * Get tree snapshot
 */
export function useTreeSnapshot() {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.tree);
}

/**
 * Force update (useful for debugging)
 */
export function useForceUpdate() {
  const { store } = useCanvasEngineContext();
  return useStore(store, (state) => state.forceUpdate);
}
