/**
 * Query empty containers in an iframe document.
 *
 * Returns bounding rects for [data-uniq-id] elements that have no
 * meaningful children (only whitespace text nodes). Used by the overlay
 * system to render placeholder overlays outside the iframe.
 *
 * Side effect: toggles `hc-empty` CSS class on containers so that
 * design-mode styles (min-height) can keep them from collapsing to 0px.
 */

import type { PlaceholderRect } from './types';

const CONTAINER_SELECTOR = '[data-uniq-id]';
export const EMPTY_CLASS = 'hc-empty';

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
 * Marks empty containers with `hc-empty` class (for min-height CSS),
 * removes class from non-empty containers.
 */
export function getEmptyContainerRects(doc: Document): PlaceholderRect[] {
  if (!doc.body) return [];

  const containers = doc.body.querySelectorAll(CONTAINER_SELECTOR);
  const rects: PlaceholderRect[] = [];

  for (const container of containers) {
    if (!isContainerEmpty(container)) {
      container.classList.remove(EMPTY_CLASS);
      continue;
    }

    const elementId = container.getAttribute('data-uniq-id');
    if (!elementId) continue;

    container.classList.add(EMPTY_CLASS);

    const rect = container.getBoundingClientRect();
    rects.push({
      elementId,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }

  return rects;
}
