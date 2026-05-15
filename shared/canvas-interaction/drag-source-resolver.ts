/**
 * @file Drag source resolution helpers.
 *
 * Accessed via: iframe-interaction.ts _dragPointerDown
 * Assumptions: called in design mode on user-initiated pointerdown events;
 *   DOM element may be decorative (emoji, aria-hidden) with no direct source.
 *
 * Resolves the draggable element and its source location using two strategies:
 * 1. Primary: TracingResolver.getSourceLocation (source-map-aware, may be cold)
 * 2. Fallback: direct _debugSource read via findNearestSourceLocation (always
 *    available in React 18 Babel / Vite projects; no source maps required)
 * Walk-up: for decorative children (aria-hidden spans, emoji) that have no
 *   source on their own fiber, walk up to the nearest ancestor with a source.
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
  // Step 1: try source-map-aware resolution on the target itself.
  let source = getSourceLocation(target);
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
  if (!source) {
    const fiber = getFiberFromDOM(target);
    const directLoc = findNearestSourceLocation(fiber);
    if (directLoc) {
      source = resolveCallSiteSource(directLoc, fiber, renderedComponentPath);
      el = target;
    }
  }

  if (!source) return null;
  return { source, el };
}
