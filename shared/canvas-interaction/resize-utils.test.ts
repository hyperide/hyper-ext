import { describe, expect, it } from 'bun:test';
import { computeResizeStyles } from './resize-utils';

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
});
