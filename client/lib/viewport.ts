/**
 * Viewport coordinate transformation utilities
 * Handles conversion between viewport coordinates and iframe coordinates with zoom & pan
 */

const MIN_ZOOM = 0.05; // 5% — hard floor, prevents zero/negative
const MAX_ZOOM = 32; // 3200% — beyond any practical use case

/**
 * Clamp zoom level to reasonable bounds
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
