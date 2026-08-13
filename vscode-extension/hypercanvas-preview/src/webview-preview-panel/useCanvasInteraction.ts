/**
 * Canvas Interaction hook — replaces the IIFE canvas-interaction.ts.
 *
 * Runs in the VS Code webview (NOT inside the iframe).
 * Listens for hypercanvas:* messages from the iframe,
 * manages overlay rendering, and handles context menu events.
 */

import type { SelectedElementRuntimeStyle, SharedEditorState } from '@lib/types';
import {
  clearOverlays,
  renderOverlayRects,
  renderPlaceholderOverlays,
} from '@shared/canvas-interaction/overlay-renderer';
import { computeResizeStyles } from '@shared/canvas-interaction/resize-utils';
import type { OverlayRect, PlaceholderRect } from '@shared/canvas-interaction/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canvasRPC } from '@/lib/platform/PlatformContext';
import type { CanvasAdapter } from '@/lib/platform/types';
import { postToPreviewIframe } from './postToPreviewIframe';

// ============================================================================
// Scroll compensation helpers (exported for unit testing)
// ============================================================================

/**
 * Compute the CSS translateY value to apply to the overlay container so that
 * overlay rects (computed at `baselineScrollY`) visually track content after the
 * iframe has scrolled to `currentScrollY`.
 *
 * Returns 0 when no compensation is needed (no scroll since last rect computation).
 * The caller is responsible for resetting to 0 when fresh rects arrive.
 *
 * @param currentScrollY - The iframe's current window.scrollY (from overlayScroll msg)
 * @param baselineScrollY - The scrollY captured when the last overlayRects were computed
 * @returns Negative offset in px (translateY), 0 when aligned
 */
export function computeScrollCompensationPx(currentScrollY: number, baselineScrollY: number): number {
  // Use `|| 0` to normalise -0 to 0 (JS: -0 === 0 is true but Object.is(-0, 0) is false)
  return -(currentScrollY - baselineScrollY) || 0;
}

interface ContextMenuState {
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

/**
 * Creates a transparent full-viewport ghost div that intercepts all pointer events
 * during a resize drag. Without this, CDP-dispatched pointerup events fall through
 * pointer-events:none overlay elements into the nested preview iframe and never
 * reach the webview document's listeners.
 */
export function createDragGhost(axis: 'width' | 'height'): HTMLDivElement {
  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed',
    'top:0',
    'right:0',
    'bottom:0',
    'left:0',
    `z-index:${Number.MAX_SAFE_INTEGER}`,
    'pointer-events:all',
    `cursor:${axis === 'width' ? 'ew-resize' : 'ns-resize'}`,
    'touch-action:none',
    'user-select:none',
    'background:transparent',
  ].join(';');
  return ghost;
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

  // Scroll compensation: baselineScrollY is the iframe window.scrollY captured when the
  // last overlayRects message was computed. On overlayScroll we apply a CSS transform so
  // overlay positions track the content immediately, without waiting for the next RAF cycle.
  const scrollBaselineRef = useRef(0);

