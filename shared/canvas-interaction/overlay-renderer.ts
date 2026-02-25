/**
 * Canvas overlay renderer — draws selection/hover rectangles over iframe elements.
 *
 * Ported from useSelectionOverlays.ts (lines 56-195).
 * Two levels of API:
 *   - renderOverlayRects(): low-level, renders pre-computed rects (VS Code webview)
 *   - createOverlayRenderer(): high-level, RAF loop with DOM queries (SaaS)
 */

import type { OverlayRect, OverlayRendererOptions, OverlayState } from './types';

const HOVER_BORDER = '2px solid rgba(59, 130, 246, 0.5)';
const SELECTION_BORDER = '2px solid rgb(59, 130, 246)';

// ============================================================================
// Low-level: render pre-computed rects as overlay divs
// ============================================================================

/**
 * Create/update/remove overlay divs in a container based on rect specifications.
 * Used by both SaaS (with DOM-queried rects) and VS Code (with postMessage rects).
 */
export function renderOverlayRects(
  container: HTMLElement,
  rects: OverlayRect[],
  overlayElements: Map<string, HTMLDivElement>,
): void {
  const currentKeys = new Set<string>();

  for (const rect of rects) {
    currentKeys.add(rect.key);

    let element = overlayElements.get(rect.key);
    if (!element) {
      element = document.createElement('div');
      element.setAttribute('data-selection-overlay', 'true');
      element.style.position = 'absolute';
      element.style.pointerEvents = 'none';
      element.style.border = rect.type === 'hover' ? HOVER_BORDER : SELECTION_BORDER;
      container.appendChild(element);
      overlayElements.set(rect.key, element);
    }

    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
  }

  // Remove unused overlays
  for (const [key, element] of overlayElements.entries()) {
    if (!currentKeys.has(key)) {
      element.remove();
      overlayElements.delete(key);
    }
  }
}

/**
 * Remove all overlay divs and clear the map.
 */
export function clearOverlays(overlayElements: Map<string, HTMLDivElement>): void {
  for (const element of overlayElements.values()) {
    element.remove();
  }
  overlayElements.clear();
}

// ============================================================================
// High-level: RAF loop with direct iframe DOM access (SaaS)
// ============================================================================

/**
 * Compute overlay rects by querying iframe DOM.
 * Returns OverlayRect[] ready for renderOverlayRects().
 */
function computeOverlayRects(iframe: HTMLIFrameElement, container: HTMLElement, state: OverlayState): OverlayRect[] {
  const doc = iframe.contentDocument;
  if (!doc) return [];

  const containerRect = container.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const offsetX = iframeRect.left - containerRect.left;
  const offsetY = iframeRect.top - containerRect.top;
  const zoom = state.viewportZoom ?? 1;

  const { selectedIds, hoveredId, hoveredItemIndex = null, selectedItemIndices, activeInstanceId = null } = state;

  const rects: OverlayRect[] = [];

  // Hover rect (skip if exact same item is selected)
  if (hoveredId) {
    const isExactItemSelected =
      selectedIds.includes(hoveredId) && selectedItemIndices?.get(hoveredId) === hoveredItemIndex;

    if (!isExactItemSelected) {
      let hoverSelector = `[data-uniq-id="${hoveredId}"]`;
      if (activeInstanceId) {
        hoverSelector = `[data-canvas-instance-id="${activeInstanceId}"] ${hoverSelector}`;
      }

      const allHoverElements = doc.querySelectorAll(hoverSelector);
      let hoverElement: Element | null = null;
      if (hoveredItemIndex !== null && allHoverElements[hoveredItemIndex]) {
        hoverElement = allHoverElements[hoveredItemIndex];
      } else if (allHoverElements.length > 0) {
        hoverElement = allHoverElements[0];
      }

      if (hoverElement) {
        const elemRect = hoverElement.getBoundingClientRect();
        const key = hoveredItemIndex !== null ? `hover-${hoveredId}-${hoveredItemIndex}` : `hover-${hoveredId}`;

        rects.push({
          key,
          left: offsetX + elemRect.left * zoom,
          top: offsetY + elemRect.top * zoom,
          width: elemRect.width * zoom,
          height: elemRect.height * zoom,
          type: 'hover',
        });
      }
    }
  }

  // Selection rects
  for (const selectedId of selectedIds) {
    const itemIndex = selectedItemIndices?.get(selectedId) ?? null;

    let baseSelector = `[data-uniq-id="${selectedId}"]`;
    if (activeInstanceId) {
      baseSelector = `[data-canvas-instance-id="${activeInstanceId}"] ${baseSelector}`;
    }

    const allElements = doc.querySelectorAll(baseSelector);
    const elementsToHighlight: Element[] = [];

    if (itemIndex !== null && itemIndex !== undefined && allElements[itemIndex]) {
      elementsToHighlight.push(allElements[itemIndex]);
    } else {
      elementsToHighlight.push(...Array.from(allElements));
    }

    elementsToHighlight.forEach((selectedElement, idx) => {
      const elemRect = selectedElement.getBoundingClientRect();
      const key =
        itemIndex !== null && itemIndex !== undefined
          ? `select-${selectedId}-${itemIndex}`
          : `select-${selectedId}-${idx}`;

      rects.push({
        key,
        left: offsetX + elemRect.left * zoom,
        top: offsetY + elemRect.top * zoom,
        width: elemRect.width * zoom,
        height: elemRect.height * zoom,
        type: 'selection',
      });
    });
  }

  return rects;
}

/**
 * Create an overlay renderer with RAF loop for direct iframe DOM access.
 * Used in SaaS where the iframe is same-origin.
 *
 * @param iframe - The preview iframe element
 * @param container - The overlay container (position: absolute, covers iframe)
 * @param options - viewportZoom for pan & zoom support
 */
export function createOverlayRenderer(
  iframe: HTMLIFrameElement,
  container: HTMLElement,
  options?: OverlayRendererOptions,
): {
  update: (state: OverlayState) => void;
  dispose: () => void;
} {
  const state: OverlayState = {
    selectedIds: [],
    hoveredId: null,
    viewportZoom: options?.viewportZoom ?? 1,
  };
  const overlayElements = new Map<string, HTMLDivElement>();
  let rafId = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;
    const rects = computeOverlayRects(iframe, container, state);
    renderOverlayRects(container, rects, overlayElements);
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    update(newState: Partial<OverlayState>) {
      Object.assign(state, newState);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearOverlays(overlayElements);
    },
  };
}
