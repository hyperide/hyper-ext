/**
 * @file Drag source resolution helpers.
 *
 * Accessed via: iframe-interaction.ts _dragPointerDown
 * Assumptions: called in design mode on user-initiated pointerdown events;
 *   DOM element may be decorative (emoji, aria-hidden) with no direct source.
 *
 * Resolves the draggable element and its source location using these strategies:
 * 1.  Primary: TracingResolver.getSourceLocation on the target (source-map-aware,
 *     may be cold). Skipped for decorative (aria-hidden) elements.
 * 2a. Decorative only: source-map-aware getSourceLocation on the PARENT element.
 *     Must precede the raw fiber read — see the inline comment for why (React 19 +
 *     Vite dev returns an un-sourcemapped transformed-module line otherwise).
 * 2b. Fallback: direct _debugSource read via findNearestSourceLocation (React 18
 *     Babel / Vite; _debugSource is already a real source position there).
 * 3.  Last resort: walk up to the nearest ancestor with a source (aria-hidden
 *     wrappers, expression-only text nodes that slipped past the steps above).
 *
 * IMPORTANT: we DO NOT walk further up "to a meaningful draggable / outer card".
 * Doing so makes drag-handle behaviour confusing — when the user drags an inner
 * <div>{t('...')}</div> they expect that div to move, not its outer card.
 * AstService.moveElement handles arbitrary source/target combinations (same
 * parent, cross-parent, cross-file, cross-component); the resolver's job is to
 * faithfully report the dragged element, not silently override it.
 */

import { findNearestSourceLocation, getFiberFromDOM } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';
import { resolveCallSiteSource } from './resolve-source';

export interface DragSourceResult {
  /** Source location used to identify the dragged element in reorder messages. */
  source: SourceLocation;
  /** The DOM element that should visually move (may be an ancestor of the click target). */
  el: HTMLElement;
}

/**
 * Resolve the drag source for a pointerdown event target.
 *
 * @param target - The element directly under the pointer.
 * @param getSourceLocation - Resolver function (source-map-aware, may return null if cold).
 * @param renderedComponentPath - Currently rendered component path for call-site resolution.
 * @param getMappedSourceLocation - Optional provenance-safe resolver: returns a source
 *   ONLY from a real source-map hit or a React 18 `_debugSource`, never a raw React 19
 *   `_debugStack` (Vite-transformed) line. The decorative path uses it so a cold source
 *   map fails safe (null → no garbage write) instead of committing the transformed line.
 *   When omitted (e.g. a caller without it), the decorative path falls back to the legacy
 *   getSourceLocation + raw fiber read.
 * @returns The resolved drag source and element, or null if the element is not draggable.
 */
