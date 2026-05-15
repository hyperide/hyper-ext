/**
 * Pure resize drag utilities — used by VS Code webview resize drag handler.
 * No DOM, no React — safe to unit-test in isolation.
 */

const MIN_DELTA_PX = 2;

/**
 * Convert a resize drag delta into a CSS style update.
 * Returns null when the drag is too small to warrant a write.
 *
 * @param axis - 'width' or 'height'
 * @param baseW - rendered element width in px at drag start
 * @param baseH - rendered element height in px at drag start
 * @param dX - pointer X delta (positive = rightward)
 * @param dY - pointer Y delta (positive = downward)
 */
export function computeResizeStyles(
  axis: 'width' | 'height',
  baseW: number,
  baseH: number,
  dX: number,
  dY: number,
): Record<string, string> | null {
  if (axis === 'width') {
    if (Math.abs(dX) < MIN_DELTA_PX) return null;
    const newW = Math.max(1, Math.round(baseW + dX));
    return { width: `${newW}px` };
  }
  if (Math.abs(dY) < MIN_DELTA_PX) return null;
  const newH = Math.max(1, Math.round(baseH + dY));
  return { height: `${newH}px` };
}
