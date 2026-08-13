/**
 * Canvas overlay renderer — draws selection/hover rectangles over iframe elements.
 *
 * Ported from useSelectionOverlays.ts (lines 56-195).
 * Two levels of API:
 *   - renderOverlayRects(): low-level, renders pre-computed rects (VS Code webview)
 *   - createOverlayRenderer(): high-level, RAF loop with DOM queries (SaaS)
 */

import { buildSquareRotatedPlusSvg } from '../icons/square-rotated-plus';
import { computeOverlayRects as computeSharedRects } from './overlay-rects';
import type {
  OverlayElementResolver,
  OverlayRect,
  OverlayRendererOptions,
  OverlayState,
  PlaceholderRect,
} from './types';

const HOVER_BORDER = '2px solid rgba(59, 130, 246, 0.5)';
const SELECTION_BORDER = '2px solid rgb(59, 130, 246)';

// HYP-991 — error overlay: a red OUTLINE (not border) so it stacks on top of the existing
// selection/hover border without fighting it, plus a small warning badge. Applied to the overlay
// of the element whose source the last visual edit left with a new language-server error.
const ERROR_OUTLINE = '2px solid rgb(239, 68, 68)';
const ERROR_BADGE_ATTR = 'data-post-edit-error-badge';

const HANDLE_SIZE = 8;

function createResizeHandleDot(axis: 'width' | 'height'): HTMLDivElement {
  const dot = document.createElement('div');
  dot.setAttribute('data-resize-handle', axis);
  dot.style.position = 'absolute';
  dot.style.width = `${HANDLE_SIZE}px`;
  dot.style.height = `${HANDLE_SIZE}px`;
  dot.style.borderRadius = '50%';
  dot.style.background = 'rgb(59, 130, 246)';
  dot.style.border = '2px solid white';
  dot.style.boxSizing = 'border-box';
  dot.style.pointerEvents = 'auto';
  dot.style.cursor = axis === 'width' ? 'ew-resize' : 'ns-resize';
  if (axis === 'width') {
    dot.style.right = `${-HANDLE_SIZE / 2}px`;
    dot.style.top = '50%';
    dot.style.transform = 'translateY(-50%)';
  } else {
    dot.style.bottom = `${-HANDLE_SIZE / 2}px`;
    dot.style.left = '50%';
    dot.style.transform = 'translateX(-50%)';
  }
  return dot;
}

