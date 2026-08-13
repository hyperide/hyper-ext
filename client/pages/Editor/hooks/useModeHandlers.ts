import { useCallback } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { getPreviewIframe } from '@/lib/dom-utils';
import type { Tool } from '@/components/Toolbar';

interface UseModeHandlersDeps {
  engine: CanvasEngine;
  isBoardModeActive: boolean;
  isCodeEditorMode: boolean;
  mode: 'design' | 'interact' | 'code';
  setActiveDesignInstanceId: (id: string | null) => void;
  setActiveBoardInstance: (id: string | null) => void;
  setBoardModeActive: (active: boolean) => void;
  setEditingInstanceId: (id: string | null) => void;
  setEditPopupOpen: (open: boolean) => void;
  savePersistedState: (state: { mode: 'board' | 'design' | 'interact' | 'code' }) => void;
  loadComponent: (path: string, sampleName?: string) => void;
}

export function useModeHandlers(deps: UseModeHandlersDeps) {
  const {
    engine,
    isBoardModeActive,
    isCodeEditorMode,
    mode,
    setActiveDesignInstanceId,
    setActiveBoardInstance,
    setBoardModeActive,
    setEditingInstanceId,
    setEditPopupOpen,
    savePersistedState,
    loadComponent,
  } = deps;

  const handleSingleModeBadgeClick = useCallback(() => {
    setEditingInstanceId('default');
    setEditPopupOpen(true);
  }, [setEditingInstanceId, setEditPopupOpen]);

  const handleToolbarModeChange = useCallback(
    (newMode: Tool) => {
      setBoardModeActive(newMode === 'board');

      if (newMode === 'board') {
        savePersistedState({ mode: 'board' });
        setActiveDesignInstanceId(null);
        setActiveBoardInstance(null);
        return;
      }

      engine.setMode(newMode);

      if (newMode === 'code') {
        setActiveDesignInstanceId(null);
        setActiveBoardInstance(null);
        return;
      }

      if (isCodeEditorMode || isBoardModeActive) {
        setActiveBoardInstance(null);
        const iframe = getPreviewIframe();
        if (iframe?.contentDocument) {
          const iframeInstances = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
          if (iframeInstances.length > 0) {
            const firstInstanceId = (iframeInstances[0] as HTMLElement).dataset.canvasInstanceId;
            if (firstInstanceId) {
              setActiveDesignInstanceId(firstInstanceId);
            }
          }
        }
      }
    },
    [
      engine,
      isBoardModeActive,
      isCodeEditorMode,
      setActiveDesignInstanceId,
      setActiveBoardInstance,
      setBoardModeActive,
      savePersistedState,
    ],
  );

  const handleGoToVisual = useCallback(
    (uniqId: string, _elementType: string, filePath: string) => {
      loadComponent(filePath);
      const handleComponentLoaded = () => {
        if (engine.getMode() !== 'design') {
          engine.setMode('design');
        }
        setTimeout(() => {
          engine.select(uniqId);
        }, 100);
        window.removeEventListener('component-loaded', handleComponentLoaded);
      };
      window.addEventListener('component-loaded', handleComponentLoaded);
    },
    [engine, loadComponent],
  );

  return {
    handleSingleModeBadgeClick,
    handleToolbarModeChange,
    handleGoToVisual,
  };
}
