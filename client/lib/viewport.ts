/**
 * Viewport coordinate transformation utilities
 * Handles conversion between viewport coordinates and iframe coordinates with zoom & pan
 */

import type { ViewportState } from '@/../../shared/types/canvas';

/**
 * Transform viewport coordinates to iframe coordinates
 * Used when reading mouse position to update iframe element positions
 */
export function viewportToIframe(x: number, y: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: (x - viewport.panX) / viewport.zoom,
    y: (y - viewport.panY) / viewport.zoom,
  };
}

/**
 * Transform iframe coordinates to viewport coordinates
 * Used when rendering overlays on top of iframe elements
 */
export function iframeToViewport(x: number, y: number, viewport: ViewportState): { x: number; y: number } {
  return {
    x: x * viewport.zoom + viewport.panX,
    y: y * viewport.zoom + viewport.panY,
  };
}

export const MIN_ZOOM = 0.05; // 5% — hard floor, prevents zero/negative
export const MAX_ZOOM = 32; // 3200% — beyond any practical use case

/**
 * Clamp zoom level to reasonable bounds
 */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Calculate zoom level to fit content within viewport
 */
export function calculateFitToContentZoom(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 40,
): number {
  const scaleX = (viewportWidth - padding * 2) / contentWidth;
  const scaleY = (viewportHeight - padding * 2) / contentHeight;
  return clampZoom(Math.min(scaleX, scaleY));
}
