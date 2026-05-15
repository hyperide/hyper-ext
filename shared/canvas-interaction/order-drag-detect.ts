/**
 * @file Pure helpers for the iframe-side order-driven drag detection.
 *
 * Accessed via:
 *   - `vscode-extension/.../iframe-interaction.ts` `_dragPointerUp` — replaces the
 *     AST move with a className mutation when the parent has `order-*` siblings.
 *   - `order-drag-detect.test.ts` for the unit tests.
 *
 * Assumptions:
 *   - Tailwind v3 default breakpoints (sm/md/lg/xl/2xl). Project-overridden breakpoints
 *     are a follow-up; for now this matches the common case (incl. bulka hero grid).
 *   - The caller knows the layout orientation (horizontal vs vertical) and resolves
 *     `position` from the source/target geometry — these helpers are DOM-agnostic
 *     so they can be unit-tested without jsdom.
 */

import { applyOrderClassChange, readOrderForBp } from './order-class-utils';

/**
 * Tailwind v3 default breakpoint thresholds in CSS pixels. Sorted ascending so
 * `pickActiveBreakpoint` can iterate from largest to smallest and short-circuit.
 */
export const TAILWIND_BREAKPOINTS: ReadonlyArray<{ readonly name: string; readonly px: number }> = [
  { name: 'sm', px: 640 },
  { name: 'md', px: 768 },
  { name: 'lg', px: 1024 },
  { name: 'xl', px: 1280 },
  { name: '2xl', px: 1536 },
];

const ORDER_TOKEN_RE =
  /^([a-z0-9]+):order-(?:none|first|last|\d+|\[[^\]]+\])$|^order-(?:none|first|last|\d+|\[[^\]]+\])$/;

/**
 * Sibling info needed to compute an order rewrite plan. The caller (iframe-interaction)
 * collects this from the live DOM + source resolver before posting to the webview.
 */
export interface SiblingInfo {
  /** NodeRef (`file:line:col`) for the sibling. Required so the bridge can target the JSX node. */
  readonly elementId: string;
  /** Source file path; passed through to `astOps.updateProps`. */
  readonly filePath: string;
  /** Live className string from the DOM at drag-end. */
  readonly className: string;
  /** Position of the sibling among the parent's source-bearing children (0-based, ascending). */
  readonly domIndex: number;
}

export interface OrderWriteEntry {
  readonly elementId: string;
  readonly filePath: string;
  /** Pre-computed new className, ready to send to `astOps.updateProps`. */
  readonly newClassName: string;
}

export interface OrderWritePlan {
  /** Active Tailwind breakpoint variant being written; `undefined` for base. */
  readonly breakpoint: string | undefined;
  /** Per-sibling className overrides — only siblings whose className actually changed. */
  readonly entries: readonly OrderWriteEntry[];
}

/**
 * Collect every Tailwind breakpoint variant that an `order-*` token uses inside
 * the className. `undefined` represents the base (no prefix) variant.
 *
 * Unknown / project-custom prefixes (e.g. `print:order-2`) are returned by name —
 * `pickActiveBreakpoint` filters to known thresholds so they're effectively ignored
 * but never silently corrupted.
 */
export function findOrderBreakpointsInClassName(className: string | undefined): Array<string | undefined> {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  const result: Array<string | undefined> = [];
  for (const token of tokens) {
    const m = token.match(ORDER_TOKEN_RE);
    if (!m) continue;
    // m[1] = breakpoint when there is one; otherwise m[1] is undefined → base variant.
    result.push(m[1] ?? undefined);
  }
  return result;
}

/**
 * Pick the largest known Tailwind breakpoint that is currently active (viewport >= threshold)
 * AND already used somewhere in `usedBps`. Falls back to `undefined` (base) when no
 * variant matches but base is in use.
 *
 * Returns `null` when neither base nor any active known breakpoint is in `usedBps`,
 * which the caller treats as "this parent isn't really order-driven for us" — fall
 * back to AST move.
 */
