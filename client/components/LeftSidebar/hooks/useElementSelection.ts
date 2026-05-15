/**
 * Compat hook for element selection in the tree.
 * SaaS: engine.select/addToSelection/removeFromSelection/selectMultiple.
 * VS Code: dispatch({ selectedIds: [id] }).
 */

import { useCallback, useMemo } from 'react';
import { useCanvasEngineOptional, useSelectedIdsOptional as useEngineSelectedIds } from '@/lib/canvas-engine';
import { resolveIdsToUuids } from '@/lib/element-tracing/id-bridge';
import { usePlatformCanvas } from '@/lib/platform';
import {
  createSharedDispatch,
  useCurrentComponent,
  useHoveredId as useSharedHoveredId,
  useSelectedIds as useSharedSelectedIds,
} from '@/lib/platform/shared-editor-state';
import type { TreeNode } from '../../ElementsTree';

function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findTreeNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

interface UseElementSelectionResult {
  selectedIds: string[];
  hoveredId: string | null;
  handleSelect: (elementId: string, event: React.MouseEvent | React.KeyboardEvent) => void;
  handleHover: (id: string | null) => void;
}

export function useElementSelection(
  elementsTree: TreeNode[],
  onHoverElement?: (id: string | null) => void,
): UseElementSelectionResult {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();

  // SaaS uses engine selection; VS Code uses shared state
  const engineSelectedIds = useEngineSelectedIds();
  const sharedSelectedIds = useSharedSelectedIds();
  const sharedHoveredId = useSharedHoveredId();

  // Build nodeRef→UUID lookup from tree node locations (extension mode).
  // Canvas sends nodeRef ("fileName:line:col"), tree uses UUID.
  const nodeRefToUuid = useMemo(() => {
    if (engine) return null; // SaaS uses id-bridge instead
    const map = new Map<string, string>();
    function walk(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.loc) {
          // nodeRef in extension iframe uses "fileName:line:col" format
          // Match by line:col suffix (fileName varies between contexts)
          map.set(`${node.loc.start.line}:${node.loc.start.column}`, node.id);
        }
        if (node.children) walk(node.children);
      }
    }
    walk(elementsTree);
    return map;
  }, [engine, elementsTree]);

  // Engine stores nodeRef (canvas clicks) or UUID (tree clicks).
  // Tree nodes use UUID — resolve nodeRefs to UUIDs for matching.
  const selectedIds = useMemo(() => {
    if (engine) return resolveIdsToUuids(engineSelectedIds, engine);
    if (!nodeRefToUuid || sharedSelectedIds.length === 0) return sharedSelectedIds;
    // Extension: map nodeRef → UUID for tree highlighting
    return sharedSelectedIds.map((id) => {
      // Try parsing as "fileName:line:col" nodeRef
      const parts = id.split(':');
      if (parts.length >= 3) {
        const col = Number(parts[parts.length - 1]);
        const line = Number(parts[parts.length - 2]);
        if (!Number.isNaN(line) && !Number.isNaN(col)) {
          return nodeRefToUuid.get(`${line}:${col}`) ?? id;
        }
      }
      return id;
    });
  }, [engine, engineSelectedIds, sharedSelectedIds, nodeRefToUuid]);

  const hoveredId = useMemo(() => {
    if (engine) return null;
    if (!sharedHoveredId || !nodeRefToUuid) return sharedHoveredId;
    const parts = sharedHoveredId.split(':');
    if (parts.length >= 3) {
      const col = Number(parts[parts.length - 1]);
      const line = Number(parts[parts.length - 2]);
      if (!Number.isNaN(line) && !Number.isNaN(col)) {
        return nodeRefToUuid.get(`${line}:${col}`) ?? sharedHoveredId;
      }
    }
    return sharedHoveredId;
  }, [engine, sharedHoveredId, nodeRefToUuid]);

  const dispatch = useMemo(() => (engine ? null : createSharedDispatch(canvas)), [engine, canvas]);
  const currentComponent = useCurrentComponent();

  const handleSelect = useCallback(
    (elementId: string, event: React.MouseEvent | React.KeyboardEvent) => {
      if (engine) {
        // SaaS path: full multi-select support
        const rootId = engine.getRoot().id;
        if (elementId === rootId) {
          engine.clearSelection();
          return;
        }

        const instance = engine.getInstance(elementId);
        if (instance && !engine.registry.get(instance.type)) {
          engine.clearSelection();
          return;
        }

        // Cmd/Ctrl+Click - toggle
        if (event.metaKey || event.ctrlKey) {
          const currentSelection = engine.getSelection();
          if (currentSelection.selectedIds.includes(elementId)) {
            engine.removeFromSelection(elementId);
          } else {
            engine.addToSelection(elementId);
          }
          return;
        }

        // Shift+Click - range select
        if (event.shiftKey) {
          const currentSelection = engine.getSelection();
          const lastSelectedId = currentSelection.selectedIds[currentSelection.selectedIds.length - 1];

          if (lastSelectedId) {
            const flattenTree = (nodes: TreeNode[]): string[] => {
              const result: string[] = [];
              for (const node of nodes) {
                result.push(node.id);
                if (node.children) {
                  result.push(...flattenTree(node.children));
                }
              }
              return result;
            };

            const allIds = flattenTree(elementsTree);
            const lastIndex = allIds.indexOf(lastSelectedId);
            const currentIndex = allIds.indexOf(elementId);

            if (lastIndex !== -1 && currentIndex !== -1) {
              const start = Math.min(lastIndex, currentIndex);
              const end = Math.max(lastIndex, currentIndex);
              engine.selectMultiple(allIds.slice(start, end + 1));
              return;
            }
          }
        }

        // Normal click
        engine.select(elementId);
      } else {
        // VS Code path: dispatch to shared state.
        // Canvas iframe expects nodeRef format ("fileName:line:col") for overlay rendering.
        // Tree sends UUID — find matching nodeRef from tree node loc if available.
        let dispatchId = elementId;
        const node = findTreeNode(elementsTree, elementId);
        if (node?.loc && currentComponent?.path) {
          // Build a syntheticRef that the iframe can use for overlay rendering.
          // Format: "fileName:line:col" — matches iframe interaction script's source cache keys.
          dispatchId = `${currentComponent.path}:${node.loc.start.line}:${node.loc.start.column}`;
        }
        console.debug('[tree-scroll] leg1 tree click → dispatch', { uuid: elementId, dispatchId });
        dispatch?.({ selectedIds: [dispatchId], selectedItemIndices: {}, selectedElementRuntimeStyle: null });
        canvas.sendEvent({ type: 'iframe:scrollToElement', elementId: dispatchId });
        // Also dispatch a local CustomEvent. NOTE: This stays in the LeftPanel webview's
        // window — VS Code webviews are isolated iframes so DOM events do not cross to
        // the PreviewPanel webview. Kept only for SaaS / single-window environments where
        // ElementsTree and the canvas iframe share a window.
        window.dispatchEvent(new CustomEvent('hypercanvas:treeSelect', { detail: { elementId: dispatchId } }));
      }
    },
    [engine, dispatch, elementsTree, canvas, currentComponent],
  );

  const handleHover = useCallback(
    (id: string | null) => {
      if (engine) {
        // SaaS: propagate via prop callback
        onHoverElement?.(id);
      } else {
        // VS Code: resolve UUID → nodeRef so iframe can find the DOM element
        let hoverId = id;
        if (id !== null && nodeRefToUuid && currentComponent?.path) {
          const node = findTreeNode(elementsTree, id);
          if (node?.loc) {
            hoverId = `${currentComponent.path}:${node.loc.start.line}:${node.loc.start.column}`;
          }
        }
        dispatch?.({ hoveredId: hoverId });
      }
    },
    [engine, dispatch, onHoverElement, nodeRefToUuid, elementsTree, currentComponent],
  );

  return { selectedIds, hoveredId, handleSelect, handleHover };
}
