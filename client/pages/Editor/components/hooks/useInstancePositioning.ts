/**
 * Hook for managing instance positions, sizes, and drag operations
 * Handles all position/size state and related callbacks for instances
 */

import type { CommentStatus } from '@shared/types/statuses';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isArrowAnnotation } from '@/../../shared/types/annotations';
import type { AnnotationStoreApi } from '@/lib/annotation-store';
import { getPreviewIframe } from '@/lib/dom-utils';
import { authFetch } from '@/utils/authFetch';
import type { InstancePosition } from './useCanvasComposition';

interface Comment {
  id: string;
  parentId: string | null;
  status: CommentStatus;
}

interface UseInstancePositioningProps {
  projectId: string | undefined;
  componentPath: string | undefined;
  canvasMode: 'single' | 'multi';
  comments: Comment[];
  annotationStore: AnnotationStoreApi;
  refetchComments: () => void;
  instancesReadyCounter: number;
}

interface UseInstancePositioningReturn {
  instances: Record<string, InstancePosition>;
  setInstances: React.Dispatch<React.SetStateAction<Record<string, InstancePosition>>>;
  draggingInstanceRef: React.MutableRefObject<{
    instanceId: string;
    deltaX: number;
    deltaY: number;
  } | null>;
  handleInstanceMove: (instanceId: string, x: number, y: number) => void;
  handleInstanceDragEnd: (instanceId: string, deltaX: number, deltaY: number) => void;
  handleInstanceDragging: (instanceId: string | null, deltaX: number, deltaY: number) => void;
  handleInstanceSizeChange: (width: number, height: number) => void;
  applyInstanceSizeChange: (width: number, height: number) => void;
  getInstanceIdsFromDOM: () => string[];
  pendingSizeChange: { width: number; height: number } | null;
  setPendingSizeChange: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
}

/**
 * Manages instance positioning, sizing, and drag operations
 */
