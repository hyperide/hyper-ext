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
  /**
   * HYP-991 — the element whose source the last visual edit left with a NEW language-server error,
   * or null. When set and NOT already covered by a selection rect, an independent `error`-type rect
   * is emitted for it, so the red error outline + badge persists on the errored element even after
   * the user selects/hovers a different element (the highlight is decoupled from selection/hover).
   */
  errorElementId?: string | null;
}

export interface OverlayComputeResult {
  overlayRects: OverlayRect[];
  placeholderRects: PlaceholderRect[];
}

/**
 * Compute the bounding rect for a display:contents element, which itself has no own box.
 * Returns the union of direct children rects (the visual area the element "occupies").
 */
function contentsElementRect(el: Element): { left: number; top: number; width: number; height: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.left < left) left = r.left;
    if (r.top < top) top = r.top;
    if (r.right > right) right = r.right;
    if (r.bottom > bottom) bottom = r.bottom;
  }
  if (!isFinite(left)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Get the effective bounding rect for an element.
 * For display:contents elements, falls back to the union rect of direct children.
 */
function effectiveRect(el: Element): { left: number; top: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && getComputedStyle(el).display === 'contents') {
    return contentsElementRect(el) ?? rect;
  }
  return rect;
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
        const rect = effectiveRect(hoverElements[0]);
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

  // Track the exact DOM elements that got a selection rect, so the error rect below dedups
  // per-element rather than per-source-id. Per-id dedup is wrong in two cases the reviewer flagged:
  // a STALE selected id resolves to zero elements (no selection rect, yet per-id dedup would still
  // suppress the error rect → no highlight at all), and a REPEATED id with a selectedItemIndex gets
  // a selection rect for only ONE instance (per-id dedup would drop the error highlight on the other
  // live instances). Comparing resolved elements handles both, and also the monorepo case: an
  // errored element that is selected resolves to the same DOM node under either id namespace.
  const selectedElements = new Set<Element>();

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
      selectedElements.add(elements[i]);
      const rect = effectiveRect(elements[i]);
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

  // HYP-991 — independent error rect: keep the post-edit-errored element highlighted even when it
  // is neither selected nor hovered. Any instance that already got a selection rect is skipped
  // (applyOverlayErrorState flags that selection overlay directly via the tolerant dataset match),
  // so we only draw a dedicated borderless `error` rect for the still-uncovered live instances.
  // NOTE (tracked follow-up): resolver.findElements is an exact-id lookup, so in a MONOREPO a
  // repo-relative diagnostic id does not resolve against the sub-project-relative DOM ids and no
  // error rect is drawn for an UNSELECTED errored element. Single-project previews (the common
  // case) are unaffected, and the selected-element highlight still works in monorepos via the
  // tolerant apply-time match. Cross-namespace exact-location resolution is deferred to the
  // anchoring-accuracy follow-up.
  if (state.errorElementId) {
    const errorElements = resolver.findElements(state.errorElementId, null);
    let emitted = 0;
    for (const errorElement of errorElements) {
      if (selectedElements.has(errorElement)) continue;
      const rect = effectiveRect(errorElement);
      overlayRects.push({
        key: `error-${state.errorElementId}-${emitted}`,
        elementId: state.errorElementId,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        type: 'error',
      });
      emitted++;
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
