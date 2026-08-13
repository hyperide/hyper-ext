/**
 * Hook for board mode drawing state
 * Manages drawing tool, style, annotations and annotation operations
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { type AnnotationElement, isArrowAnnotation } from '@/../../shared/types/annotations';
import type { AnnotationOperationCallbacks } from '@/components/annotations';
import { type AnnotationStoreApi, createAnnotationStore, useAnnotationStoreSnapshot } from '@/lib/annotation-store';
import type { CanvasEngine } from '@/lib/canvas-engine';
import {
  AnnotationBatchDeleteOperation,
  AnnotationDeleteOperation,
  AnnotationInsertOperation,
  AnnotationMoveOperation,
  AnnotationUpdateOperation,
} from '@/lib/canvas-engine';

export type BoardTool = 'select' | 'arrow' | 'text';

export interface DrawingStyle {
  color: string;
  strokeWidth: number;
  fontSize: number;
}

interface UseDrawingStateProps {
  engine: CanvasEngine;
  projectId: string | undefined;
  componentPath: string | undefined;
}

interface UseDrawingStateReturn {
  // Tool state
  boardTool: BoardTool;
  setBoardTool: React.Dispatch<React.SetStateAction<BoardTool>>;

  // Drawing style
  drawingStyle: DrawingStyle;
  effectiveDrawingStyle: DrawingStyle;
  handleDrawingStyleChange: (style: Partial<DrawingStyle>) => void;

  // Annotations state
  annotations: AnnotationElement[];
  selectedAnnotationIds: string[];
  setSelectedAnnotationIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedAnnotations: AnnotationElement[];

  // Callbacks
  handleAnnotationsChange: (newAnnotations: AnnotationElement[]) => void;
  handleAnnotationSelectionChange: (ids: string[]) => void;
  handleDrawingToolComplete: () => void;
  annotationOperations: AnnotationOperationCallbacks;
  annotationStore: AnnotationStoreApi;

  // Arrow bindings signature for tracking bound arrows
  arrowBindingsSignature: string;
}

/**
 * Manages drawing state for board mode
 */
