/** Pure geometry for the desktop navigation. Durations are interaction defaults, not benchmarks. */
export const LEAVE_DELAY = 480;
export const EDGE_DWELL = 180;
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export function edgeAt(x: number, width: number): -1 | 0 | 1 {
  const zone = Math.min(76, width * .18);
  return x < zone ? -1 : x > width - zone ? 1 : 0;
}
export function followTarget(x: number, entry: number, baseline: number, width: number, max: number) {
  const dx = x - entry;
  const runway = Math.max(width * .15, dx > 0 ? width - entry - 20 : entry - 20);
  return clamp(baseline + dx / runway * (dx > 0 ? max - baseline : baseline), 0, max);
}
export function lensAt(center: number, width: number, pointer: number | null) {
  const side = center < width / 2 ? -1 : 1;
  const distance = side < 0 ? center : width - center;
  const pointerNear = pointer !== null && (side < 0 ? pointer < 130 : pointer > width - 130);
  const strength = pointerNear ? 0 : clamp(1 - distance / 110, 0, 1);
  return { scale: 1 - .16 * strength, angle: side * 24 * strength, depth: -20 * strength };
}
