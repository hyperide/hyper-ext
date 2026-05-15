/**
 * @file Drop-indicator orientation inference for drag-and-drop reorder.
 *
 * Accessed via: iframe-interaction.ts (`_dragPointerMove`, `_dragPointerUp`).
 * Assumptions: called only with source-bearing drop elements; runs in iframe
 *   DOM context where `getComputedStyle` is available.
 *
 * Replaces the old `_isHorizontalLayout(dropEl.parentElement)` check, which
 * had two bugs:
 *
 *   1. `display: grid` with `grid-cols-2` (Tailwind) computed
 *      `grid-auto-flow: row`. The old check `gridAutoFlow.includes('column')`
 *      returned false → the drop indicator went vertical even though the
 *      cards visually flow left-to-right inside a 2-column grid. Bulka's
 *      `Index.tsx:272` (`<div className="grid grid-cols-2 gap-3 sm:gap-4">`)
 *      tripped this for every nested span/p drop.
 *
 *   2. The check looked at `dropEl.parentElement` only. When the immediate
 *      parent was a transparent wrapper `<div>` (no display set, default
 *      block), the actual sibling-level flex/grid container was a
 *      grandparent — the inference returned false → vertical fallback even
 *      for clearly horizontal layouts.
 *
 * `chooseIndicatorOrientation` walks up the parent chain until it finds the
 * nearest flex/grid container, then derives orientation from that
 * container's resolved styles. Wrapper divs with no flex/grid `display` are
 * skipped, and grids with multiple column tracks are treated as horizontal
 * layouts even when `grid-auto-flow` is the default `row`.
 */

export type LayoutOrientation = 'horizontal' | 'vertical';

export interface OrientationDeps {
  /**
   * Provider for computed styles. Tests inject a mock that maps elements →
   * fake CSSStyleDeclaration objects; production callers omit this so the
   * function defaults to the global `getComputedStyle`.
   */
  getComputedStyle: (el: HTMLElement) => CSSStyleDeclaration;
}

/**
 * Walk `el`'s parent chain until the nearest flex or grid container, then
 * decide whether siblings are laid out horizontally or vertically inside it.
 *
 * Defaults to `'vertical'` when no flex/grid ancestor exists — matches the
 * old fallback behaviour for plain block-stacked elements.
 */
export function chooseIndicatorOrientation(el: HTMLElement, deps?: OrientationDeps): LayoutOrientation {
  const getStyle: (e: HTMLElement) => CSSStyleDeclaration =
    deps?.getComputedStyle ?? ((e) => globalThis.getComputedStyle(e));
  let cur: HTMLElement | null = el.parentElement;
  // Walk the parent chain. Includes <body> (apps may set flex/grid on body
  // directly, e.g. `<body class="flex flex-row">`). Stops at <html> root.
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  while (cur && cur !== root) {
    const s = getStyle(cur);
    const display = s.display;
    if (display === 'flex' || display === 'inline-flex') {
      const fd = s.flexDirection;
      return fd === 'row' || fd === 'row-reverse' ? 'horizontal' : 'vertical';
    }
    if (display === 'grid' || display === 'inline-grid') {
      const flow = s.gridAutoFlow ?? '';
      // `grid-auto-flow: column*` lays items top-to-bottom then wraps right —
      // visually that produces columns, so siblings on the same auto-flow row
      // are horizontal neighbours.
      if (flow.includes('column')) return 'horizontal';
      // Default `grid-auto-flow: row` with multiple column tracks
      // (e.g. Tailwind's `grid-cols-2`) flows left-to-right inside each row.
      // Single-column grids fall through to vertical.
      return countGridTracks(s.gridTemplateColumns) > 1 ? 'horizontal' : 'vertical';
    }
    cur = cur.parentElement;
  }
  return 'vertical';
}

export function isHorizontalLayout(el: HTMLElement, deps?: OrientationDeps): boolean {
  return chooseIndicatorOrientation(el, deps) === 'horizontal';
}

/**
 * Count the number of explicit column tracks in a computed
 * `grid-template-columns` value. Browsers serialise the resolved value as
 * whitespace-separated track sizes (e.g. `"100px 100px"`,
 * `"minmax(0, 1fr) minmax(0, 1fr)"`). Named grid lines are emitted as
 * bracketed tokens (e.g. `"[content-start] 1fr [content-end]"`) and must
 * NOT be counted as tracks — without bracket-stripping a single-track grid
 * with line names reads as 3 tracks → drop indicator flips horizontal on a
 * visually vertical column. `none` or empty means the grid only has implicit
 * columns from `grid-auto-columns` and is treated as single-track.
 */
function countGridTracks(value: string | undefined): number {
  if (!value || value === 'none') return 0;
  // Strip named-line brackets first. CSS computed values never nest brackets,
  // so a flat regex is enough.
  const stripped = value.replace(/\[[^\]]*\]/g, ' ').trim();
  if (stripped.length === 0) return 0;
  // Split on whitespace, but respect parens so `minmax(0, 1fr) minmax(0, 1fr)`
  // counts as 2 tracks, not 4. Simple depth counter beats a CSS parser here.
  const tracks: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of stripped) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (current.length > 0) tracks.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tracks.push(current);
  return tracks.length;
}