function syncResizeHandles(overlay: HTMLDivElement, rect: OverlayRect, enable: boolean): void {
  const wantWidth = enable && rect.type === 'selection' && !!rect.resizable?.width;
  const wantHeight = enable && rect.type === 'selection' && !!rect.resizable?.height;
  let hasWidth = false;
  let hasHeight = false;
  for (const child of overlay.children) {
    const axis = (child as HTMLElement).getAttribute('data-resize-handle');
    if (axis === 'width') hasWidth = true;
    else if (axis === 'height') hasHeight = true;
  }
  if (hasWidth === wantWidth && hasHeight === wantHeight) return;
  for (const child of Array.from(overlay.children)) {
    if ((child as HTMLElement).hasAttribute('data-resize-handle')) child.remove();
  }
  if (wantWidth) overlay.appendChild(createResizeHandleDot('width'));
  if (wantHeight) overlay.appendChild(createResizeHandleDot('height'));
}

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
  options?: { enableResizeHandles?: boolean },
): void {
  const enableHandles = options?.enableResizeHandles ?? true;
  const currentKeys = new Set<string>();

  for (const rect of rects) {
    currentKeys.add(rect.key);

    let element = overlayElements.get(rect.key);
    if (!element) {
      element = document.createElement('div');
      // HYP-991 — error overlays carry a DISTINCT attribute, not data-selection-overlay: they must
      // NOT be counted by the selection-overlay invariant (checkSelectionOverlayInvariant) nor be
      // measured as sibling geometry by the spacing-guide collector (collectSiblingRects). Both of
      // those query [data-selection-overlay]; a standing error overlay is neither a selection nor a
      // real sibling. applyOverlayErrorState flags it by matching dataset.elementId, so the
      // attribute rename does not affect the highlight itself.
      element.setAttribute(rect.type === 'error' ? 'data-error-overlay' : 'data-selection-overlay', 'true');
      element.style.position = 'absolute';
      element.style.pointerEvents = 'none';
      // HYP-991 — 'error' overlays are borderless: the red outline + "!" badge come from
      // applyOverlayErrorState, so a base border here would fight it. hover/selection keep theirs.
      element.style.border = rect.type === 'error' ? 'none' : rect.type === 'hover' ? HOVER_BORDER : SELECTION_BORDER;
      container.appendChild(element);
      overlayElements.set(rect.key, element);
    }

    if (rect.elementId) {
      element.dataset.elementId = rect.elementId;
    } else {
      delete element.dataset.elementId;
    }

    if (rect.resizable?.hasSizeClass) {
      element.dataset.hasSizeClass = 'true';
    } else {
      delete element.dataset.hasSizeClass;
    }

    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    syncResizeHandles(element, rect, enableHandles);
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
 * HYP-991 — flag (or unflag) the overlay of the element whose source the last visual edit left
 * with a NEW language-server error. Uses a red OUTLINE plus a small "!" badge so it layers over
 * the normal selection/hover border without replacing it. Idempotent and safe to re-run after any
 * `renderOverlayRects` rebuild (call it again with the same `errorElementId` to re-apply).
 *
 * Shared home per the repo's overlay-rendering rule; the VS Code extension consumes it today.
 * SaaS has no in-browser language server to source these diagnostics from, so it does not wire
 * this yet — when it gains a diagnostics source it reuses this same helper.
 */
export function applyOverlayErrorState(
  overlayElements: Map<string, HTMLDivElement>,
  errorElementId: string | null,
): void {
  for (const element of overlayElements.values()) {
    const isError = elementIdsMatch(element.dataset.elementId, errorElementId);
    const badge = element.querySelector(`[${ERROR_BADGE_ATTR}]`);
    if (isError) {
      element.style.outline = ERROR_OUTLINE;
      element.style.outlineOffset = '1px';
      if (!badge) element.appendChild(createErrorBadge());
    } else if (badge) {
      // Clear only the overlays WE flagged — the presence of our badge is the ownership signal, so
      // this never touches an overlay this helper did not flag. (No other overlay feature uses
      // `outline` today — they use `border` — so resetting it to '' here is safe; review.)
      element.style.outline = '';
      element.style.outlineOffset = '';
      badge.remove();
    }
  }
}

/**
 * Whether two element ids refer to the same element, tolerating a path-prefix difference on a `/`
 * boundary. In a monorepo the mutation's id that reaches the AST bridge is re-rooted to
 * repo-relative (e.g. `targets/web/src/App.tsx:5:8`) while the overlay's dataset.elementId is
 * sub-project-relative (`src/App.tsx:5:8`), so one is a `/`-boundary suffix of the other. (The
 * bridge cannot reliably re-derive the sub-project prefix on the PanelRouter path — PanelRouter
 * re-roots with its own prefix — so the tolerant match lives here.)
 *
 * The `/`-boundary keeps `src/a/index.tsx:5:8` and `src/b/index.tsx:5:8` DISTINCT (neither is a
 * `/`-suffix of the other), avoiding the basename-only collision a naive tail match would cause.
 * The remaining theoretical case — two sibling sub-projects that share a path SUFFIX (HYP-430) —
 * is not reachable here: only ONE sub-project is previewed at a time, so the overlay layer only
 * ever holds the active sub-project's elements, and the broadcast id is from an edit in that same
 * active sub-project. There is no second sub-project's overlay present to mis-match against.
 */
export function elementIdsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (a == null || b == null) return false;
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** A small red "!" badge pinned to the top-right corner of an overlay div. Purely decorative. */
function createErrorBadge(): HTMLDivElement {
  const badge = document.createElement('div');
  badge.setAttribute(ERROR_BADGE_ATTR, 'true');
  badge.textContent = '!';
  badge.style.position = 'absolute';
  badge.style.top = '-9px';
  badge.style.right = '-9px';
  badge.style.width = '16px';
  badge.style.height = '16px';
  badge.style.borderRadius = '50%';
  badge.style.background = 'rgb(239, 68, 68)';
  badge.style.color = '#fff';
  badge.style.fontSize = '11px';
  badge.style.fontWeight = '700';
  badge.style.lineHeight = '16px';
  badge.style.textAlign = 'center';
  badge.style.pointerEvents = 'none';
  badge.style.zIndex = '2';
  return badge;
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

/** Apply iframe→container offset and zoom to raw viewport-relative rects. */
function transformRects<T extends { left: number; top: number; width: number; height: number }>(
  rects: T[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): T[] {
  return rects.map((r) => ({
    ...r,
    left: offsetX + r.left * zoom,
    top: offsetY + r.top * zoom,
    width: r.width * zoom,
    height: r.height * zoom,
  }));
}

/**
 * Create an overlay renderer with RAF loop for direct iframe DOM access.
 * Uses OverlayElementResolver for platform-agnostic element lookup.
 *
 * @param iframe - The preview iframe element
 * @param container - The overlay container (position: absolute, covers iframe)
 * @param options - viewportZoom, elementResolver, and callbacks
 */
export function createOverlayRenderer(
  iframe: HTMLIFrameElement,
  container: HTMLElement,
  options?: OverlayRendererOptions,
): {
  update: (state: Partial<OverlayState> & { editorMode?: string; elementResolver?: OverlayElementResolver }) => void;
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
  let elementResolver: OverlayElementResolver | undefined = options?.elementResolver;
  let rafId = 0;
  let disposed = false;

  function tick() {
    if (disposed) return;

    if (elementResolver) {
      const containerRect = container.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();
      const offsetX = iframeRect.left - containerRect.left;
      const offsetY = iframeRect.top - containerRect.top;
      const zoom = state.viewportZoom ?? 1;

      const result = computeSharedRects(
        {
          selectedIds: state.selectedIds,
          hoveredId: state.hoveredId,
          hoveredItemIndex: state.hoveredItemIndex,
          selectedItemIndices: state.selectedItemIndices,
          engineMode: editorMode,
        },
        elementResolver,
      );

      const transformedOverlay = transformRects(result.overlayRects, offsetX, offsetY, zoom);
      renderOverlayRects(container, transformedOverlay, overlayElements, { enableResizeHandles: false });

      if (onPlaceholderClick && editorMode !== 'interact') {
        const transformedPlaceholders = transformRects(result.placeholderRects, offsetX, offsetY, zoom);
        renderPlaceholderOverlays(container, transformedPlaceholders, placeholderElements, onPlaceholderClick);
      } else if (placeholderElements.size > 0) {
        clearOverlays(placeholderElements);
      }
    } else {
      // No resolver — clear all overlays
      if (overlayElements.size > 0) clearOverlays(overlayElements);
      if (placeholderElements.size > 0) clearOverlays(placeholderElements);
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return {
    update(newState: Partial<OverlayState> & { editorMode?: string; elementResolver?: OverlayElementResolver }) {
      if (newState.editorMode !== undefined) {
        editorMode = newState.editorMode;
      }
      if (newState.elementResolver !== undefined) {
        elementResolver = newState.elementResolver;
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
