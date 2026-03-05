/**
 * Canvas overlay renderer — draws selection/hover rectangles over iframe elements.
 *
 * Ported from useSelectionOverlays.ts (lines 56-195).
 * Two levels of API:
 *   - renderOverlayRects(): low-level, renders pre-computed rects (VS Code webview)
 *   - createOverlayRenderer(): high-level, RAF loop with DOM queries (SaaS)
 */

import { buildSquareRotatedPlusSvg } from '../icons/square-rotated-plus';
import { getEmptyContainerRects } from './empty-container-placeholders';
import type { OverlayRect, OverlayRendererOptions, OverlayState, PlaceholderRect } from './types';

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
// Placeholder overlays (empty container dashed border + add icon)
// Vanilla DOM — overlays render outside React tree, inside the overlay container.
// pointer-events:auto on each placeholder overrides container's pointer-events:none.
// For React icon component see client/components/icons/IconSquareRotatedPlus.tsx
// ============================================================================

const ICON_SIZE = 20;
const ICON_SVG = buildSquareRotatedPlusSvg(ICON_SIZE);

/**
 * Render placeholder overlays for empty containers.
 * Each overlay = dashed border + centered diamond-plus icon.
 *
 * When `onClick` is provided (SaaS), overlays are interactive: pointer-events:auto,
 * cursor:pointer, hover effects, and click handling.
 * When omitted (VS Code extension), overlays are purely visual: pointer-events:none,
 * so clicks pass through to the iframe where iframe-interaction.ts handles them.
 */
export function renderPlaceholderOverlays(
  container: HTMLElement,
  rects: PlaceholderRect[],
  overlayElements: Map<string, HTMLDivElement>,
  onClick?: (elementId: string) => void,
): void {
  const interactive = !!onClick;
  const currentKeys = new Set<string>();

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const key = `placeholder-${rect.elementId}-${i}`;
    currentKeys.add(key);

    let outer = overlayElements.get(key);
    if (!outer) {
      outer = document.createElement('div');
      outer.setAttribute('data-placeholder-overlay', 'true');
      outer.style.position = 'absolute';
      outer.style.pointerEvents = 'none';

      const inner = document.createElement('div');
      inner.style.position = 'absolute';
      inner.style.top = '50%';
      inner.style.left = '50%';
      inner.style.transform = 'translate(-50%, -50%)';
      inner.style.width = `${ICON_SIZE}px`;
      inner.style.height = `${ICON_SIZE}px`;
      inner.style.color = 'rgba(128,128,128,0.45)';
      inner.style.transition = 'color 0.15s ease, transform 0.15s ease';
      // nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method -- static SVG constant, not user-controlled
      inner.innerHTML = ICON_SVG;

      const tooltip = document.createElement('div');
      tooltip.textContent = 'Insert element';
      tooltip.style.position = 'absolute';
      tooltip.style.bottom = `calc(50% + ${ICON_SIZE / 2 + 6}px)`;
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translateX(-50%)';
      tooltip.style.background = 'hsl(0 0% 9%)';
      tooltip.style.color = 'hsl(0 0% 98%)';
      tooltip.style.fontSize = '12px';
      tooltip.style.lineHeight = '1';
      tooltip.style.padding = '4px 8px';
      tooltip.style.borderRadius = '6px';
      tooltip.style.whiteSpace = 'nowrap';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.opacity = '0';
      tooltip.style.transition = 'opacity 0.15s ease';

      if (interactive) {
        inner.style.pointerEvents = 'auto';
        inner.style.cursor = 'pointer';
        inner.addEventListener('mouseenter', () => {
          inner.style.color = 'rgba(128,128,128,0.7)';
          inner.style.transform = 'translate(-50%, -50%) scale(1.15)';
          tooltip.style.opacity = '1';
        });
        inner.addEventListener('mouseleave', () => {
          inner.style.color = 'rgba(128,128,128,0.45)';
          inner.style.transform = 'translate(-50%, -50%)';
          tooltip.style.opacity = '0';
        });
      }

      outer.appendChild(inner);
      outer.appendChild(tooltip);
      container.appendChild(outer);
      overlayElements.set(key, outer);
    }

    // Update click handler — elementId can change when rects reorder
    const iconEl = outer.firstElementChild as HTMLElement;
    if (onClick) {
      const cb = onClick;
      iconEl.onclick = (e) => {
        e.stopPropagation();
        cb(rect.elementId);
      };
    } else {
      iconEl.onclick = null;
    }

    outer.style.left = `${rect.left}px`;
    outer.style.top = `${rect.top}px`;
    outer.style.width = `${rect.width}px`;
    outer.style.height = `${rect.height}px`;
  }

  // Remove unused placeholder overlays
  for (const [key, element] of overlayElements.entries()) {
    if (!currentKeys.has(key)) {
      element.remove();
      overlayElements.delete(key);
    }
  }
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
  update: (state: Partial<OverlayState> & { editorMode?: string }) => void;
  dispose: () => void;
} {
  const state: OverlayState = {
    selectedIds: [],
    hoveredId: null,
    viewportZoom: options?.viewportZoom ?? 1,
  };
  const overlayElements = new Map<string, HTMLDivElement>();
  const placeholderElements = new Map<string, HTMLDivElement>();
  let editorMode: string = options?.editorMode ?? 'design';
  const onPlaceholderClick = options?.onPlaceholderClick;
  let rafId = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;

    const rects = computeOverlayRects(iframe, container, state);
    renderOverlayRects(container, rects, overlayElements);

    // Placeholder overlays for empty containers
    const doc = iframe.contentDocument;
    if (doc && onPlaceholderClick && editorMode !== 'interact') {
      const containerRect = container.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const offsetX = iframeRect.left - containerRect.left;
      const offsetY = iframeRect.top - containerRect.top;
      const zoom = state.viewportZoom ?? 1;

      const rawRects = getEmptyContainerRects(doc);
      const transformedRects: PlaceholderRect[] = rawRects.map((r) => ({
        elementId: r.elementId,
        left: offsetX + r.left * zoom,
        top: offsetY + r.top * zoom,
        width: r.width * zoom,
        height: r.height * zoom,
      }));

      renderPlaceholderOverlays(container, transformedRects, placeholderElements, onPlaceholderClick);
    } else {
      // Clear placeholders when in interact mode or no callback
      if (placeholderElements.size > 0) {
        clearOverlays(placeholderElements);
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    update(newState: Partial<OverlayState> & { editorMode?: string }) {
      if (newState.editorMode !== undefined) {
        editorMode = newState.editorMode;
      }
      Object.assign(state, newState);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearOverlays(overlayElements);
      clearOverlays(placeholderElements);
    },
  };
}