export function resolveDragSource(
  target: HTMLElement,
  getSourceLocation: (el: HTMLElement) => SourceLocation | null,
  renderedComponentPath: string | null,
  getMappedSourceLocation?: (el: HTMLElement) => SourceLocation | null,
): DragSourceResult | null {
  // Defense-in-depth: a pointerdown can land on a non-Element node (e.g. a Text node,
  // nodeType 3, when the pointer is over visible text). Such nodes have no getAttribute
  // and would throw on the aria-hidden read below. Callers should coerce up to an
  // HTMLElement first, but guard here too since this resolver is shared with the SaaS
  // interaction path. We check getAttribute directly rather than `instanceof HTMLElement`
  // so the guard fires on any element-less node (e.g. a cross-realm/iframe element) and
  // protects exactly the call that crashed.
  if (typeof target?.getAttribute !== 'function') return null;

  // Decorative elements (aria-hidden="true") should never be the drag target themselves —
  // they carry no meaningful structure and their source points to a sub-element that users
  // cannot meaningfully reorder on its own. Always delegate to the nearest ancestor.
  const isDecorative = target.getAttribute('aria-hidden') === 'true';

  // Step 1: try source-map-aware resolution on the target itself (skip for decorative elements).
  let source = isDecorative ? null : getSourceLocation(target);
  let el: HTMLElement = target;

  // Step 2a: for a decorative element, resolve via the PROVENANCE-SAFE resolver on
  // its parent element.
  //
  // Why a provenance-safe resolver and not plain getSourceLocation: under React 19 +
  // Vite dev, a host fiber carries no `_debugSource`; its source lives in `_debugStack`,
  // whose top user frame points into the *Vite-transformed* module (e.g.
  // `TestElements.tsx:443:31`), NOT the on-disk file (here only ~300 lines). When the
  // client source map is COLD, getSourceLocation falls back to that raw transformed line
  // — so the AST lookup lands past EOF and `moveElement` reports "source not found" → no
  // write (the decorative-emoji drag bug, HYP-49 / DR-NN-1 / DR-16). getMappedSourceLocation
  // returns a location ONLY from a real source-map hit or a React 18 `_debugSource`, never
  // the raw `_debugStack`; on a cold map it returns null and we fail safe (no garbage write)
  // rather than committing the transformed line. Non-decorative elements resolve via Step 1,
  // so this only changes the decorative case. Falls back to plain getSourceLocation when the
  // caller did not supply a mapped resolver.
  if (!source && isDecorative && target.parentElement !== null) {
    const resolveParent = getMappedSourceLocation ?? getSourceLocation;
    // Walk up past any aria-hidden ancestors — they are decorative too and must not
    // become the drag source (a nested aria-hidden wrapper's source ref is just as
    // meaningless as the target's). Stop at the first non-aria-hidden ancestor. (DR-16)
    let parentCur: HTMLElement | null = target.parentElement;
    while (
      parentCur !== null &&
      typeof parentCur.getAttribute === 'function' &&
      parentCur.getAttribute('aria-hidden') === 'true'
    ) {
      parentCur = parentCur.parentElement;
    }
    if (parentCur !== null) {
      const parentSource = resolveParent(parentCur);
      if (parentSource) {
        source = parentSource;
        el = parentCur;
      }
    }
  }

  // Step 2b: fallback to direct _debugSource read (React 18 Babel / Vite) when
  // source maps are cold or unavailable. This works for projects compiled with the
  // React Babel plugin (React 18: `_debugSource` is already a real source position;
  // no source map needed). Must run BEFORE the ancestor walk-up (step 3), otherwise
  // non-decorative elements like <img> incorrectly resolve to their parent's source.
  //
  // SKIP for decorative elements when a mapped resolver is available: that path already
  // covered React 18 `_debugSource` via getMappedSourceLocation, and the only thing
  // findNearestSourceLocation could add for a decorative parent is the raw React 19
  // `_debugStack` (transformed) line — the very garbage Step 2a exists to avoid. Letting
  // it run would re-introduce the cold-cache bug, so for decorative we hold out for a
  // mapped hit (or fail safe).
  const skipRawForDecorative = isDecorative && getMappedSourceLocation !== undefined;
  if (!source && !skipRawForDecorative) {
    // For decorative elements, skip when parentElement is null — passing the
    // decorative element itself to getFiberFromDOM would violate the invariant
    // that decorative elements are never the drag target.
    // Also skip any aria-hidden parents — same invariant: a nested decorative
    // wrapper's fiber source is as meaningless as the target's own. (DR-16)
    let fiberTarget: HTMLElement | null;
    if (isDecorative) {
      fiberTarget = target.parentElement;
      while (
        fiberTarget !== null &&
        typeof fiberTarget.getAttribute === 'function' &&
        fiberTarget.getAttribute('aria-hidden') === 'true'
      ) {
        fiberTarget = fiberTarget.parentElement;
      }
    } else {
      fiberTarget = target;
    }
    if (fiberTarget !== null) {
      const fiber = getFiberFromDOM(fiberTarget);
      const directLoc = findNearestSourceLocation(fiber);
      if (directLoc) {
        source = resolveCallSiteSource(directLoc, fiber, renderedComponentPath);
        el = fiberTarget;
      }
    }
  }

  // Step 3: walk up to the nearest ancestor with a source — last resort for
  // elements with no fiber source (aria-hidden wrappers, expression-only text nodes
  // that slipped past steps 1 and 2). For decorative elements use the provenance-safe
  // resolver too, so the ancestor walk cannot resurrect the raw React 19 `_debugStack`
  // line that Steps 2a/2b held out against (HYP-49); for non-decorative the legacy
  // getSourceLocation is preserved.
  if (!source) {
    const resolveAncestor = isDecorative ? (getMappedSourceLocation ?? getSourceLocation) : getSourceLocation;
    const bodyEl = typeof document !== 'undefined' ? document.body : null;
    let cur = target.parentElement;
    while (cur && cur !== bodyEl) {
      // Skip aria-hidden ancestors — they are decorative wrappers whose source
      // positions are as meaningless as the original target's. Walk past them to
      // reach the nearest real (non-decorative) ancestor. (DR-16)
      // Guard getAttribute: plain-object body sentinels used in tests may not have
      // this method; the `cur !== bodyEl` condition above stops at real document.body,
      // but mock subtrees can produce body-like objects without DOM methods.
      if (typeof cur.getAttribute === 'function' && cur.getAttribute('aria-hidden') === 'true') {
        cur = cur.parentElement;
        continue;
      }
      const ancestorSrc = resolveAncestor(cur);
      if (ancestorSrc) {
        source = ancestorSrc;
        el = cur;
        break;
      }
      cur = cur.parentElement;
    }
  }

  if (!source) return null;

  return { source, el };
}
