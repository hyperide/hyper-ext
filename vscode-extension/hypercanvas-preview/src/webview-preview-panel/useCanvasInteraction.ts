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

interface SourceLocationLike {
  fileName: string;
  line: number;
  column: number;
}

export function sourceToElementId(source: unknown): string | null {
  if (
    typeof source === 'object' &&
    source !== null &&
    typeof (source as SourceLocationLike).fileName === 'string' &&
    typeof (source as SourceLocationLike).line === 'number' &&
    typeof (source as SourceLocationLike).column === 'number'
  ) {
    const loc = source as SourceLocationLike;
    return `${loc.fileName}:${loc.line}:${loc.column}`;
  }
  return null;
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

function isSaveShortcut(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  code?: string;
  key?: string;
}): boolean {
  const isMod = event.metaKey || event.ctrlKey;
  const isS = event.code === 'KeyS' || event.key?.toLowerCase() === 's';
  return Boolean(isMod && isS && !event.shiftKey && !event.altKey);
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

    /** Select element and open insert panel — shared by overlay click and openPanel message. */
    function openInsertPanel(elementId: string) {
      canvas.sendEvent({
        type: 'state:update',
        patch: { selectedIds: [elementId], insertTargetId: elementId },
      } as never);
    }

    function saveOpenEditors() {
      canvas.sendEvent({
        type: 'command:execute',
        command: 'workbench.action.files.saveAll',
      });
    }

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
      if (expectedOrigin && event.origin !== expectedOrigin) {
        return;
      }

      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'hypercanvas:elementClick': {
          const elementId = typeof msg.elementId === 'string' ? msg.elementId : sourceToElementId(msg.source);
          if (!elementId) break;
          const patch: Partial<SharedEditorState> & { source?: unknown } = {
            selectedIds: [elementId],
            insertTargetId: null,
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            patch.selectedItemIndices = { [elementId]: msg.itemIndex };
          }
          if (msg.source) {
            patch.source = msg.source;
          }
          canvas.sendEvent({ type: 'state:update', patch });
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:elementHover': {
          const elementId = typeof msg.elementId === 'string' ? msg.elementId : sourceToElementId(msg.source);
          canvas.sendEvent({
            type: 'state:update',
            patch: {
              hoveredId: elementId,
              hoveredItemIndex: msg.itemIndex,
            },
          });
          break;
        }

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
          openInsertPanel(msg.elementId);
          break;

        case 'hypercanvas:overlayRects': {
          if (!Array.isArray(msg.rects)) break;
          renderOverlayRects(container, msg.rects as OverlayRect[], overlayElements.current);

          const pRects = (msg.placeholderRects ?? []) as PlaceholderRect[];
          renderPlaceholderOverlays(container, pRects, placeholderElements.current, openInsertPanel);
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
            const eventType = msg.shiftKey ? 'canvas:redo' : 'canvas:undo';
            canvas.sendEvent({ type: eventType });
            break;
          }

          if (isSaveShortcut(msg)) {
            saveOpenEditors();
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
  // input — no allowlist/sanitization needed.
  // Note: In VS Code webviews the iframe origin is opaque (vscode-webview://<session-id>)
  // and changes every session, so targetOrigin cannot be used. Use '*' like all other
  // postMessages in usePreviewBridge.ts.
  const updateState = useCallback((patch: Record<string, unknown>) => {
    const frame = iframeElRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: 'hypercanvas:stateUpdate', ...patch }, '*'); // nosemgrep: wildcard-postmessage-configuration
    }
  }, []);

  const clearContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, clearContextMenu, updateState };
}