export function useDrawingState({ engine, projectId, componentPath }: UseDrawingStateProps): UseDrawingStateReturn {
  // Board mode drawing state
  const [boardTool, setBoardTool] = useState<BoardTool>('select');
  const [drawingStyle, setDrawingStyle] = useState<DrawingStyle>({
    color: '#000000',
    strokeWidth: 3,
    fontSize: 20,
  });
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const previousAnnotationsSignatureRef = useRef<string>('');

  // Create annotation store — recreated when project/component changes
  const annotationStore = useMemo<AnnotationStoreApi>(() => {
    if (!projectId || !componentPath) {
      // Return a no-op store when no project is active
      return createAnnotationStore('', '');
    }
    return createAnnotationStore(projectId, componentPath);
  }, [projectId, componentPath]);

  // Subscribe to store updates via useSyncExternalStore
  const annotations = useAnnotationStoreSnapshot(annotationStore);

  // Get selected annotations from IDs
  const selectedAnnotations = useMemo(() => {
    return annotations.filter((a) => selectedAnnotationIds.includes(a.id));
  }, [annotations, selectedAnnotationIds]);

  // Compute effective drawing style based on selected elements
  const effectiveDrawingStyle = useMemo(() => {
    if (selectedAnnotations.length === 0) {
      return drawingStyle;
    }

    // Use first selected element's styles
    const first = selectedAnnotations[0];
    if (first.type === 'arrow') {
      return {
        color: first.strokeColor ?? drawingStyle.color,
        strokeWidth: first.strokeWidth ?? drawingStyle.strokeWidth,
        fontSize: drawingStyle.fontSize,
      };
    }
    if (first.type === 'text') {
      return {
        color: first.color ?? drawingStyle.color,
        strokeWidth: drawingStyle.strokeWidth,
        fontSize: first.fontSize ?? drawingStyle.fontSize,
      };
    }
    return drawingStyle;
  }, [selectedAnnotations, drawingStyle]);

  // Handle drawing style changes — update selected annotations via store
  const handleDrawingStyleChange = useCallback(
    (style: Partial<DrawingStyle>) => {
      // Always update default style for new elements
      setDrawingStyle((prev) => ({ ...prev, ...style }));

      // If there are selected annotations, update them too
      if (selectedAnnotationIds.length === 0) return;

      for (const id of selectedAnnotationIds) {
        const ann = annotationStore.get(id);
        if (!ann) continue;

        if (ann.type === 'arrow') {
          const updates: Partial<typeof ann> = {};
          if (style.color !== undefined) updates.strokeColor = style.color;
          if (style.strokeWidth !== undefined) updates.strokeWidth = style.strokeWidth;
          if (Object.keys(updates).length > 0) {
            annotationStore.update(id, updates);
          }
        }

        if (ann.type === 'text') {
          const updates: Partial<typeof ann> = {};
          if (style.color !== undefined) updates.color = style.color;
          if (style.fontSize !== undefined) updates.fontSize = style.fontSize;
          if (Object.keys(updates).length > 0) {
            annotationStore.update(id, updates);
          }
        }
      }
    },
    [selectedAnnotationIds, annotationStore],
  );

  // Memoize arrow bindings signature for tracking bound arrows
  const arrowBindingsSignature = useMemo(() => {
    return annotations
      .filter(
        (a): a is import('@/../../shared/types/annotations').ArrowAnnotation =>
          a?.type === 'arrow' && (a.startBinding !== null || a.endBinding !== null),
      )
      .map((a) => `${a.id}:${a.startBinding?.instanceId}:${a.endBinding?.instanceId}`)
      .sort()
      .join(',');
  }, [annotations]);

  // Handle annotations change (for visual preview during drag — local only)
  const handleAnnotationsChange = useCallback(
    (newAnnotations: AnnotationElement[]) => {
      // Create signature from element IDs, versions, positions, and labels
      const currentSignature = newAnnotations
        .map((el) => {
          if (isArrowAnnotation(el)) {
            return `${el.id}:${el.version}:${el.startX}:${el.startY}:${el.endX}:${el.endY}:${el.label || ''}`;
          }
          // Text annotation - include position for live preview
          const textEl = el as {
            id: string;
            version: number;
            x: number;
            y: number;
          };
          return `${textEl.id}:${textEl.version}:${textEl.x}:${textEl.y}`;
        })
        .join(',');

      // Compare signatures to detect real changes
      if (previousAnnotationsSignatureRef.current !== currentSignature) {
        previousAnnotationsSignatureRef.current = currentSignature;
        // Preview during drag — no server calls
        annotationStore.replaceAll(newAnnotations);
      }
    },
    [annotationStore],
  );

  // Annotation operation callbacks for undo/redo support
  const annotationOperations = useMemo<AnnotationOperationCallbacks>(
    () => ({
      onInsert: (annotation) => {
        const op = new AnnotationInsertOperation({
          annotation,
          store: annotationStore,
        });
        engine.executeAnnotationOperation(op);
      },
      onUpdate: (id, updates) => {
        const op = new AnnotationUpdateOperation({
          id,
          updates,
          store: annotationStore,
        });
        engine.executeAnnotationOperation(op);
      },
      onDelete: (ids) => {
        if (ids.length === 1) {
          const op = new AnnotationDeleteOperation({
            id: ids[0],
            store: annotationStore,
          });
          engine.executeAnnotationOperation(op);
        } else {
          const op = new AnnotationBatchDeleteOperation({
            ids,
            store: annotationStore,
          });
          engine.executeAnnotationOperation(op);
        }
      },
      onMove: (id, oldPosition, newPosition) => {
        const op = new AnnotationMoveOperation({
          id,
          oldPosition,
          newPosition,
          store: annotationStore,
        });
        engine.executeAnnotationOperation(op);
      },
    }),
    [engine, annotationStore],
  );

  // Handle tool completion (auto-return to select mode)
  const handleDrawingToolComplete = useCallback(() => {
    setBoardTool('select');
  }, []);

  // Handle annotation selection change - clear instance selection when annotations are selected
  const handleAnnotationSelectionChange = useCallback(
    (ids: string[]) => {
      setSelectedAnnotationIds(ids);
      // Clear instance selection when selecting annotations
      if (ids.length > 0) {
        engine.clearSelection();
      }
    },
    [engine],
  );

  return {
    boardTool,
    setBoardTool,
    drawingStyle,
    effectiveDrawingStyle,
    handleDrawingStyleChange,
    annotations,
    selectedAnnotationIds,
    setSelectedAnnotationIds,
    selectedAnnotations,
    handleAnnotationsChange,
    handleAnnotationSelectionChange,
    handleDrawingToolComplete,
    annotationOperations,
    annotationStore,
    arrowBindingsSignature,
  };
}
