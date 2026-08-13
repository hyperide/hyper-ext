import { describe, expect, it } from 'bun:test';
import { computeResizeStyles, snapToGrid } from './resize-utils';

describe('computeResizeStyles', () => {
  it('returns null when width delta is below threshold (< 2px)', () => {
    expect(computeResizeStyles('width', 48, 48, 1, 0)).toBeNull();
    expect(computeResizeStyles('width', 48, 48, -1, 0)).toBeNull();
    expect(computeResizeStyles('width', 48, 48, 0, 48)).toBeNull();
  });

  it('returns null when height delta is below threshold (< 2px)', () => {
    expect(computeResizeStyles('height', 48, 48, 0, 1)).toBeNull();
    expect(computeResizeStyles('height', 48, 48, 0, -1)).toBeNull();
    expect(computeResizeStyles('height', 48, 48, 48, 0)).toBeNull();
  });

  it('computes new width from baseW + dX', () => {
    // w-12 (48px) + 48px drag = 96px → w-24
    expect(computeResizeStyles('width', 48, 48, 48, 0)).toEqual({ width: '96px' });
  });

  it('computes new height from baseH + dY', () => {
    // h-12 (48px) + 48px drag = 96px → h-24
    expect(computeResizeStyles('height', 48, 48, 0, 48)).toEqual({ height: '96px' });
  });

  it('rounds to nearest pixel', () => {
    expect(computeResizeStyles('width', 48, 48, 10.7, 0)).toEqual({ width: '59px' });
  });

  it('enforces minimum size of 1px to prevent zero/negative dimensions', () => {
    expect(computeResizeStyles('width', 48, 48, -100, 0)).toEqual({ width: '1px' });
    expect(computeResizeStyles('height', 48, 48, 0, -100)).toEqual({ height: '1px' });
  });

  it('handles negative delta (shrink)', () => {
    // drag left 20px on a 48px element → 28px
    expect(computeResizeStyles('width', 48, 48, -20, 0)).toEqual({ width: '28px' });
  });

  it('width axis ignores dY', () => {
    expect(computeResizeStyles('width', 48, 48, 10, 999)).toEqual({ width: '58px' });
  });

  it('height axis ignores dX', () => {
    expect(computeResizeStyles('height', 48, 48, 999, 10)).toEqual({ height: '58px' });
  });

  describe('snap-to-grid (opt-in)', () => {
    it('does not snap by default (1px rounding preserved)', () => {
      // 48 + 10.7 = 58.7 → round → 59 (not snapped to 60)
      expect(computeResizeStyles('width', 48, 48, 10.7, 0)).toEqual({ width: '59px' });
    });

    it('snaps width to 4px grid when snap is enabled', () => {
      // 48 + 10.7 = 58.7 → nearest 4px = 60
      expect(computeResizeStyles('width', 48, 48, 10.7, 0, { snap: true })).toEqual({ width: '60px' });
    });

    it('snaps height to 4px grid when snap is enabled', () => {
      // 48 + 14 = 62 → nearest 4px = 64
      expect(computeResizeStyles('height', 48, 48, 0, 14, { snap: true })).toEqual({ height: '64px' });
    });

    it('respects a custom gridSize', () => {
      // 48 + 10 = 58 → nearest 8px = 56
      expect(computeResizeStyles('width', 48, 48, 10, 0, { snap: true, gridSize: 8 })).toEqual({ width: '56px' });
    });

    it('still enforces minimum 1px when snapping would round to 0', () => {
      // 4 - 3 = 1 → nearest 4px = 0 → clamped to 1
      expect(computeResizeStyles('width', 4, 4, -3, 0, { snap: true })).toEqual({ width: '1px' });
    });
  });
});

describe('snapToGrid', () => {
  it('snaps to 4px grid by default', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(2)).toBe(4);
    expect(snapToGrid(5)).toBe(4);
    expect(snapToGrid(6)).toBe(8);
    expect(snapToGrid(100)).toBe(100);
    expect(snapToGrid(102)).toBe(104);
  });

  it('supports a custom grid size', () => {
    expect(snapToGrid(7, 8)).toBe(8);
    expect(snapToGrid(12, 8)).toBe(16);
    expect(snapToGrid(15, 16)).toBe(16);
  });
});
