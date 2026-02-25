/**
 * Hook for viewport controls (zoom & pan)
 * Active in all modes
 */

import { type RefObject, useCallback, useEffect, useRef } from 'react';
import type { ViewportState } from '@/../../shared/types/canvas';
import { getPreviewIframe } from '@/lib/dom-utils';
import { clampZoom } from '@/lib/viewport';

interface UseViewportControlsProps {
  viewport: ViewportState;
  onViewportChange: (viewport: ViewportState) => void;
  containerRef: RefObject<HTMLElement>;
  enabled?: boolean;
}

export function useViewportControls({
  viewport,
  onViewportChange,
  containerRef,
  enabled = true,
}: UseViewportControlsProps) {
  // Pan state
  const panStateRef = useRef<{
    isPanning: boolean;
    startX: number;
    startY: number;
    initialPanX: number;
    initialPanY: number;
  }>({
    isPanning: false,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  // Track space key for pan mode
  const spaceKeyDownRef = useRef(false);

  /**
   * Handle wheel event for zoom and pan
   * - Ctrl/Cmd+Wheel: zoom (also works for trackpad pinch-to-zoom on Mac)
   * - Shift+Wheel: horizontal pan
   * - Plain Wheel: vertical pan
   */
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Skip if viewport controls are disabled (e.g. single mode)
      if (!enabled) return;

      // Only handle wheel events inside the canvas container
      // Allow sidebars and popovers to scroll normally
      const container = containerRef.current;
      if (!container) return;

      const target = e.target as Element;
      // Check if event is from iframe document (design/interact mode)
      // In this case, target belongs to iframe.contentDocument, not main document
      const iframe = container.querySelector('iframe');
      const isFromIframe = iframe?.contentDocument?.contains(target);
      const isInsideCanvas = container.contains(target) || isFromIframe;
      const isInPopover = target.closest?.('[data-radix-popper-content-wrapper]');
      const isInAiChat = target.closest?.('.ai-agent-chat');
      const isInCommentThread = target.closest?.('[role="dialog"][aria-label="Comment thread"]');
      const isInLogsPanel = target.closest?.('[data-logs-panel]');

      if (!isInsideCanvas || isInPopover || isInAiChat || isInCommentThread || isInLogsPanel) {
        return; // Let the event propagate normally
      }

      // Zoom: Ctrl/Cmd key (pinch to zoom on trackpad or Ctrl+Wheel)
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        // Calculate zoom delta
        const delta = -e.deltaY * 0.01;
        const newZoom = clampZoom(viewport.zoom * (1 + delta));

        // Zoom towards mouse position
        const rect = container.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Calculate new pan to keep mouse position fixed
        const scale = newZoom / viewport.zoom;
        const newPanX = mouseX - (mouseX - viewport.panX) * scale;
        const newPanY = mouseY - (mouseY - viewport.panY) * scale;

        onViewportChange({
          zoom: newZoom,
          panX: newPanX,
          panY: newPanY,
        });
      }
      // Horizontal pan: Shift+Wheel
      else if (e.shiftKey) {
        e.preventDefault();
        onViewportChange({
          zoom: viewport.zoom,
          panX: viewport.panX - e.deltaY, // Use deltaY for horizontal scroll
          panY: viewport.panY,
        });
      }
      // Vertical pan: plain Wheel
      else {
        e.preventDefault();
        onViewportChange({
          zoom: viewport.zoom,
          panX: viewport.panX - e.deltaX, // Some mice/trackpads support horizontal delta
          panY: viewport.panY - e.deltaY,
        });
      }
    },
    [viewport, onViewportChange, containerRef, enabled],
  );

  /**
   * Handle pan start
   */
  const handlePanStart = useCallback(
    (e: MouseEvent) => {
      // Start pan with Space key or middle mouse button
      const isSpacePan = spaceKeyDownRef.current && e.button === 0;
      const isMiddleButton = e.button === 1;

      if (isSpacePan || isMiddleButton) {
        e.preventDefault();
        e.stopPropagation();

        panStateRef.current = {
          isPanning: true,
          startX: e.clientX,
          startY: e.clientY,
          initialPanX: viewport.panX,
          initialPanY: viewport.panY,
        };

        // Change cursor
        if (containerRef.current) {
          containerRef.current.style.cursor = 'grabbing';
        }
      }
    },
    [viewport, containerRef],
  );

  /**
   * Handle pan move
   */
  const handlePanMove = useCallback(
    (e: MouseEvent) => {
      const panState = panStateRef.current;
      if (!panState.isPanning) return;

      e.preventDefault();

      const deltaX = e.clientX - panState.startX;
      const deltaY = e.clientY - panState.startY;

      onViewportChange({
        zoom: viewport.zoom,
        panX: panState.initialPanX + deltaX,
        panY: panState.initialPanY + deltaY,
      });
    },
    [viewport.zoom, onViewportChange],
  );

  /**
   * Handle pan end
   */
  const handlePanEnd = useCallback(() => {
    if (!panStateRef.current.isPanning) return;

    panStateRef.current.isPanning = false;

    // Restore cursor
    if (containerRef.current) {
      containerRef.current.style.cursor = spaceKeyDownRef.current ? 'grab' : '';
    }
  }, [containerRef]);

  /**
   * Handle keyboard events for pan mode
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept space when user is typing in an input/textarea
      // Use tagName check instead of instanceof for cross-frame compatibility
      const target = e.target as HTMLElement;
      const tagName = target?.tagName?.toUpperCase();
      const isTyping =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        target?.closest?.('.monaco-editor');
      if (isTyping) return;

      if (e.code === 'Space' && !spaceKeyDownRef.current) {
        e.preventDefault();
        spaceKeyDownRef.current = true;

        // Change cursor to indicate pan mode
        if (containerRef.current) {
          containerRef.current.style.cursor = 'grab';
        }
      }
    },
    [containerRef],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceKeyDownRef.current = false;

        // Restore cursor if not panning
        if (!panStateRef.current.isPanning && containerRef.current) {
          containerRef.current.style.cursor = '';
        }
      }
    },
    [containerRef],
  );

  /**
   * Public API for programmatic viewport control
   */
  const setZoom = useCallback(
    (zoom: number) => {
      onViewportChange({
        ...viewport,
        zoom: clampZoom(zoom),
      });
    },
    [viewport, onViewportChange],
  );

  const resetZoom = useCallback(() => {
    onViewportChange({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  }, [onViewportChange]);

  const zoomIn = useCallback(() => {
    setZoom(viewport.zoom * 1.2);
  }, [viewport.zoom, setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(viewport.zoom / 1.2);
  }, [viewport.zoom, setZoom]);

  // ALWAYS block browser zoom (Ctrl/Cmd+Wheel and keyboard shortcuts) regardless of board mode
  useEffect(() => {
    const blockBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const blockBrowserZoomKeys = (e: KeyboardEvent) => {
      // Block Ctrl/Cmd + Plus/Minus (browser zoom shortcuts)
      // Don't block Cmd+0 - it's used for our reset zoom hotkey
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
      }
    };

    // Block on main window
    window.addEventListener('wheel', blockBrowserZoom, { passive: false });
    window.addEventListener('keydown', blockBrowserZoomKeys);

    // Block on iframe
    const iframe = getPreviewIframe();
    iframe?.contentDocument?.addEventListener('wheel', blockBrowserZoom, { passive: false });
    iframe?.contentDocument?.addEventListener('keydown', blockBrowserZoomKeys);

    return () => {
      window.removeEventListener('wheel', blockBrowserZoom);
      window.removeEventListener('keydown', blockBrowserZoomKeys);
      iframe?.contentDocument?.removeEventListener('wheel', blockBrowserZoom);
      iframe?.contentDocument?.removeEventListener('keydown', blockBrowserZoomKeys);
    };
  }, []); // Empty deps - always active

  // Attach event listeners (only when enabled)
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Wheel for zoom - on main window
    window.addEventListener('wheel', handleWheel, { passive: false });

    // Also listen on iframe document to catch events when iframe is focused
    const iframe = getPreviewIframe();
    iframe?.contentDocument?.addEventListener('wheel', handleWheel, { passive: false });

    // Mouse events for pan
    window.addEventListener('mousedown', handlePanStart);
    window.addEventListener('mousemove', handlePanMove);
    window.addEventListener('mouseup', handlePanEnd);

    // Keyboard events for space pan
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      iframe?.contentDocument?.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousedown', handlePanStart);
      window.removeEventListener('mousemove', handlePanMove);
      window.removeEventListener('mouseup', handlePanEnd);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, handleWheel, handlePanStart, handlePanMove, handlePanEnd, handleKeyDown, handleKeyUp, containerRef]);

  return {
    setZoom,
    resetZoom,
    zoomIn,
    zoomOut,
  };
}
