/**
 * @file Fiber-based element query utilities — replacements for mapElementQuery.ts
 *
 * Accessed via: overlay-renderer.ts, click-handler.ts, keyboard-handler.ts
 * Assumptions: FrameworkAdapter is initialized and fiber tree is available in the iframe
 */

import type { FrameworkAdapter, SourceLocation } from '../element-tracing/types';

/** Create a deterministic lookup key from a source location. */
export function buildSourceKey(source: SourceLocation): string {
  return `${source.fileName}:${source.line}:${source.column}`;
}

/**
 * Find DOM element(s) by source location using the framework adapter.
 * When itemIndex is specified, returns only that element.
 * When null, finds all elements at that source location (for .map() highlighting).
 */
export function findDOMElementsBySource(
  adapter: Pick<FrameworkAdapter, 'findDOMElement'>,
  source: SourceLocation,
  itemIndex: number | null,
): HTMLElement[] {
  if (itemIndex !== null) {
    const el = adapter.findDOMElement(source, itemIndex);
    return el ? [el] : [];
  }

  // Find all elements at this source location (iterate until findDOMElement returns null)
  const elements: HTMLElement[] = [];
  for (let i = 0; i < 1000; i++) {
    const el = adapter.findDOMElement(source, i);
    if (!el) break;
    elements.push(el);
  }
  return elements;
}

/**
 * Compute the item index of an element among fiber siblings with the same source.
 * Wraps adapter.getItemIndex() for consistent API.
 */
export function computeFiberItemIndex(adapter: Pick<FrameworkAdapter, 'getItemIndex'>, element: HTMLElement): number {
  return adapter.getItemIndex(element);
}
