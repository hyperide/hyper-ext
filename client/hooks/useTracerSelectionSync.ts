/**
 * @file Hook for syncing ElementTracer events with canvas engine selection.
 *
 * Accessed via: IframeCanvas.tsx
 * Assumptions: ElementTracer and CanvasEngine are both initialized before this hook activates.
 *
 * Handles two cases:
 * 1. Async resolution: when resolveClickLocal returns null (cache miss), the click handler
 *    fires with nodeRef=null. When the server responds via onSelectionResolved, update engine.
 * 2. NodeMap remapping: when NodeMapUpdate arrives with refMapping, remap current selection
 *    from old nodeRefs to new ones (handles undo/redo, external edits, position shifts).
 */

import type { SourceLocation } from '@shared/element-tracing/types';
import { useCallback, useEffect, useRef } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import type { ElementTracer } from '@/lib/element-tracing/element-tracer';

interface PendingSelection {
  source: SourceLocation;
  itemIndex: number;
}

interface UseTracerSelectionSyncOptions {
  tracer: ElementTracer | null;
  engine: CanvasEngine;
}

/**
 * Sync ElementTracer async events with CanvasEngine selection.
 * - Confirms pending selections when server resolves them.
 * - Remaps selections when NodeMapUpdate includes refMapping.
 */
export function useTracerSelectionSync({ tracer, engine }: UseTracerSelectionSyncOptions): {
  /** Call when click handler fires with nodeRef=null to register a pending selection. */
  setPendingSelection: (source: SourceLocation, itemIndex: number) => void;
} {
  const pendingRef = useRef<PendingSelection | null>(null);

  const setPendingSelection = useCallback((source: SourceLocation, itemIndex: number) => {
    pendingRef.current = { source, itemIndex };
  }, []);

  // Task 9: Subscribe to server-confirmed selections
  useEffect(() => {
    if (!tracer) return;

    const unsub = tracer.onSelectionResolved((response) => {
      if (!pendingRef.current) return;

      if (response.nodeRef && response.entry) {
        engine.selectWithItemIndex(response.nodeRef, pendingRef.current.itemIndex);
      }
      pendingRef.current = null;
    });

    return unsub;
  }, [tracer, engine]);

  // Task 9e: Remap selection on NodeMapUpdate with refMapping
  useEffect(() => {
    if (!tracer) return;

    const unsub = tracer.onNodeMapUpdate((msg) => {
      if (!msg.refMapping) return;

      const currentSelection = engine.getSelection();
      if (currentSelection.selectedIds.length === 0) return;

      const refMapping = msg.refMapping;
      const remapped = currentSelection.selectedIds.map((id) => refMapping[id] ?? id);

      // Only update if something actually changed
      if (remapped.some((id, i) => id !== currentSelection.selectedIds[i])) {
        engine.selectMultiple(remapped);
      }
    });

    return unsub;
  }, [tracer, engine]);

  return { setPendingSelection };
}
