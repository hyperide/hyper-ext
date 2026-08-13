import { useCallback } from 'react';
import { getPreviewIframe } from '@/lib/dom-utils';
import type { ViewportState } from '@/../../shared/types/canvas';

interface UseViewportHandlersDeps {
  viewport: ViewportState;
  setViewport: (v: ViewportState) => void;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  isBoardModeActive: boolean;
}

export function useViewportHandlers(deps: UseViewportHandlersDeps) {
  const { viewport, setViewport, canvasContainerRef, isBoardModeActive } = deps;

  const resetZoomToTopLeftInstance = useCallback(() => {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      setViewport({ zoom: 1, panX: 0, panY: 0 });
      return;
    }

    const instanceElements = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
    if (instanceElements.length === 0) {
      setViewport({ zoom: 1, panX: 0, panY: 0 });
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const element of instanceElements) {
      const htmlElement = element as HTMLElement;
      const left = Number.parseInt(htmlElement.style.left || '0', 10);
      const top = Number.parseInt(htmlElement.style.top || '0', 10);
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
    }

    const padding = 40;
    setViewport({
      zoom: 1,
      panX: -minX + padding,
      panY: -minY + padding,
    });
  }, [setViewport]);

  const handleFitToContent = useCallback(() => {
    if (!isBoardModeActive || !canvasContainerRef.current) return;

    const iframe = getPreviewIframe();
    if (!iframe || !iframe.contentDocument) return;

    const instanceElements = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
    if (instanceElements.length === 0) return;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const element of instanceElements) {
      const htmlElement = element as HTMLElement;
      const left = Number.parseInt(htmlElement.style.left || '0', 10);
      const top = Number.parseInt(htmlElement.style.top || '0', 10);
      const rect = htmlElement.getBoundingClientRect();
      const width = rect.width / viewport.zoom;
      const height = rect.height / viewport.zoom;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const containerRect = canvasContainerRef.current.getBoundingClientRect();
    const padding = 80;

    const zoomX = (containerRect.width - padding * 2) / contentWidth;
    const zoomY = (containerRect.height - padding * 2) / contentHeight;
    const newZoom = Math.min(zoomX, zoomY, 2);

    const newPanX = (containerRect.width - contentWidth * newZoom) / 2 - minX * newZoom;
    const newPanY = (containerRect.height - contentHeight * newZoom) / 2 - minY * newZoom;

    setViewport({
      zoom: newZoom,
      panX: newPanX,
      panY: newPanY,
    });
  }, [isBoardModeActive, viewport.zoom, canvasContainerRef, setViewport]);

  return {
    resetZoomToTopLeftInstance,
    handleFitToContent,
  };
}
