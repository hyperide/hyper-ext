/**
 * @file Shared 2D math primitives — distance and normalize
 *
 * Internal module, not exposed
 */

/** Euclidean distance between two points. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

/** Normalize a 2D vector. Returns {x:0, y:0} for near-zero magnitude. */
export function normalize(dx: number, dy: number): { x: number; y: number } {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}