export function pickActiveBreakpoint(
  usedBps: ReadonlySet<string | undefined>,
  viewportWidth: number,
): string | undefined | null {
  // Iterate from largest to smallest breakpoint name; the first match wins.
  for (let i = TAILWIND_BREAKPOINTS.length - 1; i >= 0; i--) {
    const bp = TAILWIND_BREAKPOINTS[i];
    if (viewportWidth >= bp.px && usedBps.has(bp.name)) return bp.name;
  }
  if (usedBps.has(undefined)) return undefined;
  return null;
}

/**
 * Given the parent's source-bearing children plus the source/target/position of a drag,
 * return a plan that renumbers `order-*` densely (1..N) at the active breakpoint, OR
 * `null` when:
 *   - no sibling has any `order-*` token (parent isn't order-driven), or
 *   - source / target aren't in the sibling list (drag crossed a boundary), or
 *   - the active breakpoint is unknown / not used by any sibling, or
 *   - the resulting new visual order would be identical to the old (no-op).
 *
 * Caller falls back to the AST move path when this returns null.
 *
 * Dense renumbering (1..N over the new visual order) is preferred over sparse-bump
 * because:
 *   1. It matches the user's mental model — "I dragged X to position 2, X is order-2".
 *   2. It avoids drift across multiple drags that would otherwise produce order-7,
 *      order-15 etc. in source.
 *   3. It writes the minimum diff — siblings whose new value equals their old one
 *      are skipped via `entries` filtering.
 *
 * @param viewportWidth - The iframe's `window.innerWidth`. Used to pick the active
 *   Tailwind variant via `pickActiveBreakpoint`.
 */
export function computeOrderWritePlan(
  siblings: readonly SiblingInfo[],
  sourceElementId: string,
  targetElementId: string,
  position: 'before' | 'after',
  viewportWidth: number,
): OrderWritePlan | null {
  if (siblings.length < 2) return null;

  // 1. Detect order-driven parent: any sibling needs at least one order token.
  const usedBps = new Set<string | undefined>();
  for (const s of siblings) {
    for (const bp of findOrderBreakpointsInClassName(s.className)) usedBps.add(bp);
  }
  if (usedBps.size === 0) return null;

  // 2. Pick the active breakpoint (largest currently-active variant that's in use).
  const activeBp = pickActiveBreakpoint(usedBps, viewportWidth);
  if (activeBp === null) return null;

  // 3. Build the current visual order.
  //    Sort by readOrderForBp(activeBp) ascending; ties / nulls fall back to DOM index.
  //    Note: `Array.prototype.sort` is stable in modern JS, but we're explicit here.
  const visual = [...siblings].sort((a, b) => {
    const oa = readOrderForBp(a.className, activeBp);
    const ob = readOrderForBp(b.className, activeBp);
    if (oa !== null && ob !== null && oa !== ob) return oa - ob;
    if (oa !== null && ob === null) return -1;
    if (oa === null && ob !== null) return 1;
    return a.domIndex - b.domIndex;
  });

  // 4. Apply the move: pull source out, insert before/after target.
  const sourceIdx = visual.findIndex((s) => s.elementId === sourceElementId);
  if (sourceIdx === -1) return null;
  const [src] = visual.splice(sourceIdx, 1);
  const targetIdx = visual.findIndex((s) => s.elementId === targetElementId);
  if (targetIdx === -1) return null;
  visual.splice(position === 'before' ? targetIdx : targetIdx + 1, 0, src);

  // 5. Renumber 1..N at the active breakpoint, capturing per-sibling diffs.
  const entries: OrderWriteEntry[] = [];
  for (let i = 0; i < visual.length; i++) {
    const sibling = visual[i];
    const newOrder = i + 1;
    const newClassName = applyOrderClassChange(sibling.className, newOrder, activeBp);
    if (newClassName !== sibling.className) {
      entries.push({
        elementId: sibling.elementId,
        filePath: sibling.filePath,
        newClassName,
      });
    }
  }

  if (entries.length === 0) return null;
  return { breakpoint: activeBp, entries };
}
