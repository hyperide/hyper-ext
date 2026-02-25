import { useCallback } from 'react';
import type { CondBoundary } from '@/components/CondOverlay';
import type { MapBoundary } from '@/components/MapOverlay';
import type { CanvasEngine } from '@/lib/canvas-engine';

interface UseCondMapSaveOptions {
  editingCondBoundary: CondBoundary | null;
  editingMapBoundary: MapBoundary | null;
  engine: CanvasEngine;
}

interface UseCondMapSaveResult {
  handleCondSave: (condId: string, newExpression: string) => void;
  handleMapSave: (parentMapId: string, newExpression: string) => void;
}

/**
 * Handlers for saving conditional and map expressions.
 * Both make API calls and trigger component re-parse on success.
 */
export function useCondMapSave({
  editingCondBoundary,
  editingMapBoundary,
  engine,
}: UseCondMapSaveOptions): UseCondMapSaveResult {
  const handleCondSave = useCallback(
    (condId: string, newExpression: string) => {
      if (!editingCondBoundary) {
        console.error('[handleCondSave] No editingCondBoundary');
        return;
      }

      // Get filePath from engine root metadata
      const root = engine.getRoot();
      const filePath = root.metadata?.filePath;

      if (!filePath) {
        console.error('[handleCondSave] No filePath in root metadata');
        alert('No file path available');
        return;
      }

      // Route through engine for undo/redo support
      engine.editASTCondition({
        type: 'condition',
        boundaryId: condId,
        elementId: editingCondBoundary.elementId,
        filePath: filePath as string,
        oldExpression: editingCondBoundary.expression,
        newExpression,
      });
    },
    [editingCondBoundary, engine],
  );

  const handleMapSave = useCallback(
    (parentMapId: string, newExpression: string) => {
      if (!editingMapBoundary) {
        console.error('[handleMapSave] No editingMapBoundary');
        return;
      }

      // Get filePath from engine root metadata
      const root = engine.getRoot();
      const filePath = root.metadata?.filePath;

      if (!filePath) {
        console.error('[handleMapSave] No filePath in root metadata');
        alert('No file path available');
        return;
      }

      // Route through engine for undo/redo support
      engine.editASTCondition({
        type: 'map',
        boundaryId: parentMapId,
        elementId: editingMapBoundary.elementId,
        filePath: filePath as string,
        oldExpression: editingMapBoundary.expression,
        newExpression,
      });
    },
    [editingMapBoundary, engine],
  );

  return {
    handleCondSave,
    handleMapSave,
  };
}
