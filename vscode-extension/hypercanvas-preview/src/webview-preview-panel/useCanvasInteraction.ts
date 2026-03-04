/**
 * Canvas Interaction hook — replaces the IIFE canvas-interaction.ts.
 *
 * Runs in the VS Code webview (NOT inside the iframe).
 * Listens for hypercanvas:* messages from the iframe,
 * manages overlay rendering, and handles context menu events.
 */

import type { SharedEditorState } from '@lib/types';
import {
  clearOverlays,
  renderOverlayRects,
  renderPlaceholderOverlays,
} from '@shared/canvas-interaction/overlay-renderer';
import type { OverlayRect, PlaceholderRect } from '@shared/canvas-interaction/types';
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

/** Derive the origin from an iframe's src attribute, or null if unknown. */
function getIframeOrigin(frame: HTMLIFrameElement): string | null {
  try {
    const src = frame.src;
    if (src) {
      const baseHref = frame.ownerDocument?.location?.href;
      const url = baseHref ? new URL(src, baseHref) : new URL(src);
      return url.origin;
    }
  } catch {
    // Malformed URL — fall through
  }
  return null;
}

export function useCanvasInteraction(
  iframeEl: HTMLIFrameElement | null,
  overlayEl: HTMLDivElement | null,
  canvas: CanvasAdapter,
): UseCanvasInteractionResult {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const overlayElements = useRef(new Map<string, HTMLDivElement>());
  const iframeOriginRef = useRef<string | null>(null);
  const placeholderElements = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!iframeEl || !overlayEl) return;
    const frame = iframeEl;
    const container = overlayEl;

    iframeOriginRef.current = getIframeOrigin(frame);

    // Re-derive origin after iframe navigates (e.g. devserver URL update)
    function handleIframeLoad() {
      iframeOriginRef.current = getIframeOrigin(frame);
    }
    frame.addEventListener('load', handleIframeLoad);

    function handleMessage(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      let expectedOrigin = iframeOriginRef.current;
      // If origin is not yet known (e.g. iframe src was relative or not set),
      // try to derive it lazily from the current iframe src.
      if (!expectedOrigin) {
        expectedOrigin = getIframeOrigin(frame);
        if (expectedOrigin) iframeOriginRef.current = expectedOrigin;
      }
      // Reject messages from unexpected origins; if origin still unknown, skip validation
      // (the source check above already ensures messages come from the iframe)
      if (expectedOrigin && event.origin !== expectedOrigin) return;

      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'hypercanvas:elementClick': {
          const patch: Partial<SharedEditorState> = {
            selectedIds: [msg.elementId],
            insertTargetId: null,
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            patch.selectedItemIndices = { [msg.elementId]: msg.itemIndex };
          }
          canvas.sendEvent({ type: 'state:update', patch });
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
          });
          break;

        case 'hypercanvas:emptyClick': {
          const emptyPatch: Partial<SharedEditorState> = {
            selectedIds: [],
            insertTargetId: null,
          };
          canvas.sendEvent({ type: 'state:update', patch: emptyPatch });
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:openPanel':
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedIds: [msg.elementId], insertTargetId: msg.elementId },
          } as never);
          break;

        case 'hypercanvas:overlayRects': {
          if (!Array.isArray(msg.rects)) break;
          renderOverlayRects(container, msg.rects as OverlayRect[], overlayElements.current);

          const pRects = (msg.placeholderRects ?? []) as PlaceholderRect[];
          renderPlaceholderOverlays(container, pRects, placeholderElements.current);
          break;
        }

        case 'hypercanvas:selectMultiple': {
          if (!Array.isArray(msg.elementIds)) break;
          const selectedIds = msg.elementIds.filter((id: unknown) => typeof id === 'string');
          if (selectedIds.length === 0) break;
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedIds, selectedItemIndices: {} },
          });
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:deleteElements': {
          if (!Array.isArray(msg.elementIds)) break;
          const idsToDelete = msg.elementIds.filter((id: unknown) => typeof id === 'string');
          if (idsToDelete.length === 0) break;
          canvas.sendEvent({
            type: 'keyboard:delete',
            elementIds: idsToDelete,
          });
          break;
        }

        case 'hypercanvas:keydown': {
          const isMod = msg.metaKey || msg.ctrlKey;
          const isZ = msg.code === 'KeyZ' || msg.key?.toLowerCase() === 'z';

          if (isMod && isZ) {
            canvas.sendEvent({ type: msg.shiftKey ? 'canvas:redo' : 'canvas:undo' });
            break;
          }

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
          const selectPatch: Partial<SharedEditorState> = {
            selectedIds: [msg.elementId],
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            selectPatch.selectedItemIndices = {
              [msg.elementId]: msg.itemIndex,
            };
          }
          canvas.sendEvent({ type: 'state:update', patch: selectPatch });

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

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
      frame.removeEventListener('load', handleIframeLoad);
      clearOverlays(overlayElements.current);
      clearOverlays(placeholderElements.current);
    };
  }, [canvas, iframeEl, overlayEl]);

  // Keep iframeEl in a ref so updateState callback stays stable
  const iframeElRef = useRef(iframeEl);
  iframeElRef.current = iframeEl;

  // patch comes from internal React state (usePreviewBridge), not from external
  // input — no allowlist/sanitization needed. targetOrigin is derived from the
  // iframe's own src and acts as the postMessage security boundary.
  const updateState = useCallback((patch: Record<string, unknown>) => {
    const frame = iframeElRef.current;
    const targetOrigin = iframeOriginRef.current;
    // Truthy check intentionally guards both null and undefined for targetOrigin
    if (frame?.contentWindow && targetOrigin) {
      frame.contentWindow.postMessage({ type: 'hypercanvas:stateUpdate', ...patch }, targetOrigin);
    } else {
      console.warn('[hypercanvas] Failed to post state update to iframe: missing contentWindow or origin', {
        hasFrame: Boolean(frame),
        hasContentWindow: Boolean(frame?.contentWindow),
        targetOrigin,
      });
    }
  }, []);

  const clearContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, clearContextMenu, updateState };
}
