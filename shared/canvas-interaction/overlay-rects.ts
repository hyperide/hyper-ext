/**
 * @file Universal overlay rect computation — shared between SaaS and VS Code extension.
 *
 * Accessed via: overlay-renderer.ts (SaaS RAF loop), iframe-interaction.ts (Extension IIFE)
 * Assumptions: OverlayElementResolver is injected by the platform (SaaS or Extension)
 */

import { isContainerEmpty, MIN_PLACEHOLDER_HEIGHT } from './empty-container-placeholders';
import { clearTracingDebugOnce, tracingDebugOnce } from './tracing-debug';
import type { OverlayElementResolver, OverlayRect, PlaceholderRect } from './types';

/**
 * Detect whether a Tailwind class list authors an explicit, pixel-resizable size per axis.
 *
 * A canvas resize handle commits `width: <N>px` / `height: <N>px`, so it is only meaningful
 * when the element's width/height is an explicit fixed pixel length. We therefore match ONLY:
 *   w-{n} / h-{n} / size-{n} (numeric), the -px variants, and absolute-length arbitrary
 *   values like w-[425px] / h-[10rem].
 *
 * We deliberately do NOT match:
 *   - keyword sizes (auto, full, screen, min, max, fit, fractions like w-1/2) — intrinsic
 *     / container-relative, not a draggable pixel value;
 *   - constraint classes (min-w-*, max-w-*, basis-*, min-h-*, max-h-*) — they only cap or
 *     seed the box; the width/height itself stays `auto`, so a pixel drag does nothing
 *     (e.g. Tweet.tsx Action bar `max-w-[425px]` with no explicit width — supersedes #296);
 *   - non-pixel arbitrary values (w-[50%], w-[auto], w-[min-content], …) — see
 *     {@link isPixelResizableArbitraryValue}.
 *
 * Design intent for variant-prefixed classes (e.g. md:w-12, hover:md:w-12):
 * We treat these as "this size class exists and can be edited", regardless of whether
 * the viewport currently satisfies the breakpoint. A resize handle is shown even if the
 * class is inactive at the current viewport — this is "editable, not applied" semantics.
 *
 * Stacked variants (hover:md:w-12, dark:hover:md:w-12) are handled by stripping all
 * variant prefixes: lastIndexOf(':') up to (but not including) the first '[', so CSS
 * type-hint arbitrary values like w-[length:50px] are never mis-parsed.
 */
export function detectTailwindExplicitSize(className: string | undefined): { width: boolean; height: boolean } {
  if (!className || typeof className !== 'string') return { width: false, height: false };
  let width = false;
  let height = false;
  for (const cls of className.split(/\s+/)) {
    const bracketIdx = cls.indexOf('[');
    const searchEnd = bracketIdx === -1 ? cls.length : bracketIdx;
    const colonIdx = cls.lastIndexOf(':', searchEnd - 1);
    const bare = colonIdx !== -1 ? cls.slice(colonIdx + 1) : cls;
    if (!width && isTailwindSizeClass(bare, 'w')) width = true;
    if (!height && isTailwindSizeClass(bare, 'h')) height = true;
    if ((!width || !height) && isTailwindSizeClass(bare, 'size')) {
      width = true;
      height = true;
    }
    if (width && height) break;
  }
  return { width, height };
}

function isTailwindSizeClass(cls: string, axis: string): boolean {
  const prefix = `${axis}-`;
  if (!cls.startsWith(prefix)) return false;
  const rest = cls.slice(prefix.length);
  if (!rest) return false;
  if (rest === 'px') return true;
  if (rest[0] === '[') return isPixelResizableArbitraryValue(rest);
  return rest[0] >= '0' && rest[0] <= '9' && !rest.includes('/');
}

