import { createOverlayRenderer } from '@shared/canvas-interaction/overlay-renderer';
import { useEffect } from 'react';
import { getPreviewIframe } from '@/lib/dom-utils';

interface UseSelectionOverlaysOptions {
  enabled: boolean;
  overlayContainerRef: React.RefObject<HTMLDivElement>;
  hoveredId: string | null;
  hoveredItemIndex: number | null;
  selectedIds: string[];
  selectedItemIndices: Map<string, number | null>;
  activeDesignInstanceId: string | null;
  viewportZoom: number;
  iframeLoadedCounter: number;
  editorMode?: 'design' | 'interact' | 'code';
  onPlaceholderClick?: (elementId: string) => void;
}

/**
 * RAF loop for rendering selection overlays (hover + selection rectangles)
 * and empty container placeholder overlays.
 * Uses direct DOM manipulation for performance.
 *
 * Thin wrapper around shared createOverlayRenderer.
 */
export function useSelectionOverlays({
  enabled,
  overlayContainerRef,
  hoveredId,
  hoveredItemIndex,
  selectedIds,
  selectedItemIndices,
  activeDesignInstanceId,
  viewportZoom,
  iframeLoadedCounter,
  editorMode,
  onPlaceholderClick,
}: UseSelectionOverlaysOptions) {
  useEffect(() => {
    if (!enabled) {
      if (overlayContainerRef.current) {
        // Clear only selection overlays
        const selectionElements = overlayContainerRef.current.querySelectorAll('[data-selection-overlay]');
        for (const el of selectionElements) {
          el.remove();
        }
        // Clear placeholder overlays
        const placeholderElements = overlayContainerRef.current.querySelectorAll('[data-placeholder-overlay]');
        for (const el of placeholderElements) {
          el.remove();
        }
      }
      return;
    }

    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      return;
    }

    const container = overlayContainerRef.current;
    if (!container) return;

    const renderer = createOverlayRenderer(iframe, container, {
      viewportZoom,
      editorMode,
      onPlaceholderClick,
    });

    renderer.update({
      selectedIds,
      hoveredId,
      hoveredItemIndex,
      selectedItemIndices,
      activeInstanceId: activeDesignInstanceId,
      viewportZoom,
      editorMode,
    });

    return () => renderer.dispose();
  }, [
    enabled,
    overlayContainerRef,
    hoveredId,
    hoveredItemIndex,
    selectedIds,
    selectedItemIndices,
    activeDesignInstanceId,
    viewportZoom,
    iframeLoadedCounter,
    editorMode,
    onPlaceholderClick,
  ]);
}
