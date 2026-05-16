/**
 * @file Drag source resolution helpers.
 *
 * Accessed via: iframe-interaction.ts _dragPointerDown
 * Assumptions: called in design mode on user-initiated pointerdown events;
 *   DOM element may be decorative (emoji, aria-hidden) with no direct source.
 *
 * Resolves the draggable element and its source location using three strategies:
 * 1. Primary: TracingResolver.getSourceLocation (source-map-aware, may be cold).
 * 2. Fallback: direct _debugSource read via findNearestSourceLocation (always
 *    available in React 18 Babel / Vite projects; no source maps required).
 *    Runs BEFORE step 3 — see inline comment.
 * 3. Last resort: walk up to the nearest ancestor with a source (aria-hidden
 *    wrappers, expression-only text nodes that slipped past steps 1 and 2).
 *
 * IMPORTANT: we DO NOT walk further up "to a meaningful draggable / outer card".
 * Doing so makes drag-handle behaviour confusing — when the user drags an inner
 * <div>{t('...')}</div> they expect that div to move, not its outer card.
 * AstService.moveElement handles arbitrary source/target combinations (same
 * parent, cross-parent, cross-file, cross-component); the resolver's job is to
 * faithfully report the dragged element, not silently override it.
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
  const isDecorative = target.getAttribute('aria-hidden') === 'true';

  // Step 1: try source-map-aware resolution on the target itself (skip for decorative elements).
  let source = isDecorative ? null : getSourceLocation(target);
  let el: HTMLElement = target;

  // Step 2: fallback to direct _debugSource read (React 18 Babel / Vite) when
  // source maps are cold or unavailable. This always works for projects compiled
  // with the React Babel plugin — no async warm-up needed.
  // Must run BEFORE the ancestor walk-up (step 3), otherwise non-decorative
  // elements like <img> incorrectly resolve to their parent's source location.
  // For decorative elements, prefer the parent's fiber to avoid dragging the span itself.
  if (!source) {
    // For decorative elements, skip Step 2 entirely when parentElement is null —
    // passing the decorative element itself to getFiberFromDOM would violate the
    // invariant that decorative elements are never the drag target.
    const fiberTarget = isDecorative ? target.parentElement : target;
    if (fiberTarget !== null) {
      const fiber = getFiberFromDOM(fiberTarget);
      const directLoc = findNearestSourceLocation(fiber);
      if (directLoc) {
        source = resolveCallSiteSource(directLoc, fiber, renderedComponentPath);
        el = fiberTarget;
      }
    }
  }

  // Step 3: walk up to the nearest ancestor with a source — last resort for
  // elements with no fiber source (aria-hidden wrappers, expression-only text nodes
  // that slipped past steps 1 and 2).
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

  if (!source) return null;

  return { source, el };
}
