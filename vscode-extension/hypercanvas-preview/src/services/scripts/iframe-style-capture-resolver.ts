/**
 * Resolves which DOM element a click/selection's RUNTIME STYLE CAPTURE (`extractComputedStyle`,
 * `innerText`) should read from — extracted out of `iframe-interaction.ts` so it is
 * unit-testable without importing that file, which installs a
 * `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` shim and DOM listeners at import time (same rationale
 * as `iframe-pending-click-retry.ts`'s own extraction).
 *
 * HYP-1420 Codex P2 (PR #773): a click on a nested host inside a `node_modules` primitive
 * (e.g. an icon inside a Radix `asChild`/Slot shadcn `Button`) resolves the click's `ref` to the
 * collapsed call site (the Button's), but the DOM element the click event actually fired on is
 * still the icon. Two call sites in `iframe-interaction.ts` captured `extractComputedStyle` off
 * that raw clicked element instead of resolving back through `findElementsByRef` — the SAME
 * outermost DOM host the resize handle and selection overlay key off
 * (`overlay-renderer.ts`'s `syncResizeHandles`, `useCanvasInteraction.ts`'s resize pointer
 * handler both resolve through `[data-selection-overlay]` / `findElementsByRef`, never a raw
 * click target). That divergence reported the icon's own size/resizable-axis verdict in the
 * Layout panel instead of the visibly-selected Button's — the exact bug class HYP-1420's
 * `hcResizableWidth`/`hcResizableHeight` fix exists to close, just reached via a different click
 * path.
 */

/** Matches `findElementsByRef`'s signature in `iframe-interaction.ts` (dependency-injected here). */
export type FindElementsByRef = (ref: string, itemIndex: number | null) => HTMLElement[];

/**
 * Resolve the element whose runtime style should be captured for `ref`/`itemIndex`.
 * Falls back to `fallback` (the raw clicked/pending element) when `ref` is null, the index
 * can't resolve it yet (e.g. still cold), or — critically — when the index DID return
 * something but it lives in a DISJOINT part of the DOM tree from the element actually clicked.
 *
 * `findElementsByRef` itself is approximate by design (same-line fallback, cross-path-format
 * rescue, `.map()`-item indexing) — good for callers with no better signal, but exactly this
 * approximateness can substitute an unrelated element for `ref`/`itemIndex`: a same-basename
 * match from a genuinely DIFFERENT file, or the wrong `.map()`-repeated instance for a
 * miscounted `itemIndex` (both raised on PR #773's Codex review rounds). Those wrong-answer
 * shapes share a structural property this caller can cheaply verify and the others can't:
 * `fallback` is provably the DOM element the click/pending-resolution actually fired on, and an
 * element from a genuinely different file/component's subtree can never structurally contain
 * it. Requiring containment turns those wrong-answer paths into the same safe fallback, without
 * needing to reason about which specific approximate-match tier produced the bad candidate.
 *
 * This is NOT a precision guarantee for every approximate match — a same-line fallback that
 * lands on a containing ANCESTOR (e.g. a wrapper `<div>` instead of the `<button>` inside it)
 * passes `.contains()` trivially and is accepted as-is. That's deliberate, not a residual gap:
 * `findElementsByRef` is the SAME lookup the resize handle / selection overlay resolve through
 * (`iframeElementResolver.findElements` → `computeOverlayRects`), so whichever element that
 * fallback tier picks, the handle draws around that SAME element — style capture and the handle
 * stay in agreement, which is this PR's actual invariant. A stricter lookup used ONLY for style
 * capture would defeat that by describing a different element than the handle draws around, in
 * exactly this skew scenario.
 */
export function resolveStyleCaptureElement(
  ref: string | null,
  itemIndex: number | null,
  fallback: HTMLElement,
  findElementsByRef: FindElementsByRef,
): HTMLElement {
  if (!ref) return fallback;
  const candidate = findElementsByRef(ref, itemIndex)[0];
  if (!candidate) return fallback;
  // `Node.contains` includes self, so a divergence-free resolution (candidate === fallback)
  // passes trivially — this only rejects a candidate that is a genuinely DIFFERENT element
  // that doesn't structurally contain the one actually clicked.
  return candidate.contains(fallback) ? candidate : fallback;
}