/**
 * A fixed CSS length: unitless `0`, or a numeric magnitude followed by an absolute (px, cm,
 * mm, q, in, pc, pt) or font-relative (em, rem, ex, rex, cap, rcap, ch, rch, ic, ric, lh, rlh)
 * length unit — the complete set of CSS units that resolve to a fixed px value. ONLY these are
 * pixel-resizable: a resize handle commits `<dim>: <N>px`, which can meaningfully replace a
 * fixed length but NOT a value that is viewport-, container-, content-, or runtime-derived.
 * This is an allow-list, so anything unlisted is rejected: percentages (`%`), viewport units
 * (vw/vh/vmin/vmax/vi/vb/dvh/…), container-query units (cqw/cqh/…), `fr`, intrinsic keywords
 * (auto/min/max/fit-content, stretch), and runtime expressions (`calc()`/`var()`/`clamp()`/`env()`).
 */
const FIXED_LENGTH_ARBITRARY_VALUE =
  /^(?:0|(?:\d+|\d*\.\d+)(?:px|cm|mm|q|in|pc|pt|rem|em|rex|ex|rcap|cap|rch|ch|ric|ic|rlh|lh))$/i;

/**
 * Whether a Tailwind arbitrary value (the `[...]` form) authors a fixed, pixel-resizable
 * length. A resize handle writes `<dim>: <N>px`, so only an absolute / font-relative length
 * can be pixel-dragged. Percentages, viewport/container units, intrinsic keywords (auto,
 * min/max/fit-content), `fr`, and runtime expressions (`calc()`, `var()`, …) are not fixed
 * lengths — dragging them in pixels is meaningless — so they get no handle.
 *
 * Accepts an optional CSS type hint (`[length:50px]`, `[percentage:50%]`) and validates the
 * value AFTER the hint.
 */
function isPixelResizableArbitraryValue(bracket: string): boolean {
  let value = bracket.replace(/^\[/, '').replace(/\]$/, '').trim();
  const hintIdx = value.indexOf(':');
  if (hintIdx !== -1) value = value.slice(hintIdx + 1).trim();
  return FIXED_LENGTH_ARBITRARY_VALUE.test(value);
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
    let elements = resolver.findElements(id, itemIndex);
    // effectiveItemIndex drives key generation: null means "use loop index i" so that
    // multiple fallback instances each get a unique key.
    let effectiveItemIndex = itemIndex;

    // Stale-index fallback: selectedItemIndices may carry an out-of-range itemIndex
    // (e.g. a .map() list shrank after HMR while the stored index wasn't reset).
    // Rather than silently dropping the overlay, retry with itemIndex=null to surface
    // all currently-live instances so the Canvas selection frame stays visible.
    if (elements.length === 0 && itemIndex !== null) {
      elements = resolver.findElements(id, null);
      effectiveItemIndex = null;
    }

    // Silent-death point: a selected id resolving to zero elements means no selection
    // overlay is drawn at all. Once-per-key — this runs inside the RAF loop.
    const missKey = `overlay-rects:${id}:${itemIndex}`;
    if (elements.length === 0) {
      tracingDebugOnce(missKey, 'overlay-rects: no elements for selected id', id, 'itemIndex', itemIndex);
    } else {
      clearTracingDebugOnce(missKey);
    }

    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect();
      const key = effectiveItemIndex !== null ? `select-${id}-${effectiveItemIndex}` : `select-${id}-${i}`;
      const overlayRect: OverlayRect = {
        key,
        elementId: id,
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
      if (resizable.width || resizable.height) {
        const hasSizeClass = rawClass.split(/\s+/).some((cls) => {
          const bracketIdx = cls.indexOf('[');
          const searchEnd = bracketIdx === -1 ? cls.length : bracketIdx;
          const colonIdx = cls.lastIndexOf(':', searchEnd - 1);
          const bare = colonIdx !== -1 ? cls.slice(colonIdx + 1) : cls;
          return isTailwindSizeClass(bare, 'size');
        });
        overlayRect.resizable = hasSizeClass ? { ...resizable, hasSizeClass: true } : resizable;
      }
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
