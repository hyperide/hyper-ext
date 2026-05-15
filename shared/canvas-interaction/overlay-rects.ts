/**
 * @file Universal overlay rect computation — shared between SaaS and VS Code extension.
 *
 * Accessed via: overlay-renderer.ts (SaaS RAF loop), iframe-interaction.ts (Extension IIFE)
 * Assumptions: OverlayElementResolver is injected by the platform (SaaS or Extension)
 */

import { isContainerEmpty, MIN_PLACEHOLDER_HEIGHT } from './empty-container-placeholders';
import type { OverlayElementResolver, OverlayRect, PlaceholderRect } from './types';

/**
 * Detect whether a Tailwind class list contains explicit fixed-size classes per axis.
 * Matches: w-{n}, h-{n} (numeric including decimals), w-px/h-px, w-[...]/h-[...] arbitrary.
 * Does NOT match keyword sizes: auto, full, screen, min, max, fit.
 */
export function detectTailwindExplicitSize(className: string | undefined): { width: boolean; height: boolean } {
  if (!className || typeof className !== 'string') return { width: false, height: false };
  let width = false;
  let height = false;
  for (const cls of className.split(/\s+/)) {
    const bare = cls.includes(':') ? cls.substring(cls.lastIndexOf(':') + 1) : cls;
    if (!width && isTailwindSizeClass(bare, 'w')) width = true;
    if (!height && isTailwindSizeClass(bare, 'h')) height = true;
    if (width && height) break;
  }
  return { width, height };
}

function isTailwindSizeClass(cls: string, axis: 'w' | 'h'): boolean {
  const prefix = `${axis}-`;
  if (!cls.startsWith(prefix)) return false;
  const rest = cls.slice(prefix.length);
  if (!rest) return false;
  if (rest === 'px') return true;
  if (rest[0] === '[') return true;
  return rest[0] >= '0' && rest[0] <= '9' && !rest.includes('/');
}

export interface OverlayComputeState {
  selectedIds: string[];
  hoveredId: string | null;
  hoveredItemIndex?: number | null;
  selectedItemIndices?: Map<string, number | null> | Record<string, number | null>;
  engineMode?: string;
}

export interface OverlayComputeResult {
  overlayRects: OverlayRect[];
  placeholderRects: PlaceholderRect[];
}

/** Read itemIndex from Map or Record. */
function getItemIndex(
  indices: Map<string, number | null> | Record<string, number | null> | undefined,
  id: string,
): number | null {
  if (!indices) return null;
  if (indices instanceof Map) return indices.get(id) ?? null;
  return indices[id] ?? null;
}

/**
 * Compute all overlay rects (selection + hover + placeholders) using the given resolver.
 * Returns raw viewport-relative rects — caller applies offset/zoom if needed.
 */
export function computeOverlayRects(
  state: OverlayComputeState,
  resolver: OverlayElementResolver,
): OverlayComputeResult {
  const overlayRects: OverlayRect[] = [];

  // Hover rect (skip if exact same item is selected)
  if (state.hoveredId) {
    const hoveredItemIdx = state.hoveredItemIndex ?? null;
    const selectedItemIdx = getItemIndex(state.selectedItemIndices, state.hoveredId);
    const isExactItemSelected = state.selectedIds.includes(state.hoveredId) && selectedItemIdx === hoveredItemIdx;

    if (!isExactItemSelected) {
      const hoverElements = resolver.findElements(state.hoveredId, hoveredItemIdx ?? 0);
      if (hoverElements.length > 0) {
        const rect = hoverElements[0].getBoundingClientRect();
        const key = hoveredItemIdx !== null ? `hover-${state.hoveredId}-${hoveredItemIdx}` : `hover-${state.hoveredId}`;
        overlayRects.push({
          key,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          type: 'hover',
        });
      }
    }
  }

  // Selection rects
  for (const id of state.selectedIds) {
    const itemIndex = getItemIndex(state.selectedItemIndices, id);
    const elements = resolver.findElements(id, itemIndex);

    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect();
      const key = itemIndex !== null ? `select-${id}-${itemIndex}` : `select-${id}-${i}`;
      const overlayRect: OverlayRect = {
        key,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        type: 'selection',
      };
      const cn = elements[i].className;
      // SVGElement.className is SVGAnimatedString in the browser, not a plain string
      const rawClass = typeof cn === 'string' ? cn : (cn as unknown as SVGAnimatedString).baseVal;
      const resizable = detectTailwindExplicitSize(rawClass);
      if (resizable.width || resizable.height) overlayRect.resizable = resizable;
      overlayRects.push(overlayRect);
    }
  }

  // Placeholder rects for empty containers
  const placeholderRects: PlaceholderRect[] = [];
  if (state.engineMode !== 'interact') {
    const empties = resolver.findEmptyContainers();
    for (const { elementId, element } of empties) {
      if (!isContainerEmpty(element)) continue;
      const rect = element.getBoundingClientRect();
      const effectiveHeight = Math.max(rect.height, MIN_PLACEHOLDER_HEIGHT);
      const topOffset = (effectiveHeight - rect.height) / 2;
      placeholderRects.push({
        elementId,
        left: rect.left,
        top: rect.top - topOffset,
        width: rect.width,
        height: effectiveHeight,
      });
    }
  }

  return { overlayRects, placeholderRects };
}
