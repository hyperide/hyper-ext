/**
 * @file Computes preview surface metrics so desktop breakpoints remain visible in a narrow VS Code panel.
 *
 * Accessed via: VS Code extension preview panel > component canvas area
 * Assumptions: iframe media queries should use at least a desktop viewport width to avoid hiding `lg` content
 */

export const DESKTOP_PREVIEW_MIN_WIDTH = 1024;
const DEFAULT_PREVIEW_HEIGHT = 800;

export interface PreviewViewportMetrics {
  surfaceWidth: number;
  surfaceHeight: number;
  scale: number;
}

export function getPreviewViewportMetrics(availableWidth: number, availableHeight: number): PreviewViewportMetrics {
  if (availableWidth <= 0 || availableHeight <= 0) {
    return {
      surfaceWidth: DESKTOP_PREVIEW_MIN_WIDTH,
      surfaceHeight: DEFAULT_PREVIEW_HEIGHT,
      scale: 1,
    };
  }

  if (availableWidth >= DESKTOP_PREVIEW_MIN_WIDTH) {
    return {
      surfaceWidth: availableWidth,
      surfaceHeight: availableHeight,
      scale: 1,
    };
  }

  const scale = availableWidth / DESKTOP_PREVIEW_MIN_WIDTH;

  return {
    surfaceWidth: DESKTOP_PREVIEW_MIN_WIDTH,
    surfaceHeight: availableHeight / scale,
    scale,
  };
}
