/**
 * Pure resize drag utilities — used by VS Code webview resize drag handler.
 * No DOM, no React — safe to unit-test in isolation.
 */

const MIN_DELTA_PX = 2;

/** Default grid step (px) for snap-to-grid sizing. */
const DEFAULT_SNAP_GRID = 4;

/**
 * Snap a value to the nearest multiple of `gridSize` (default 4px) for clean
 * sizing values. Salvaged from the Phase 1 visual-foundation resize work
 * (HYP-405). Exposed as opt-in for `computeResizeStyles` — callers that want
 * Figma-style 4px stepping pass `{ snap: true }`; default behavior (1px round)
 * is unchanged so existing consumers (VS Code webview) are not affected.
 */
export function snapToGrid(value: number, gridSize: number = DEFAULT_SNAP_GRID): number {
  return Math.round(value / gridSize) * gridSize;
}

interface ComputeResizeStylesOptions {
  /** When true, snap the resulting dimension to a grid (default step 4px). */
  snap?: boolean;
  /** Grid step in px when `snap` is enabled. Defaults to {@link DEFAULT_SNAP_GRID}. */
  gridSize?: number;
}

/**
 * Convert a resize drag delta into a CSS style update.
 * Returns null when the drag is too small to warrant a write.
 *
 * @param axis - 'width' or 'height'
 * @param baseW - rendered element width in px at drag start
 * @param baseH - rendered element height in px at drag start
 * @param dX - pointer X delta (positive = rightward)
 * @param dY - pointer Y delta (positive = downward)
 * @param options - optional snap-to-grid behavior (default: off, 1px rounding)
 */
export function computeResizeStyles(
  axis: 'width' | 'height',
  baseW: number,
  baseH: number,
  dX: number,
  dY: number,
  options?: ComputeResizeStylesOptions,
): Record<string, string> | null {
  const gridSize = options?.gridSize ?? DEFAULT_SNAP_GRID;
  const round = (v: number): number => (options?.snap ? snapToGrid(v, gridSize) : Math.round(v));

  if (axis === 'width') {
    if (Math.abs(dX) < MIN_DELTA_PX) return null;
    const newW = Math.max(1, round(baseW + dX));
    return { width: `${newW}px` };
  }
  if (Math.abs(dY) < MIN_DELTA_PX) return null;
  const newH = Math.max(1, round(baseH + dY));
  return { height: `${newH}px` };
}
