/**
 * @file Selection overlay invariant assertions — shared between unit tests and e2e proof code.
 *
 * Accessed via:
 *   - overlay-invariant.test.ts (unit/integration tests, bun:test)
 *   - ext-test-projects/e2e/helpers/assert-selection-overlays.ts (Playwright e2e wrapper)
 *
 * Assumptions:
 *   - The overlay container is a real DOM subtree (happy-dom in unit tests, live DOM in e2e).
 *   - Overlay divs are identified by [data-selection-overlay="true"] as rendered by
 *     overlay-renderer.ts (renderOverlayRects). This attribute is the ONLY authoritative
 *     signal that a selection rect is drawn on the canvas — inspector text and tree
 *     highlights are NOT sufficient proof.
 *   - Each drawn rect must have non-zero width AND non-zero height to count as "visible".
 *   - Element bbox overlap check is optional: only performed when the target element root
 *     is passed. When unavailable (e2e iframe boundary), the non-zero-rect check is sufficient.
 *     The overlap check matches overlay.dataset.elementId against `[data-element-id]` ON THE
 *     TARGET ELEMENTS. Rendered iframe React elements do NOT carry data-element-id (only overlay
 *     divs do), so passing the raw iframe body yields `unmatchedOverlayKeys` (a reported failure),
 *     never a silent pass. Supply a root whose targets are tagged, or omit targetRoot entirely.
 */

