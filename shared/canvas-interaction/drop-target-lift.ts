/**
 * @file drop-target-lift — promote drag source and drop target to siblings.
 *
 * Accessed via: iframe-interaction._dragPointerUp before posting reorderElement.
 * Assumptions: pure DOM walk, no source-map awareness; the caller is responsible
 *   for resolving source locations on the lifted elements afterwards.
 *
 * AstService.reorderElement requires source and target to share a direct JSX
 * parent. Without lifting, dropping an inner span/div onto another card fails
 * because their click-resolved elements don't share a parent. We find the
 * lowest common DOM ancestor and promote both sides to its direct children —
 * which usually corresponds to the JSX list container the user perceives.
 */

export interface LiftedPair {
  source: HTMLElement | null;
  drop: HTMLElement | null;
}

export function liftToCommonSiblings(source: HTMLElement, drop: HTMLElement): LiftedPair {
  if (source === drop) return { source: null, drop: null };
  const sourceAncestors: HTMLElement[] = [];
  for (let c: HTMLElement | null = source; c; c = c.parentElement) sourceAncestors.push(c);
  let common: HTMLElement | null = null;
  for (let c: HTMLElement | null = drop; c; c = c.parentElement) {
    if (sourceAncestors.includes(c)) {
      common = c;
      break;
    }
  }
  if (!common) return { source: null, drop: null };
  return {
    source: walkUpToChildOf(source, common),
    drop: walkUpToChildOf(drop, common),
  };
}

function walkUpToChildOf(start: HTMLElement, ancestor: HTMLElement): HTMLElement | null {
  if (start === ancestor) return null;
  let cur: HTMLElement | null = start;
  while (cur?.parentElement && cur.parentElement !== ancestor) cur = cur.parentElement;
  return cur && cur.parentElement === ancestor ? cur : null;
}
