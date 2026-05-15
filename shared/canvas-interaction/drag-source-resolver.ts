/**
 * @file Drag source resolution helpers.
 *
 * Accessed via: iframe-interaction.ts _dragPointerDown
 * Assumptions: called in design mode on user-initiated pointerdown events;
 *   DOM element may be decorative (emoji, aria-hidden) with no direct source.
 *
 * Resolves the draggable element and its source location using three strategies:
 * 1. Primary: TracingResolver.getSourceLocation (source-map-aware, may be cold).
 * 2. Walk-up for DECORATIVE-only children (aria-hidden spans, emoji) that have no
 *    source of their own — walk up to the nearest ancestor with a source.
 * 3. Fallback: direct _debugSource read via findNearestSourceLocation (always
 *    available in React 18 Babel / Vite projects; no source maps required).
 *
 * IMPORTANT: we DO NOT walk further up "to a meaningful draggable / outer card".
 * Doing so makes drag-handle behaviour confusing — when the user drags an inner
 * <div>{t('...')}</div> they expect that div to move, not its outer card. If a
 * subsequent reorder fails because source and drop target don't share a JSX
 * parent, that's a problem for AstService.reorderElement to handle (or for the
 * user to resolve with a more appropriate drop target), not for the resolver
 * to silently override.
 */

import { findNearestSourceLocation, getFiberFromDOM } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';
import { resolveCallSiteSource } from './resolve-source';

export interface DragSourceResult {
  /** Source location used to identify the dragged element in reorder messages. */
  source: SourceLocation;
  /** The DOM element that should visually move (may be an ancestor of the click target). */
  el: HTMLElement;
}

/**
 * Resolve the drag source for a pointerdown event target.
 *
 * @param target - The element directly under the pointer.
 * @param getSourceLocation - Resolver function (source-map-aware, may return null if cold).
 * @param renderedComponentPath - Currently rendered component path for call-site resolution.
 * @returns The resolved drag source and element, or null if the element is not draggable.
 */
export function resolveDragSource(
  target: HTMLElement,
  getSourceLocation: (el: HTMLElement) => SourceLocation | null,
  renderedComponentPath: string | null,
): DragSourceResult | null {
  // Decorative elements (aria-hidden="true") should never be the drag target themselves —
  // they carry no meaningful structure and their source points to a sub-element that users
  // cannot meaningfully reorder on its own. Always delegate to the nearest ancestor.
  const isDecorative = target.getAttribute?.('aria-hidden') === 'true';

  // Step 1: try source-map-aware resolution on the target itself (skip for decorative elements).
  let source = isDecorative ? null : getSourceLocation(target);
  let el: HTMLElement = target;

  // Step 2: walk up to the nearest ancestor with a source (handles decorative children:
  // emoji spans, aria-hidden wrappers, expression-only text nodes).
  if (!source) {
    const bodyEl = typeof document !== 'undefined' ? document.body : null;
    let cur = target.parentElement;
    while (cur && cur !== bodyEl) {
      const ancestorSrc = getSourceLocation(cur);
      if (ancestorSrc) {
        source = ancestorSrc;
        el = cur;
        break;
      }
      cur = cur.parentElement;
    }
  }

  // Step 3: fallback to direct _debugSource read (React 18 Babel / Vite) when
  // source maps are cold or unavailable. This always works for projects compiled
  // with the React Babel plugin — no async warm-up needed.
  // For decorative elements, prefer the parent's fiber to avoid dragging the span itself.
  if (!source) {
    const fiberTarget = isDecorative ? (target.parentElement ?? target) : target;
    const fiber = getFiberFromDOM(fiberTarget);
    const directLoc = findNearestSourceLocation(fiber);
    if (directLoc) {
      source = resolveCallSiteSource(directLoc, fiber, renderedComponentPath);
      el = fiberTarget;
    }
  }

  if (!source) return null;

  return { source, el };
}
