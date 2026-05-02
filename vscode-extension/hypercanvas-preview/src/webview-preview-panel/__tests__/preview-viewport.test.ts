/**
 * @file Regression tests for preview viewport sizing in the VS Code preview panel.
 */

import { describe, expect, it } from 'bun:test';
import { DESKTOP_PREVIEW_MIN_WIDTH, getPreviewViewportMetrics } from '../preview-viewport';

describe('getPreviewViewportMetrics', () => {
  it('keeps a desktop-width surface in narrow panels', () => {
    const metrics = getPreviewViewportMetrics(480, 720);

    expect(metrics.surfaceWidth).toBe(DESKTOP_PREVIEW_MIN_WIDTH);
    expect(metrics.scale).toBeCloseTo(480 / DESKTOP_PREVIEW_MIN_WIDTH, 5);
    expect(metrics.surfaceHeight).toBeCloseTo(720 / metrics.scale, 5);
  });

  it('uses the available panel size when width is already desktop-sized', () => {
    const metrics = getPreviewViewportMetrics(1280, 900);

    expect(metrics.surfaceWidth).toBe(1280);
    expect(metrics.surfaceHeight).toBe(900);
    expect(metrics.scale).toBe(1);
  });

  it('falls back to stable defaults before the panel is measured', () => {
    const metrics = getPreviewViewportMetrics(0, 0);

    expect(metrics.surfaceWidth).toBe(DESKTOP_PREVIEW_MIN_WIDTH);
    expect(metrics.surfaceHeight).toBe(800);
    expect(metrics.scale).toBe(1);
  });
});
