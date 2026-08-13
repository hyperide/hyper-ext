/**
 * Query empty containers in an iframe document.
 *
 * Returns bounding rects for [data-uniq-id] elements that have no
 * meaningful children (only whitespace text nodes). Used by the overlay
 * system to render placeholder overlays outside the iframe.
 *
 * Enforces a minimum height on returned rects so that overlays remain
 * visible and clickable even when the container collapses to 0px —
 * without injecting any CSS that would alter the iframe layout.
 */

import type { PlaceholderRect } from './types';

const CONTAINER_SELECTOR = '[data-uniq-id]';

/** Minimum overlay height so collapsed containers remain visible/clickable. */
export const MIN_PLACEHOLDER_HEIGHT = 28;

// Node type constants (avoid relying on global Node which may not exist in test envs)
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Check if a container has no meaningful element children (ignoring whitespace text nodes). */
export function isContainerEmpty(el: Element): boolean {
  for (const child of el.childNodes) {
    if (child.nodeType === ELEMENT_NODE) return false;
    if (child.nodeType === TEXT_NODE && child.textContent?.trim()) return false;
  }
  return true;
}

/**
 * Find all empty containers and return their bounding rects.
 * Enforces MIN_PLACEHOLDER_HEIGHT so overlays stay visible on collapsed containers.
 */
export function getEmptyContainerRects(doc: Document): PlaceholderRect[] {
  if (!doc.body) return [];

  const containers = doc.body.querySelectorAll(CONTAINER_SELECTOR);
  const rects: PlaceholderRect[] = [];

  for (const container of containers) {
    if (!isContainerEmpty(container)) continue;

    const elementId = container.getAttribute('data-uniq-id');
    if (!elementId) continue;

    const rect = container.getBoundingClientRect();
    const effectiveHeight = Math.max(rect.height, MIN_PLACEHOLDER_HEIGHT);
    const topOffset = (effectiveHeight - rect.height) / 2;
    rects.push({
      elementId,
      left: rect.left,
      top: rect.top - topOffset,
      width: rect.width,
      height: effectiveHeight,
    });
  }

  return rects;
}
