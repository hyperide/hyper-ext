/**
 * Hook for managing instance interaction handlers
 * Handles click, double-click, and badge click for instances
 */

import { useCallback } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';

interface UseInstanceInteractionProps {
  engine: CanvasEngine;
  mode: 'design' | 'interact' | 'code';
  canvasMode: 'single' | 'multi';
  activeDesignInstanceId: string | null;
  isBoardModeActive: boolean;
  selectedCommentId: string | null;
  setActiveDesignInstanceId: (id: string | null) => void;
  setActiveBoardInstance: (id: string | null) => void;
  setBoardModeActive: (value: boolean) => void;
  setSelectedCommentId: (id: string | null) => void;
  setSelectedAnnotationIds: (ids: string[]) => void;
  setEditingInstanceId: (id: string | null) => void;
  setEditPopupOpen: (open: boolean) => void;
}

interface UseInstanceInteractionReturn {
  handleInstanceSingleClick: (instanceId: string) => void;
  handleInstanceDoubleClick: (instanceId: string) => void;
  handleInstanceBadgeClick: (instanceId: string) => void;
  handleOtherInstanceClick: (instanceId: string) => void;
  handleEmptyClick: () => void;
}

/**
 * Manages instance interaction handlers (click, double-click, badge)
 */
export function useInstanceInteraction({
  engine,
  mode,
  canvasMode,
  activeDesignInstanceId,
  isBoardModeActive,
  selectedCommentId,
  setActiveDesignInstanceId,
  setActiveBoardInstance,
  setBoardModeActive,
  setSelectedCommentId,
  setSelectedAnnotationIds,
  setEditingInstanceId,
  setEditPopupOpen,
}: UseInstanceInteractionProps): UseInstanceInteractionReturn {
  // Single click in board mode - select instance via engine (supports multi-select with Cmd/Ctrl)
  const handleInstanceSingleClick = useCallback(
    (instanceId: string) => {
      engine.select(instanceId);
      // Clear annotation selection when selecting instance
      setSelectedAnnotationIds([]);
    },
    [engine, setSelectedAnnotationIds],
  );

  // Double click - transition to design mode
  const handleInstanceDoubleClick = useCallback(
    (instanceId: string) => {
      console.log('[Double Click] Start transition to design mode:', instanceId);

      // Update mode
      setActiveBoardInstance(null);
      setActiveDesignInstanceId(instanceId);
      setBoardModeActive(false);
      engine.setMode('design');
    },
    [engine, setActiveBoardInstance, setActiveDesignInstanceId, setBoardModeActive],
  );

  // Badge click - open edit popup or activate instance
  const handleInstanceBadgeClick = useCallback(
    (instanceId: string) => {
      console.log('[Badge Click]', {
        instanceId,
        mode,
        boardModeActive: isBoardModeActive,
        activeInstanceId: activeDesignInstanceId,
      });

      // In board mode: always open edit popup
      if (isBoardModeActive) {
        setEditingInstanceId(instanceId);
        setEditPopupOpen(true);
        return;
      }

      // In design mode: check if this is the active instance
      if (mode === 'design') {
        if (instanceId === activeDesignInstanceId) {
          // Click on active instance badge → open edit popup
          setEditingInstanceId(instanceId);
          setEditPopupOpen(true);
        } else {
          // Click on inactive instance badge → activate it
          setActiveDesignInstanceId(instanceId);
        }
      }
    },
    [
      mode,
      activeDesignInstanceId,
      isBoardModeActive,
      setEditingInstanceId,
      setEditPopupOpen,
      setActiveDesignInstanceId,
    ],
  );

  // Click on another instance while staying in current mode
  const handleOtherInstanceClick = useCallback(
    (instanceId: string) => {
      setActiveDesignInstanceId(instanceId);
      // Mode remains the same (design or interact)
    },
    [setActiveDesignInstanceId],
  );

  // Click on empty canvas area
  const handleEmptyClick = useCallback(() => {
    // Deselect comment when clicking empty area
    if (selectedCommentId) {
      setSelectedCommentId(null);
    }

    // Exit to board mode only in multi-instance mode
    if (canvasMode === 'multi') {
      setActiveDesignInstanceId(null);
      setActiveBoardInstance(null); // Clear board selection when returning to board mode
      setBoardModeActive(true);
    }
    // In single mode, do nothing
  }, [
    canvasMode,
    selectedCommentId,
    setSelectedCommentId,
    setActiveDesignInstanceId,
    setActiveBoardInstance,
    setBoardModeActive,
  ]);

  return {
    handleInstanceSingleClick,
    handleInstanceDoubleClick,
    handleInstanceBadgeClick,
    handleOtherInstanceClick,
    handleEmptyClick,
  };
}
