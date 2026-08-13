/**
 * Utilities for querying map-rendered elements with proper instance scoping.
 *
 * In board mode (multiple instances), elements with the same data-uniq-id exist
 * in each instance. Without scoping queries to the active instance, itemIndex
 * values computed globally won't match the instance-scoped element lists used
 * for overlay rendering — causing hover/click to target wrong elements.
 */

/**
 * Build a CSS selector for elements with given uniqId,
 * optionally scoped to a specific canvas instance.
 */
export function buildElementSelector(uniqId: string, instanceId?: string | null): string {
  let selector = `[data-uniq-id="${uniqId}"]`;
  if (instanceId) {
    selector = `[data-canvas-instance-id="${instanceId}"] ${selector}`;
  }
  return selector;
}

/**
 * Compute the item index of an element among all elements
 * with the same data-uniq-id (within the instance scope).
 * Returns null if there's only one element (not a map-rendered case).
 */
export function computeItemIndex(
  doc: Document,
  uniqId: string,
  element: Element,
  instanceId?: string | null,
): number | null {
  const selector = buildElementSelector(uniqId, instanceId);
  const allWithSameId = doc.querySelectorAll(selector);
  if (allWithSameId.length > 1) {
    return Array.from(allWithSameId).indexOf(element);
  }
  return null;
}

/**
 * Find a specific element by its item index among all elements
 * with the same data-uniq-id (within the instance scope).
 * Falls back to first element or null.
 */
export function findElementByItemIndex(
  doc: Document,
  uniqId: string,
  itemIndex: number | null,
  instanceId?: string | null,
): Element | null {
  const selector = buildElementSelector(uniqId, instanceId);
  const allElements = doc.querySelectorAll(selector);
  if (itemIndex !== null && allElements[itemIndex]) {
    return allElements[itemIndex];
  }
  return allElements[0] ?? null;
}

/**
 * Find all elements with given uniqId (within the instance scope).
 * If itemIndex is valid, returns only that element.
 * Otherwise returns all elements (for highlighting all map items).
 */
export function findElementsForHighlight(
  doc: Document,
  uniqId: string,
  itemIndex: number | null | undefined,
  instanceId?: string | null,
): Element[] {
  const selector = buildElementSelector(uniqId, instanceId);
  const allElements = doc.querySelectorAll(selector);
  if (itemIndex !== null && itemIndex !== undefined && allElements[itemIndex]) {
    return [allElements[itemIndex]];
  }
  return Array.from(allElements);
}
