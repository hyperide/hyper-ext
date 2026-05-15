/**
 * @file Drag source resolution helpers.
 *
 * Accessed via: iframe-interaction.ts _dragPointerDown
 * Assumptions: called in design mode on user-initiated pointerdown events;
 *   DOM element may be decorative (emoji, aria-hidden) with no direct source.
 *
 * Resolves the draggable element and its source location using four strategies:
 * 1. Primary: TracingResolver.getSourceLocation (source-map-aware, may be cold)
 * 2. Walk-up: for decorative children (aria-hidden spans, emoji) that have no
 *    source on their own fiber, walk up to the nearest ancestor with a source.
 * 3. Fallback: direct _debugSource read via findNearestSourceLocation (always
 *    available in React 18 Babel / Vite projects; no source maps required)
 * 4. Sibling-level walk-up: continue walking up until finding an element with
 *    at least one source-bearing sibling. This resolves inner wrappers (e.g. a
 *    nested div inside a card) to the outer card level so reorderElement can
 *    find a common parent between drag source and drop target.
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
    let cur = target.parentElement;
    while (cur && cur !== document.body) {
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

  // Step 4: walk further up until finding an element with at least one source-bearing sibling.
  // This ensures we resolve to the outermost meaningful draggable (e.g. outer card, not inner
  // wrapper). Without this, clicking inside a nested wrapper resolves to that wrapper instead
  // of its parent card, causing AstService.reorderElement to fail with "Elements must share a
  // direct JSX parent" because the wrapper and the drop target don't share a common parent.
  el = walkToMeaningfulDraggable(el, getSourceLocation);
  // Re-resolve source for the final element (it should still have a source from step 2/3).
  const finalSrc = getSourceLocation(el);
  if (finalSrc) source = finalSrc;

  return { source, el };
}

/**
 * Walk up the DOM from `el` until finding an element that has at least one sibling
 * with a resolvable source location. Returns that element, or the original `el` if
 * no such ancestor is found before reaching document.body.
 *
 * Purpose: resolve to the outermost "card-level" element rather than inner wrappers.
 * Example: in "grid > card > inner-div > text", clicking inner-div walks up to card
 * because card has siblings (other cards) with source locations, but inner-div's only
 * sibling is a decorative aria-hidden span with no source.
 */
function walkToMeaningfulDraggable(
  el: HTMLElement,
  getSourceLocation: (el: HTMLElement) => SourceLocation | null,
): HTMLElement {
  let cur: HTMLElement = el;
  while (cur.parentElement && cur.parentElement !== document.body) {
    const rawChildren = cur.parentElement.children;
    // Guard: some test environments stub parentElement without children (e.g. bare BODY sentinels).
    if (!rawChildren) break;
    const siblings = Array.from(rawChildren) as HTMLElement[];
    const hasMeaningfulSibling = siblings.some((s) => s !== cur && getSourceLocation(s) !== null);
    if (hasMeaningfulSibling) {
      return cur;
    }
    // No source-bearing sibling — go one level up if parent has a source (otherwise stop).
    const parentSrc = getSourceLocation(cur.parentElement);
    if (!parentSrc) break;
    cur = cur.parentElement;
  }
  return cur;
}