export function useInstancePositioning({
  projectId,
  componentPath,
  canvasMode,
  comments,
  annotationStore,
  refetchComments,
  instancesReadyCounter,
}: UseInstancePositioningProps): UseInstancePositioningReturn {
  const [instances, setInstances] = useState<Record<string, InstancePosition>>({});

  // Track instance drag delta for real-time sticker movement (ref for RAF, no re-render)
  const draggingInstanceRef = useRef<{
    instanceId: string;
    deltaX: number;
    deltaY: number;
  } | null>(null);

  // Pending size change - shown in confirmation dialog when comments exist
  const [pendingSizeChange, setPendingSizeChange] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Get all instance IDs from iframe DOM
  const getInstanceIdsFromDOM = useCallback(() => {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) return [];
    const elements = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
    return Array.from(elements)
      .map((el) => (el as HTMLElement).dataset.canvasInstanceId)
      .filter((id): id is string => Boolean(id));
  }, []);

  // Update instance position in React state (preserve width/height)
  // Also update arrow positions to follow the instance
  const handleInstanceMove = useCallback(
    (instanceId: string, x: number, y: number) => {
      setInstances((prev) => {
        const oldPos = prev[instanceId];
        const deltaX = x - (oldPos?.x ?? x);
        const deltaY = y - (oldPos?.y ?? y);

        const updated = {
          ...prev,
          [instanceId]: { ...prev[instanceId], x, y },
        };

        // Update arrows that are bound to this instance
        if (deltaX !== 0 || deltaY !== 0) {
          for (const ann of annotationStore.getAll()) {
            if (!isArrowAnnotation(ann)) continue;
            const startBound = ann.startBinding?.instanceId === instanceId;
            const endBound = ann.endBinding?.instanceId === instanceId;
            if (!startBound && !endBound) continue;

            const posUpdates: Record<string, number> = {};
            if (startBound && endBound) {
              posUpdates.startX = ann.startX + deltaX;
              posUpdates.startY = ann.startY + deltaY;
              posUpdates.endX = ann.endX + deltaX;
              posUpdates.endY = ann.endY + deltaY;
            } else if (startBound) {
              posUpdates.startX = ann.startX + deltaX;
              posUpdates.startY = ann.startY + deltaY;
            } else {
              posUpdates.endX = ann.endX + deltaX;
              posUpdates.endY = ann.endY + deltaY;
            }
            annotationStore.update(ann.id, posUpdates);
          }
        }

        return updated;
      });
    },
    [annotationStore],
  );

  // Update sticker DOM positions immediately on drag end (visual sync before server response)
  const handleInstanceDragEnd = useCallback((instanceId: string, deltaX: number, deltaY: number) => {
    // Immediately update sticker DOM attributes to prevent jump back to old position
    // This happens BEFORE draggingInstanceRef is cleared, so RAF loop will see new positions
    const stickers = document.querySelectorAll(`[data-comment-instance-id="${instanceId}"]`);
    for (const sticker of stickers) {
      const el = sticker as HTMLElement;
      const oldX = Number.parseFloat(el.dataset.commentBaseX || '0');
      const oldY = Number.parseFloat(el.dataset.commentBaseY || '0');
      el.dataset.commentBaseX = String(oldX + deltaX);
      el.dataset.commentBaseY = String(oldY + deltaY);
    }
    // Comment DB update is handled by the PUT /instance/:id endpoint on the backend
  }, []);

  // Refetch comments when the PUT /instance/:id endpoint reports it moved comments
  useEffect(() => {
    const handler = () => refetchComments();
    window.addEventListener('canvas:comments-updated', handler);
    return () => window.removeEventListener('canvas:comments-updated', handler);
  }, [refetchComments]);

  // Track instance drag delta for real-time sticker movement
  const handleInstanceDragging = useCallback((instanceId: string | null, deltaX: number, deltaY: number) => {
    if (instanceId) {
      draggingInstanceRef.current = { instanceId, deltaX, deltaY };
    } else {
      draggingInstanceRef.current = null;
    }
  }, []);

  // Actually apply instance size change (called directly or after confirmation)
  const applyInstanceSizeChange = useCallback(
    (width: number, height: number) => {
      console.log('[useInstancePositioning] applyInstanceSizeChange CALLED:', {
        width,
        height,
      });

      // Get real instances from DOM to include "default" and other dynamic instances
      const domInstanceIds = getInstanceIdsFromDOM();

      // Update all instances in local state (merge state + DOM instances)
      setInstances((prev) => {
        console.log('[useInstancePositioning] setInstances prev:', prev);
        const updated: typeof prev = {};

        // First, update existing instances from state
        for (const [id, pos] of Object.entries(prev)) {
          updated[id] = { ...pos, width, height };
        }

        // Then, add any DOM instances not in state (like "default")
        for (const instanceId of domInstanceIds) {
          if (!updated[instanceId]) {
            updated[instanceId] = { x: 0, y: 0, width, height };
          }
        }

        // In single mode, always ensure 'default' instance exists
        // (even if getInstanceIdsFromDOM returned empty - iframe might not be ready)
        if (canvasMode === 'single' && !updated.default) {
          updated.default = { x: 0, y: 0, width, height };
        }

        console.log('[useInstancePositioning] setInstances updated:', updated);
        return updated;
      });

      // Save size to server via PUT per-instance (upserts)
      if (projectId && componentPath) {
        const saveSize = async () => {
          try {
            // Collect all instance IDs from DOM (server-side instances
            // are covered because they render in the iframe)
            const currentDomInstanceIds = getInstanceIdsFromDOM();
            const allInstanceIds = new Set([...currentDomInstanceIds, ...(canvasMode === 'single' ? ['default'] : [])]);

            // PUT each instance with new size (handleUpdateInstance upserts)
            const promises = Array.from(allInstanceIds).map((instanceId) =>
              authFetch(`/api/canvas-composition/${projectId}/instance/${encodeURIComponent(instanceId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  componentPath,
                  updates: { width, height },
                }),
              }),
            );

            await Promise.all(promises);
          } catch (error) {
            console.error('[useInstancePositioning] Failed to save instance size:', error);
          }
        };
        saveSize();
      }
    },
    [projectId, componentPath, getInstanceIdsFromDOM, canvasMode],
  );

  // Handle instance size change request - shows warning if comments exist
  const handleInstanceSizeChange = useCallback(
    (width: number, height: number) => {
      // Check if there are unresolved comments in single mode
      const hasComments = canvasMode === 'single' && comments.some((c) => !c.parentId && c.status !== 'resolved');

      if (hasComments) {
        // Show confirmation dialog
        setPendingSizeChange({ width, height });
      } else {
        // Apply directly
        applyInstanceSizeChange(width, height);
      }
    },
    [canvasMode, comments, applyInstanceSizeChange],
  );

  // Sync instances state with DOM after instance elements appear
  // This ensures "default" and other dynamic instances get sizes from composition
  useEffect(() => {
    if (!projectId || !componentPath) return;
    if (instancesReadyCounter === 0) return; // Wait for instances to be ready

    const domInstanceIds = getInstanceIdsFromDOM();
    if (domInstanceIds.length === 0) return;

    setInstances((prev) => {
      // Find first instance with size to use as template
      const templateInstance = Object.values(prev).find((inst) => inst.width && inst.height);

      if (!templateInstance) return prev;

      let hasChanges = false;
      const updated = { ...prev };

      // Add DOM instances not in state with template size
      for (const instanceId of domInstanceIds) {
        if (!updated[instanceId]) {
          updated[instanceId] = {
            x: 0,
            y: 0,
            width: templateInstance.width,
            height: templateInstance.height,
          };
          hasChanges = true;
        }
      }

      return hasChanges ? updated : prev;
    });
  }, [projectId, componentPath, instancesReadyCounter, getInstanceIdsFromDOM]);

  return {
    instances,
    setInstances,
    draggingInstanceRef,
    handleInstanceMove,
    handleInstanceDragEnd,
    handleInstanceDragging,
    handleInstanceSizeChange,
    applyInstanceSizeChange,
    getInstanceIdsFromDOM,
    pendingSizeChange,
    setPendingSizeChange,
  };
}
