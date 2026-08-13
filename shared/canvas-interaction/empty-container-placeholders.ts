/**
 * @file Empty container detection for overlay placeholders.
 *
 * Accessed via: overlay-rects.ts (isContainerEmpty), overlay-renderer.ts (renderPlaceholderOverlays)
 * Assumptions: DOM elements have standard childNodes API
 */

import type { ComponentTreeNode, FrameworkAdapter, SourceLocation } from '../element-tracing/types';

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

// ============================================================================
// Fiber-based empty container detection
// ============================================================================

/** Placeholder rect with fiber-based nodeRef and source location instead of UUID. */
export interface FiberPlaceholderRect {
  nodeRef: string;
  source: SourceLocation;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Find empty containers using the framework adapter's component tree walk.
 * Each component tree node that renders an empty DOM element gets a placeholder.
 *
 * @param doc - iframe document
 * @param adapter - framework adapter for walking the fiber tree
 * @param nodeEntries - map from source key ("fileName:line:column") to node info
 */
export function getEmptyContainerRectsFromFiber(
  doc: Document,
  adapter: Pick<FrameworkAdapter, 'walkComponentTree'>,
  nodeEntries: Map<string, { nodeRef: string; source: SourceLocation }>,
): FiberPlaceholderRect[] {
  const root = doc.body?.firstElementChild;
  if (!root) return [];

  const tree = adapter.walkComponentTree(root as HTMLElement);
  const rects: FiberPlaceholderRect[] = [];

  function visit(nodes: ComponentTreeNode[]): void {
    for (const node of nodes) {
      if (node.domElement && isContainerEmpty(node.domElement) && node.source) {
        const key = `${node.source.fileName}:${node.source.line}:${node.source.column}`;
        const entry = nodeEntries.get(key);
        if (entry) {
          const rect = node.domElement.getBoundingClientRect();
          const effectiveHeight = Math.max(rect.height, MIN_PLACEHOLDER_HEIGHT);
          const topOffset = (effectiveHeight - rect.height) / 2;
          rects.push({
            nodeRef: entry.nodeRef,
            source: entry.source,
            left: rect.left,
            top: rect.top - topOffset,
            width: rect.width,
            height: effectiveHeight,
          });
        }
      }
      visit(node.children);
    }
  }

  visit(tree);
  return rects;
}
