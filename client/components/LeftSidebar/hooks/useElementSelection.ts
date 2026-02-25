/**
 * Compat hook for element selection in the tree.
 * SaaS: engine.select/addToSelection/removeFromSelection/selectMultiple.
 * VS Code: dispatch({ selectedIds: [id] }).
 */

import { useCallback, useMemo } from 'react';
import { useCanvasEngineOptional, useSelectedIds as useEngineSelectedIds } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import {
  createSharedDispatch,
  useHoveredId as useSharedHoveredId,
  useSelectedIds as useSharedSelectedIds,
} from '@/lib/platform/shared-editor-state';
import type { TreeNode } from '../../ElementsTree';

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

  const selectedIds = engine ? engineSelectedIds : sharedSelectedIds;
  const hoveredId = engine ? null : sharedHoveredId;

  const dispatch = useMemo(() => (engine ? null : createSharedDispatch(canvas)), [engine, canvas]);

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
        // VS Code path: simple select via dispatch
        dispatch?.({ selectedIds: [elementId] });
      }
    },
    [engine, dispatch, elementsTree],
  );

  const handleHover = useCallback(
    (id: string | null) => {
      if (engine) {
        // SaaS: propagate via prop callback
        onHoverElement?.(id);
      } else {
        // VS Code: dispatch to shared state
        dispatch?.({ hoveredId: id });
      }
    },
    [engine, dispatch, onHoverElement],
  );

  return { selectedIds, hoveredId, handleSelect, handleHover };
}
