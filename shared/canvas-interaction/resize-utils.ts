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
  if (axis === 'width') {
    const newW = resizeDimension(baseW, dX, options);
    return newW === null ? null : { width: `${newW}px` };
  }
  const newH = resizeDimension(baseH, dY, options);
  return newH === null ? null : { height: `${newH}px` };
}

/**
 * Core dimension math shared by the commit path (`computeResizeStyles`) and the
 * live-preview path (`computeLiveResizeDims`). Returns null below the write
 * threshold (the drag is too small to warrant a write).
 */
function resizeDimension(base: number, delta: number, options?: ComputeResizeStylesOptions): number | null {
  if (Math.abs(delta) < MIN_DELTA_PX) return null;
  const gridSize = options?.gridSize ?? DEFAULT_SNAP_GRID;
  const rounded = options?.snap ? snapToGrid(base + delta, gridSize) : Math.round(base + delta);
  return Math.max(1, rounded);
}

/**
 * Compute the live (mid-drag) preview dimensions for a resize drag.
 *
 * Used by the webview resize pointermove handler to patch the iframe element
 * while the drag is in flight. Shares `resizeDimension` with the commit path so
 * the preview always shows the exact value `computeResizeStyles` will write —
 * including snap-to-grid — and falls back to the base size below the write
 * threshold (where the commit is a no-op). Without this the element visibly
 * jumps on pointer-up when snapping is enabled (HYP-590).
 */
export function computeLiveResizeDims(
  axis: 'width' | 'height',
  baseW: number,
  baseH: number,
  dX: number,
  dY: number,
  options?: ComputeResizeStylesOptions,
): { width: number; height: number } {
  const live =
    axis === 'width'
      ? (resizeDimension(baseW, dX, options) ?? Math.round(baseW))
      : (resizeDimension(baseH, dY, options) ?? Math.round(baseH));
  return axis === 'width' ? { width: live, height: Math.round(baseH) } : { width: Math.round(baseW), height: live };
}
