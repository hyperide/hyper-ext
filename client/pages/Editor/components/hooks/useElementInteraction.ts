/**
 * @file Hook for managing element interaction handlers.
 *
 * Accessed via: CanvasEditor → IframeCanvas click/hover callbacks
 * Assumptions: nodeRef is resolved by TracingResolver before reaching this hook;
 *   null nodeRef means fiber couldn't resolve (server round-trip pending or no source)
 */

import type { SourceLocation } from '@shared/element-tracing/types';
import { useCallback } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';

interface UseElementInteractionProps {
  engine: CanvasEngine;
  selectedCommentId: string | null;
  selectedAnnotationIds: string[];
  setSelectedCommentId: (id: string | null) => void;
  setSelectedAnnotationIds: (ids: string[]) => void;
}

interface UseElementInteractionReturn {
  handleElementClick: (
    nodeRef: string | null,
    element: HTMLElement,
    event: MouseEvent,
    itemIndex: number,
    source: SourceLocation,
  ) => void;
  handleElementHover: (
    nodeRef: string | null,
    element: HTMLElement | null,
    itemIndex: number | null,
    source: SourceLocation | null,
  ) => void;
  handleHoverElement: (id: string | null) => void;
}

/**
 * Manages element click and hover interactions.
 * Uses nodeRef (fiber-resolved) for element identification.
 */
export function useElementInteraction({
  engine,
  selectedCommentId,
  selectedAnnotationIds,
  setSelectedCommentId,
  setSelectedAnnotationIds,
}: UseElementInteractionProps): UseElementInteractionReturn {
  // Handle element click with modifier key support
  const handleElementClick = useCallback(
    (nodeRef: string | null, _element: HTMLElement, event: MouseEvent, itemIndex: number, _source: SourceLocation) => {
      // Deselect comment when clicking on canvas (any element or empty space)
      if (selectedCommentId) {
        setSelectedCommentId(null);
      }

      // Clear annotation selection when clicking on instance or empty space
      if (selectedAnnotationIds.length > 0) {
        setSelectedAnnotationIds([]);
      }

      if (!nodeRef) {
        // Fiber couldn't resolve — clear selection (server round-trip may confirm later)
        engine.clearSelection();
        return;
      }

      // Cmd/Ctrl+Click — toggle selection
      if (event.metaKey || event.ctrlKey) {
        const currentSelection = engine.getSelection();
        if (currentSelection.selectedIds.includes(nodeRef)) {
          engine.removeFromSelection(nodeRef);
        } else {
          engine.addToSelection(nodeRef);
        }
      } else {
        // Normal click — replace selection with item index support
        // itemIndex is set when element is rendered multiple times via .map()
        engine.selectWithItemIndex(nodeRef, itemIndex);
      }
    },
    [engine, selectedCommentId, setSelectedCommentId, selectedAnnotationIds, setSelectedAnnotationIds],
  );

  // Handle element hover with item index support
  const handleElementHover = useCallback(
    (
      nodeRef: string | null,
      _element: HTMLElement | null,
      itemIndex: number | null,
      _source: SourceLocation | null,
    ) => {
      if (nodeRef) {
        engine.setHoveredWithItemIndex(nodeRef, itemIndex ?? null);
      } else {
        engine.setHovered(null);
      }
    },
    [engine],
  );

  // Simple hover handler (used by LeftSidebar tree)
  // Goes through engine so hoveredId in zustand store stays in sync
  const handleHoverElement = useCallback(
    (id: string | null) => {
      engine.setHovered(id);
    },
    [engine],
  );

  return {
    handleElementClick,
    handleElementHover,
    handleHoverElement,
  };
}