/** @public A rect as extracted from a DOM element's inline style. */
export interface OverlayRectDimensions {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Result of the invariant check — structured so callers can format their own error messages. */
export interface SelectionOverlayInvariantResult {
  /** Whether ALL invariants passed. */
  ok: boolean;
  /** Number of [data-selection-overlay] elements found in the container. */
  foundCount: number;
  /** Expected count (the selectedCount argument). */
  expectedCount: number;
  /** Rects extracted from found overlays. */
  rects: OverlayRectDimensions[];
  /** Keys of overlays with zero width or zero height. */
  zeroDimensionKeys: string[];
  /**
   * When a targetRoot is provided, keys of overlays whose rect does NOT overlap
   * the bounding box of the corresponding target element.
   * Empty when targetRoot is not provided.
   */
  nonOverlappingKeys: string[];
  /**
   * When a targetRoot is provided, elementIds of overlays for which NO target element
   * carrying a matching `data-element-id` was found in the root. A non-empty list means
   * the overlap proof could not be evaluated for those overlays (the target subtree does
   * not tag its rendered elements) — it is NOT silently treated as a pass.
   * Empty when targetRoot is not provided.
   */
  unmatchedOverlayKeys: string[];
  /** Human-readable failure summary (empty string when ok === true). */
  failureMessage: string;
}

/**
 * Parse a pixel value string like "42px" → 42. Returns 0 for unparseable input.
 * Only handles integer/float pixel values produced by renderOverlayRects inline styles.
 */
function parsePx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract left/top/width/height from an overlay element's inline style.
 * renderOverlayRects writes these as "${n}px" strings directly.
 */
function extractRect(el: Element): OverlayRectDimensions {
  const s = (el as HTMLElement).style;
  return {
    left: parsePx(s.left),
    top: parsePx(s.top),
    width: parsePx(s.width),
    height: parsePx(s.height),
  };
}

/** True if rect A overlaps rect B (at least 1px overlap on each axis). */
function rectsOverlap(a: OverlayRectDimensions, b: OverlayRectDimensions): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/**
 * Assert the canvas selection overlay invariant on a DOM container.
 *
 * @param container - The element that holds overlay divs (the overlay container div).
 *   In unit tests: the container HTMLDivElement passed to renderOverlayRects.
 *   In e2e: evaluated inside a Playwright frame via assertSelectionOverlaysViaEval.
 * @param expectedSelectedCount - How many selection overlays should be drawn.
 *   Must equal `selectedIds.length` (or the sum of per-id element counts for .map() items).
 * @param targetRoot - Optional DOM root to query target elements for overlap check.
 *   Pass the iframe's document.body when checking that each overlay covers its element.
 *   Omit when the container and targets live in different realms (common in e2e).
 * @returns SelectionOverlayInvariantResult — never throws, structured for flexible assertion.
 */
export function checkSelectionOverlayInvariant(
  container: Element,
  expectedSelectedCount: number,
  targetRoot?: Element | null,
): SelectionOverlayInvariantResult {
  // Accept ALL [data-selection-overlay] elements — renderOverlayRects sets this
  // attribute on both selection and hover divs. Callers must ensure hover state is
  // cleared (move mouse away) before asserting selection-only counts.
  const overlayEls = Array.from(container.querySelectorAll('[data-selection-overlay="true"]'));

  const foundCount = overlayEls.length;
  const rects: OverlayRectDimensions[] = overlayEls.map(extractRect);

  const zeroDimensionKeys: string[] = [];
  for (let i = 0; i < overlayEls.length; i++) {
    const r = rects[i];
    if (r.width <= 0 || r.height <= 0) {
      const key = (overlayEls[i] as HTMLElement).dataset?.key ?? String(i);
      zeroDimensionKeys.push(key);
    }
  }

  const nonOverlappingKeys: string[] = [];
  const unmatchedOverlayKeys: string[] = [];
  if (targetRoot) {
    const targetEls = Array.from(targetRoot.querySelectorAll('[data-element-id]'));
    for (let i = 0; i < overlayEls.length; i++) {
      const overlayEl = overlayEls[i] as HTMLElement;
      const elementId = overlayEl.dataset?.elementId;
      if (!elementId) continue;
      // Find the matching target element. NB: `data-element-id` must be present on the
      // target elements themselves; rendered iframe React elements do NOT carry it (only
      // overlay divs do), so an e2e caller passing the raw iframe body will get every
      // overlay reported as unmatched rather than a silent pass. Synthetic test targets
      // (overlay-invariant.test.ts) set the attribute explicitly to exercise this path.
      const targetEl = targetEls.find((t) => (t as HTMLElement).dataset?.elementId === elementId);
      if (!targetEl) {
        unmatchedOverlayKeys.push(elementId);
        continue;
      }
      const targetRect = targetEl.getBoundingClientRect();
      const overlayRect = rects[i];
      if (
        !rectsOverlap(overlayRect, {
          left: targetRect.left,
          top: targetRect.top,
          width: targetRect.width,
          height: targetRect.height,
        })
      ) {
        nonOverlappingKeys.push(elementId);
      }
    }
  }

  const problems: string[] = [];
  if (foundCount !== expectedSelectedCount) {
    problems.push(
      `Expected ${expectedSelectedCount} selection overlay(s), found ${foundCount}. ` +
        `[data-selection-overlay] count must equal selectedIds count. ` +
        `Inspector text or tree highlights are NOT proof — only drawn canvas rects are.`,
    );
  }
  if (zeroDimensionKeys.length > 0) {
    problems.push(
      `${zeroDimensionKeys.length} overlay(s) have zero width or height: [${zeroDimensionKeys.join(', ')}]. ` +
        `A rect with zero dimensions is invisible and does not count as a drawn overlay.`,
    );
  }
  if (nonOverlappingKeys.length > 0) {
    problems.push(
      `${nonOverlappingKeys.length} overlay(s) do not overlap their target element: [${nonOverlappingKeys.join(', ')}].`,
    );
  }
  if (unmatchedOverlayKeys.length > 0) {
    problems.push(
      `${unmatchedOverlayKeys.length} overlay(s) reference an element id with no matching ` +
        `[data-element-id] target in the provided root: [${unmatchedOverlayKeys.join(', ')}]. ` +
        `The overlap proof could not be evaluated — pass a root whose target elements carry ` +
        `data-element-id, or omit targetRoot to rely on the non-zero-rect check alone.`,
    );
  }

  return {
    ok: problems.length === 0,
    foundCount,
    expectedCount: expectedSelectedCount,
    rects,
    zeroDimensionKeys,
    nonOverlappingKeys,
    unmatchedOverlayKeys,
    failureMessage: problems.join('\n'),
  };
}

/**
 * Assert the invariant and throw if it fails.
 * Convenience wrapper for unit/integration tests that want a hard-fail.
 *
 * @example
 * // Unit test (overlay-invariant.test.ts):
 * assertSelectionOverlayInvariant(container, 2);
 *
 * @example
 * // With target root for overlap check:
 * assertSelectionOverlayInvariant(overlayContainer, 1, iframeDocument.body);
 */
export function assertSelectionOverlayInvariant(
  container: Element,
  expectedSelectedCount: number,
  targetRoot?: Element | null,
): void {
  const result = checkSelectionOverlayInvariant(container, expectedSelectedCount, targetRoot);
  if (!result.ok) {
    throw new Error(
      `Selection overlay invariant FAILED:\n${result.failureMessage}\n` +
        `(found rects: ${JSON.stringify(result.rects)})`,
    );
  }
}

/**
 * Detects whether a "no elements for selected id" miss is recorded in the tracker.
 *
 * The `tracingDebugOnce` mechanism in overlay-rects.ts logs once per key when a
 * selected id resolves to zero DOM elements (the silent-death path that causes
 * "N selected" state with zero canvas frames). This function makes that path
 * ASSERTABLE in tests rather than just a console.debug side effect.
 *
 * Usage in tests: inject a spy on tracingDebugOnce or use the captureOverlayMisses()
 * factory below to intercept calls before running computeOverlayRects.
 *
 * @param missLog - Array collected by captureOverlayMisses() tracker.
 * @param expectedMissIds - IDs that SHOULD have been detected as missing.
 */
export function assertOverlayMissesDetected(missLog: OverlayMissEntry[], expectedMissIds: string[]): void {
  for (const id of expectedMissIds) {
    const found = missLog.some((entry) => entry.nodeRef === id);
    if (!found) {
      throw new Error(
        `Expected overlay miss to be detected for nodeRef "${id}" but it was not logged. ` +
          `Ensure computeOverlayRects was called and the id resolves to 0 elements.`,
      );
    }
  }
}

/** A recorded overlay miss (selected id → zero DOM elements). */
export interface OverlayMissEntry {
  /** The nodeRef that resolved to zero elements. */
  nodeRef: string;
  /** The itemIndex at the time of the miss. */
  itemIndex: number | null;
}

/**
 * Factory: install a capture hook that records every overlay miss emitted by
 * `tracingDebugOnce` in overlay-rects.ts into the returned array.
 *
 * IMPORTANT: The hook captures ALL tracingDebugOnce calls matching the
 * 'overlay-rects: no elements for selected id' message pattern. Install it
 * BEFORE calling computeOverlayRects, then read the array after.
 *
 * Returns the log array and a restore function. Always call restore() in afterEach/finally.
 *
 * @public
 * @example
 * const { missLog, restore } = captureOverlayMisses(tracingDebugOnce);
 * try {
 *   computeOverlayRects({ selectedIds: ['missing-id'], hoveredId: null }, resolver);
 *   assertOverlayMissesDetected(missLog, ['missing-id']);
 * } finally {
 *   restore();
 * }
 */
export function captureOverlayMisses(tracingDebugOnceFn: (key: string, message: string, ...args: unknown[]) => void): {
  missLog: OverlayMissEntry[];
  /** Spy on tracingDebugOnce that appends to missLog. Pass as 3rd arg to computeOverlayRects. */
  spy: typeof tracingDebugOnceFn;
  /** No-op restore (callers that use module-level spying must restore themselves). */
  restore: () => void;
} {
  const missLog: OverlayMissEntry[] = [];

  const spy: typeof tracingDebugOnceFn = (key, message, ...args) => {
    if (message === 'overlay-rects: no elements for selected id') {
      // args[0] = nodeRef, args[1] = 'itemIndex', args[2] = itemIndex value
      const nodeRef = typeof args[0] === 'string' ? args[0] : String(args[0]);
      const itemIndex = args[2] !== undefined ? (args[2] as number | null) : null;
      missLog.push({ nodeRef, itemIndex });
    }
    tracingDebugOnceFn(key, message, ...args);
  };

  return {
    missLog,
    spy,
    restore: () => {
      // Callers using module-level spy replacement must restore via their own mechanism.
      // This is a no-op since we cannot hold the original reference here.
    },
  };
}
