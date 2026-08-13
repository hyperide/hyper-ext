/**
 * Drag-and-drop order reordering utilities for the iframe interaction script.
 * Builds order-write plans for Tailwind `order-N` class mutations.
 */

import type { OrderWritePlan, SiblingInfo } from '@shared/canvas-interaction/order-drag-detect';
import { computeOrderWritePlan } from '@shared/canvas-interaction/order-drag-detect';

/**
 * Walk both source and drop DOMs upward to find the lowest common ancestor where
 * source-branch and drop-branch are distinct direct children.
 */
function findReorderSiblings(
  sourceEl: HTMLElement,
  dropEl: HTMLElement,
): { parent: HTMLElement; sourceSibling: HTMLElement; dropSibling: HTMLElement } | null {
  if (sourceEl === dropEl) return null;
  if (sourceEl.contains(dropEl) || dropEl.contains(sourceEl)) return null;

  let srcAncestor: HTMLElement | null = sourceEl;
  while (srcAncestor?.parentElement) {
    const parentEl: HTMLElement = srcAncestor.parentElement;
    let dropBranch: HTMLElement | null = dropEl;
    while (dropBranch && dropBranch.parentElement !== parentEl) {
      dropBranch = dropBranch.parentElement;
    }
    if (dropBranch && dropBranch !== srcAncestor) {
      return { parent: parentEl, sourceSibling: srcAncestor, dropSibling: dropBranch };
    }
    srcAncestor = parentEl;
  }
  return null;
}

/**
 * Build the order-write plan for a drag-drop, or return `null` to fall back to
 * the AST-move path.
 */
export function resolveOrderWritePlan(
  sourceEl: HTMLElement,
  dropEl: HTMLElement,
  clientX: number,
  clientY: number,
  deps: {
    getSourceLocation: (el: HTMLElement) => { fileName: string; line: number; column: number } | null;
    isHorizontalLayout: (el: HTMLElement) => boolean;
  },
): OrderWritePlan | null {
  const lca = findReorderSiblings(sourceEl, dropEl);
  if (!lca) return null;
  const { parent, sourceSibling, dropSibling } = lca;

  const dropSiblingRect = dropSibling.getBoundingClientRect();
  const position: 'before' | 'after' = deps.isHorizontalLayout(dropSibling)
    ? clientX < dropSiblingRect.left + dropSiblingRect.width / 2
      ? 'before'
      : 'after'
    : clientY < dropSiblingRect.top + dropSiblingRect.height / 2
      ? 'before'
      : 'after';

  const siblings: SiblingInfo[] = [];
  let domIndex = 0;
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const loc = deps.getSourceLocation(child);
    if (!loc) continue;
    siblings.push({
      elementId: `${loc.fileName}:${loc.line}:${loc.column}`,
      filePath: loc.fileName,
      className: child.getAttribute('class') ?? '',
      domIndex: domIndex++,
    });
  }

  const sourceLoc = deps.getSourceLocation(sourceSibling);
  const dropLoc = deps.getSourceLocation(dropSibling);
  if (!sourceLoc || !dropLoc) return null;
  const sourceBranchId = `${sourceLoc.fileName}:${sourceLoc.line}:${sourceLoc.column}`;
  const dropBranchId = `${dropLoc.fileName}:${dropLoc.line}:${dropLoc.column}`;
  if (!siblings.some((s) => s.elementId === sourceBranchId)) return null;
  if (!siblings.some((s) => s.elementId === dropBranchId)) return null;

  return computeOrderWritePlan({
    siblings,
    source: sourceBranchId,
    target: dropBranchId,
    position,
    viewportWidth: window.innerWidth,
  });
}
