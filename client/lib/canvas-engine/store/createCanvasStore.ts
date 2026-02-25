/**
 * Zustand store factory for Canvas Engine
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CanvasEngine } from "../core/CanvasEngine";
import type {
  ComponentInstance,
  DocumentTree,
  HistoryState,
  SelectionState,
} from "../models/types";

/**
 * Canvas store state
 */
export interface CanvasStore {
  // Engine instance
  engine: CanvasEngine;

  // Tree state
  tree: DocumentTree;
  instances: Map<string, ComponentInstance>;

  // Selection state
  selection: SelectionState;

  // History state
  history: HistoryState;

  // Computed values
  selectedInstances: ComponentInstance[];
  rootInstance: ComponentInstance;

  // Force re-render trigger
  _updateCounter: number;
  forceUpdate: () => void;
}

/**
 * Create canvas store from engine
 */
export function createCanvasStore(engine: CanvasEngine) {
  // Get initial state
  const initialTree = engine.getSnapshot();
  const initialSelection = engine.getSelection();
  const initialHistory = engine.getHistoryState();

  // Create store
  const store = create<CanvasStore>()(
    subscribeWithSelector((set, get) => {
      // Helper to get current instances map
      const getInstancesMap = () => {
        const tree = engine.getSnapshot();
        return new Map(Object.entries(tree.instances));
      };

      // Helper to get selected instances
      const getSelectedInstances = () => {
        const selection = engine.getSelection();
        return selection.selectedIds
          .map((id) => engine.getInstance(id))
          .filter((instance): instance is ComponentInstance => instance !== undefined);
      };

      // Update store state
      const updateState = () => {
        set({
          tree: engine.getSnapshot(),
          instances: getInstancesMap(),
          selection: engine.getSelection(),
          history: engine.getHistoryState(),
          selectedInstances: getSelectedInstances(),
          rootInstance: engine.getRoot(),
          _updateCounter: get()._updateCounter + 1,
        });
      };

      // Subscribe to engine events
      engine.events.on("tree:change", updateState);
      engine.events.on("selection:change", updateState);
      engine.events.on("hover:change", updateState);
      engine.events.on("history:change", updateState);
      engine.events.on("instance:insert", updateState);
      engine.events.on("instance:update", updateState);
      engine.events.on("instance:delete", updateState);
      engine.events.on("instance:move", updateState);
      engine.events.on("instance:duplicate", updateState);

      return {
        engine,
        tree: initialTree,
        instances: getInstancesMap(),
        selection: initialSelection,
        history: initialHistory,
        selectedInstances: getSelectedInstances(),
        rootInstance: engine.getRoot(),
        _updateCounter: 0,
        forceUpdate: () => updateState(),
      };
    })
  );

  return store;
}

/**
 * Store type
 */
export type CanvasStoreApi = ReturnType<typeof createCanvasStore>;