  useEffect(() => {
    if (!iframeEl || !overlayEl) return;
    const frame = iframeEl;
    const container = overlayEl;

    iframeOriginRef.current = getIframeOrigin(frame);

    // Re-derive origin after iframe navigates (e.g. devserver URL update)
    function handleIframeLoad() {
      iframeOriginRef.current = getIframeOrigin(frame);
      // Reset scroll compensation state — the new page starts at scrollY=0
      scrollBaselineRef.current = 0;
      container.style.transform = '';
      // Clear stale runtime style on component change / iframe reload
      canvas.sendEvent({
        type: 'state:update',
        patch: { selectedElementRuntimeStyle: null },
      });
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
          const patch: Partial<SharedEditorState> & { source?: unknown } = {};
          if (msg.additive) {
            // iframe already computed the toggled selection — use it directly.
            patch.selectedIds = Array.isArray(msg.selectedIds) ? msg.selectedIds : [];
            if (msg.selectedItemIndices && typeof msg.selectedItemIndices === 'object') {
              patch.selectedItemIndices = msg.selectedItemIndices;
            }
          } else {
            if (!elementId) break;
            patch.selectedIds = [elementId];
            patch.insertTargetId = null;
            patch.selectedElementDomText = typeof msg.domTextContent === 'string' ? msg.domTextContent : null;
            if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
              patch.selectedItemIndices = { [elementId]: msg.itemIndex };
            }
          }
          if (msg.source) {
            patch.source = msg.source;
          }
          if (msg.computedStyle && typeof msg.computedStyle === 'object') {
            const refMatch = typeof elementId === 'string' ? elementId.match(/^(.+):\d+:\d+$/) : null;
            patch.selectedElementRuntimeStyle = {
              componentPath: refMatch ? refMatch[1] : null,
              elementId,
              itemIndex: msg.itemIndex ?? null,
              seq: typeof msg.computedStyleSeq === 'number' ? msg.computedStyleSeq : Date.now(),
              computedStyle: msg.computedStyle as Record<string, string>,
            } satisfies SelectedElementRuntimeStyle;
          } else {
            // No inline computed style (e.g. keyboard nav) — request it from the iframe
            postToPreviewIframe(frame, {
              type: 'hypercanvas:requestComputedStyle',
              elementId,
              itemIndex: msg.itemIndex ?? null,
            });
          }
          canvas.sendEvent({ type: 'state:update', patch });
          setContextMenu(null);
          break;
        }

        case 'hypercanvas:computedStyleResult': {
          const elementId = typeof msg.elementId === 'string' ? msg.elementId : null;
          if (!elementId || !msg.computedStyle || typeof msg.computedStyle !== 'object') break;
          const refMatch = elementId.match(/^(.+):\d+:\d+$/);
          const runtimeStyle: SelectedElementRuntimeStyle = {
            componentPath: refMatch ? refMatch[1] : null,
            elementId,
            itemIndex: typeof msg.itemIndex === 'number' ? msg.itemIndex : null,
            seq: typeof msg.computedStyleSeq === 'number' ? msg.computedStyleSeq : Date.now(),
            computedStyle: msg.computedStyle as Record<string, string>,
          };
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedElementRuntimeStyle: runtimeStyle },
          });
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
            selectedElementRuntimeStyle: null,
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

          // Update baseline scrollY — rects were computed at this scroll position.
          // Reset any pending transform compensation: the fresh rects already account
          // for current scroll, so the container should have no translate applied.
          if (typeof msg.scrollY === 'number') {
            scrollBaselineRef.current = msg.scrollY;
          }
          container.style.transform = '';

          renderOverlayRects(container, msg.rects as OverlayRect[], overlayElements.current);

          const pRects = (msg.placeholderRects ?? []) as PlaceholderRect[];
          renderPlaceholderOverlays(container, pRects, placeholderElements.current, openInsertPanel);
          break;
        }

        case 'hypercanvas:overlayScroll': {
          // Immediate scroll compensation: shift overlay container by the delta between
          // current iframe scrollY and the baseline captured at last rect computation.
          // This fills the ~1-frame gap before the RAF-computed rect update arrives.
          if (typeof msg.scrollY !== 'number') break;
          const compensationPx = computeScrollCompensationPx(msg.scrollY, scrollBaselineRef.current);
          container.style.transform = compensationPx !== 0 ? `translateY(${compensationPx}px)` : '';
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

        case 'hypercanvas:moveElement': {
          // Drop pipeline (move-any-to-any). Source and target arrive as raw
          // NodeRefs from the iframe — no lift, no fallback.
          // AstService.moveElement handles same-file, cross-file, cross-parent,
          // cross-component, and leaf-target moves uniformly.
          if (typeof msg.sourceId !== 'string' || typeof msg.targetId !== 'string') break;
          const filePath = typeof msg.filePath === 'string' ? msg.filePath : '';
          if (!filePath) break;
          canvas.sendEvent({
            type: 'ast:moveElement',
            requestId: `move-${Date.now()}`,
            filePath,
            sourceId: msg.sourceId,
            targetId: msg.targetId,
            position: msg.position === 'before' ? 'before' : 'after',
          });
          // Seed grace cache before HMR fires so selection survives the iframe reload.
          canvas.sendEvent({
            type: 'state:update',
            patch: { selectedIds: [msg.sourceId] },
          });
          break;
        }

        case 'hypercanvas:writeOrders': {
          // Order-driven parent fast path (Tailwind `order-N`). The iframe has
          // already done the detection + dense renumber; here we just relay each
          // entry as `ast:updateProps` so the existing undo/file-snapshot
          // pipeline records a normal className edit per affected sibling.
          //
          // Note: this matches `StyleAdapter.writeOrder` semantically — that
          // method ultimately calls `astOps.updateProps({ className })` too.
          // We bypass instantiating `TailwindAdapter` here because the webview
          // doesn't carry an `AstOperations` adapter at this layer; reusing the
          // pre-computed entries from `applyOrderClassChange` (already done in
          // the iframe) is functionally equivalent and avoids a round-trip.
          //
          // Serialization: sequential `await canvasRPC` per entry, NOT a parallel
          // burst. AstService.updateProps reads + parses + mutates + writes the
          // whole file; two concurrent calls into the SAME file would race —
          // call 2 reads pre-write disk content, mutates, writes its own AST —
          // overwriting call 1's edit. Sequencing each through the canvasRPC
          // request/response handshake lets the file-cache invalidate (line 678
          // in AstService.updateProps) before the next call reads.
          const entries = Array.isArray(msg.entries) ? msg.entries : [];
          if (entries.length === 0) break;
          // Fire-and-forget IIFE — message handlers can't be async themselves.
          // canvasRPC failure on any entry is logged but doesn't abort the
          // remaining writes; partial dense renumber is the user-visible result.
          // Could fall back to ast:moveElement on first failure, but that path
          // would re-introduce the JSX-rewrite problem the order-driven branch
          // exists to avoid. Surfacing the failure in console is the lesser
          // evil until we have a UI affordance for it.
          (async () => {
            for (const entry of entries) {
              if (
                !entry ||
                typeof entry.elementId !== 'string' ||
                typeof entry.filePath !== 'string' ||
                typeof entry.newClassName !== 'string'
              ) {
                continue;
              }
              try {
                const result = await canvasRPC(
                  canvas,
                  {
                    type: 'ast:updateProps',
                    requestId: `writeOrder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    filePath: entry.filePath,
                    elementId: entry.elementId,
                    props: { className: entry.newClassName },
                  },
                  'ast:response',
                );
                if (!result.success) {
                  console.warn('[useCanvasInteraction] writeOrder updateProps failed:', result.error, entry);
                }
              } catch (err) {
                console.warn('[useCanvasInteraction] writeOrder updateProps threw:', err, entry);
              }
            }
            // Seed grace cache so selection survives the HMR reload triggered by the writes above.
            if (typeof msg.sourceId === 'string') {
              canvas.sendEvent({
                type: 'state:update',
                patch: { selectedIds: [msg.sourceId] },
              });
            }
          })();
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

          // Select the element and capture runtime style (mirrors elementClick path)
          const selectPatch: Partial<SharedEditorState> = {
            selectedIds: [msg.elementId],
          };
          if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
            selectPatch.selectedItemIndices = {
              [msg.elementId]: msg.itemIndex,
            };
          }
          if (msg.computedStyle && typeof msg.computedStyle === 'object') {
            const refMatch = typeof msg.elementId === 'string' ? msg.elementId.match(/^(.+):\d+:\d+$/) : null;
            selectPatch.selectedElementRuntimeStyle = {
              componentPath: refMatch ? refMatch[1] : null,
              elementId: msg.elementId,
              itemIndex: msg.itemIndex ?? null,
              seq: typeof msg.computedStyleSeq === 'number' ? msg.computedStyleSeq : Date.now(),
              computedStyle: msg.computedStyle as Record<string, string>,
            } satisfies SelectedElementRuntimeStyle;
          } else {
            postToPreviewIframe(frame, {
              type: 'hypercanvas:requestComputedStyle',
              elementId: msg.elementId,
              itemIndex: msg.itemIndex ?? null,
            });
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

    // Resize drag — intercept pointerdown on handle dots inside the overlay container.
    // Handle dots have pointer-events:auto; events bubble through the container's
    // pointer-events:none to this listener.

    // Track doc-level fallback listener and ghost so effect cleanup can remove them if effect tears down mid-drag.
    let activeDocPointerUp: ((e: PointerEvent) => void) | null = null;
    let activeGhost: HTMLDivElement | null = null;

    function handleResizePointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const handle = (event.target as HTMLElement).closest?.('[data-resize-handle]') as HTMLElement | null;
      if (!handle) return;

      const overlayDiv = handle.closest('[data-selection-overlay]') as HTMLDivElement | null;
      if (!overlayDiv) return;

      const elementId = overlayDiv.dataset.elementId;
      if (!elementId) return;

      // TypeScript does not narrow const variables in closures — explicit typed aliases needed.
      const capturedHandle: HTMLElement = handle;
      const capturedElementId: string = elementId;
      const capturedOverlayDiv: HTMLDivElement = overlayDiv;

      const axis = capturedHandle.getAttribute('data-resize-handle') as 'width' | 'height';
      const baseW = parseFloat(overlayDiv.style.width) || 0;
      const baseH = parseFloat(overlayDiv.style.height) || 0;
      const startX = event.clientX;
      const startY = event.clientY;

      try {
        capturedHandle.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture may fail in test environments with synthetic events
      }
      event.stopPropagation();

      // Ghost div intercepts all pointer events during drag. CDP-dispatched pointerup
      // from window.mouse.up() would otherwise fall through pointer-events:none overlay
      // elements into the nested preview iframe, never reaching webview listeners.
      const ghost = createDragGhost(axis);
      document.body.appendChild(ghost);
      activeGhost = ghost;

      const dragPointerId = event.pointerId;
      let dragFinished = false;

      function finishDrag(endX: number, endY: number) {
        if (dragFinished) return;
        dragFinished = true;

        ghost.removeEventListener('pointermove', onPointerMove);
        ghost.removeEventListener('pointerup', onPointerUp);
        ghost.removeEventListener('pointercancel', onPointerCancel);
        ghost.remove();
        activeGhost = null;

        capturedHandle.removeEventListener('pointermove', onPointerMove);
        capturedHandle.removeEventListener('pointerup', onPointerUp);
        capturedHandle.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('pointerup', onDocPointerUp);
        activeDocPointerUp = null;

        const dX = endX - startX;
        const dY = endY - startY;
        const styles = computeResizeStyles(axis, baseW, baseH, dX, dY);
        console.log('[resize] finishDrag', { axis, dX, dY, styles, elementId: capturedElementId });
        if (!styles) return;

        // size-* sets both axes — stripping it for one axis loses the other.
        // Preserve the perpendicular dimension explicitly when hasSizeClass is set.
        if (capturedOverlayDiv.dataset.hasSizeClass === 'true') {
          if (axis === 'width') styles.height = `${Math.round(baseH)}px`;
          else styles.width = `${Math.round(baseW)}px`;
        }

        const filePathMatch = capturedElementId.match(/^(.+):\d+:\d+$/);
        if (!filePathMatch) return;

        canvas.sendEvent({
          type: 'ast:updateStyles',
          requestId: `resize-${Date.now()}`,
          filePath: filePathMatch[1],
          elementId: capturedElementId,
          styles,
        });
      }

      function onPointerUp(e: PointerEvent) {
        finishDrag(e.clientX, e.clientY);
      }

      // Fallback: catch pointerup on document in case pointer capture fails or
      // the pointer lands outside the handle element (common in test environments).
      function onDocPointerUp(e: PointerEvent) {
        if (e.pointerId !== dragPointerId) return;
        finishDrag(e.clientX, e.clientY);
      }

      // Cancel drag on OS gesture interruption without writing to source.
      function onPointerCancel() {
        if (dragFinished) return;
        dragFinished = true;
        ghost.removeEventListener('pointermove', onPointerMove);
        ghost.removeEventListener('pointerup', onPointerUp);
        ghost.removeEventListener('pointercancel', onPointerCancel);
        ghost.remove();
        activeGhost = null;
        capturedHandle.removeEventListener('pointermove', onPointerMove);
        capturedHandle.removeEventListener('pointerup', onPointerUp);
        capturedHandle.removeEventListener('pointercancel', onPointerCancel);
        document.removeEventListener('pointerup', onDocPointerUp);
        activeDocPointerUp = null;
        // Restore original size in iframe
        postToPreviewIframe(frame, { type: 'hypercanvas:clearPreviewResize', elementId: capturedElementId });
      }

      function onPointerMove(e: PointerEvent) {
        const dX = e.clientX - startX;
        const dY = e.clientY - startY;
        postToPreviewIframe(frame, {
          type: 'hypercanvas:previewResize',
          elementId: capturedElementId,
          width: axis === 'width' ? Math.max(1, Math.round(baseW + dX)) : undefined,
          height: axis === 'height' ? Math.max(1, Math.round(baseH + dY)) : undefined,
        });
      }

      activeDocPointerUp = onDocPointerUp;
      ghost.addEventListener('pointermove', onPointerMove);
      ghost.addEventListener('pointerup', onPointerUp);
      ghost.addEventListener('pointercancel', onPointerCancel);
      capturedHandle.addEventListener('pointermove', onPointerMove);
      capturedHandle.addEventListener('pointerup', onPointerUp);
      capturedHandle.addEventListener('pointercancel', onPointerCancel);
      document.addEventListener('pointerup', onDocPointerUp);
    }

    container.addEventListener('pointerdown', handleResizePointerDown);

    // Forward right-click on resize handles to the design context menu.
    // Handles have pointer-events:auto so the contextmenu event fires here
    // instead of reaching the iframe; we must re-surface it ourselves.
    function handleResizeContextMenu(event: MouseEvent) {
      const handle = (event.target as HTMLElement).closest?.('[data-resize-handle]') as HTMLElement | null;
      if (!handle) return;
      const overlayDiv = handle.closest('[data-selection-overlay]') as HTMLDivElement | null;
      if (!overlayDiv) return;
      const elementId = overlayDiv.dataset.elementId;
      if (!elementId) return;
      event.preventDefault();
      setContextMenu({ elementId, itemIndex: null, x: event.clientX, y: event.clientY });
    }

    container.addEventListener('contextmenu', handleResizeContextMenu);

    return () => {
      window.removeEventListener('message', handleMessage);
      frame.removeEventListener('load', handleIframeLoad);
      container.removeEventListener('pointerdown', handleResizePointerDown);
      container.removeEventListener('contextmenu', handleResizeContextMenu);
      if (activeDocPointerUp) document.removeEventListener('pointerup', activeDocPointerUp);
      if (activeGhost) {
        activeGhost.remove();
        activeGhost = null;
      }
      clearOverlays(overlayElements.current);
      clearOverlays(placeholderElements.current);
    };
  }, [canvas, iframeEl, overlayEl]);

  // Keep iframeEl in a ref so updateState callback stays stable
  const iframeElRef = useRef(iframeEl);
  iframeElRef.current = iframeEl;

  // patch comes from internal React state (usePreviewBridge), not from external
  // input — no allowlist/sanitization needed. The preview iframe is loaded from
  // the dev-server URL, so postToPreviewIframe targets that real origin (not '*').
  const updateState = useCallback((patch: Record<string, unknown>) => {
    postToPreviewIframe(iframeElRef.current, { type: 'hypercanvas:stateUpdate', ...patch });
  }, []);

  const clearContextMenu = useCallback(() => setContextMenu(null), []);

  return { contextMenu, clearContextMenu, updateState };
}
