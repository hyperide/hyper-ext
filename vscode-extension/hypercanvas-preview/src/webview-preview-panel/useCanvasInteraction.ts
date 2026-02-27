/**
 * Canvas Interaction hook — replaces the IIFE canvas-interaction.ts.
 *
 * Runs in the VS Code webview (NOT inside the iframe).
 * Listens for hypercanvas:* messages from the iframe,
 * manages overlay rendering, and handles context menu events.
 */

import { clearOverlays, renderOverlayRects } from '@shared/canvas-interaction/overlay-renderer';
import type { OverlayRect } from '@shared/canvas-interaction/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasAdapter } from '@/lib/platform/types';

export interface ContextMenuState {
  elementId: string;
  itemIndex: number | null;
  x: number;
  y: number;
}

interface UseCanvasInteractionResult {
  contextMenu: ContextMenuState | null;
  clearContextMenu: () => void;
  /** Forward state patches to the iframe interaction script */
  updateState: (patch: Record<string, unknown>) => void;
}

export function useCanvasInteraction(
  iframeEl: HTMLIFrameElement | null,
  overlayEl: HTMLDivElement | null,
  canvas: CanvasAdapter,
): UseCanvasInteractionResult {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const overlayElements = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!iframeEl || !overlayEl) return;
    const frame = iframeEl;
    const container = overlayEl;

    function handleMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;

      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'hypercanvas:elementClick': {
          const patch: Record<string, unknown> = {
            selectedIds: [msg.elementId],
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            patch.selectedItemIndices = { [msg.elementId]: msg.itemIndex };
          }
          canvas.sendEvent({ type: 'state:update', patch } as never);
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:elementHover':
          canvas.sendEvent({
            type: 'state:update',
            patch: {
              hoveredId: msg.elementId,
              hoveredItemIndex: msg.itemIndex,
            },
          } as never);
          break;

        case 'hypercanvas:emptyClick':
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedIds: [] },
          } as never);
          setContextMenu(null);
          break;

        case 'hypercanvas:overlayRects': {
          const rects = msg.rects as OverlayRect[];
          renderOverlayRects(container, rects, overlayElements.current);
          break;
        }

        case 'hypercanvas:selectMultiple': {
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedIds: msg.elementIds, selectedItemIndices: {} },
          } as never);
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:deleteElements': {
          canvas.sendEvent({
            type: 'keyboard:delete',
            elementIds: msg.elementIds,
          } as never);
          break;
        }

        case 'hypercanvas:keydown': {
          // Re-dispatch on the webview window so VS Code's built-in
          // keyboard forwarding picks it up and routes to the editor.
          const kbEvent = new KeyboardEvent('keydown', {
            key: msg.key,
            code: msg.code,
            keyCode: msg.keyCode,
            ctrlKey: msg.ctrlKey,
            shiftKey: msg.shiftKey,
            altKey: msg.altKey,
            metaKey: msg.metaKey,
            repeat: msg.repeat,
            bubbles: true,
            cancelable: true,
          });
          window.dispatchEvent(kbEvent);
          break;
        }

        case 'hypercanvas:contextMenu': {
          // Only show context menu when an element is targeted
          if (!msg.elementId) break;

          // Select the element first
          const selectPatch: Record<string, unknown> = {
            selectedIds: [msg.elementId],
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            selectPatch.selectedItemIndices = {
              [msg.elementId]: msg.itemIndex,
            };
          }
          canvas.sendEvent({ type: 'state:update', patch: selectPatch } as never);

          setContextMenu({
            elementId: msg.elementId,
            itemIndex: msg.itemIndex ?? null,
            x: msg.x,
            y: msg.y,
          });
          break;
        }
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe

    return () => {
      window.removeEventListener('message', handleMessage);
      clearOverlays(overlayElements.current);
    };
  }, [canvas, iframeEl, overlayEl]);

  // Keep iframeEl in a ref so updateState callback stays stable
  const iframeElRef = useRef(iframeEl);
  iframeElRef.current = iframeEl;

  const updateState = useCallback((patch: Record<string, unknown>) => {
    const frame = iframeElRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: 'hypercanvas:stateUpdate', ...patch }, '*'); // nosemgrep: wildcard-postmessage-configuration
    }
  }, []);

  const clearContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, clearContextMenu, updateState };
}
