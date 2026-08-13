import { describe, expect, it } from 'bun:test';
import type { SpacingGuide } from './spacing-guides';
import { calculateSpacingGuides } from './spacing-guides';

/**
 * Tests for spacing guide calculation — pink lines with pixel values
 * between the active element and its siblings (Figma-like spacing indicators).
 */

/** Find a guide by direction, throwing if not found. */
function findGuide(guides: SpacingGuide[], direction: 'horizontal' | 'vertical'): SpacingGuide {
  const guide = guides.find((g) => g.direction === direction);
  if (!guide) throw new Error(`No ${direction} guide found in: ${JSON.stringify(guides)}`);
  return guide;
}

describe('calculateSpacingGuides', () => {
  it('calculates horizontal gap between sibling to the left', () => {
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    expect(guides).toContainEqual(
      expect.objectContaining({
        direction: 'horizontal',
        distance: 50,
      }),
    );
  });

  it('calculates horizontal gap between sibling to the right', () => {
    const active = { left: 0, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 100, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    expect(guides).toContainEqual(
      expect.objectContaining({
        direction: 'horizontal',
        distance: 50,
      }),
    );
  });

  it('calculates vertical gap between sibling above', () => {
    const active = { left: 0, top: 100, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    expect(guides).toContainEqual(
      expect.objectContaining({
        direction: 'vertical',
        distance: 50,
      }),
    );
  });

  it('calculates vertical gap between sibling below', () => {
    const active = { left: 0, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 100, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    expect(guides).toContainEqual(
      expect.objectContaining({
        direction: 'vertical',
        distance: 50,
      }),
    );
  });

  it('ignores overlapping elements (negative gap)', () => {
    const active = { left: 10, top: 10, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    expect(guides.filter((g) => g.distance < 0)).toHaveLength(0);
  });

  it('returns empty for no siblings', () => {
    const active = { left: 0, top: 0, width: 50, height: 50 };
    expect(calculateSpacingGuides(active, [])).toEqual([]);
  });

  it('only measures horizontal gaps for vertically aligned elements', () => {
    // Sibling is far below — no vertical overlap → no horizontal guide
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 200, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const horizontalGuides = guides.filter((g) => g.direction === 'horizontal');
    expect(horizontalGuides).toHaveLength(0);
  });

  it('only measures vertical gaps for horizontally aligned elements', () => {
    // Sibling is far to the right — no horizontal overlap → no vertical guide
    const active = { left: 0, top: 100, width: 50, height: 50 };
    const siblings = [{ left: 200, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const verticalGuides = guides.filter((g) => g.direction === 'vertical');
    expect(verticalGuides).toHaveLength(0);
  });

  it('includes line position for rendering', () => {
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const hGuide = findGuide(guides, 'horizontal');
    expect(hGuide.line).toBeDefined();
    expect(hGuide.line.x1).toBeDefined();
    expect(hGuide.line.y1).toBeDefined();
    expect(hGuide.line.x2).toBeDefined();
    expect(hGuide.line.y2).toBeDefined();
  });

  it('horizontal guide line spans the gap between elements', () => {
    // sibling: left=0 w=50 → right edge at 50
    // active: left=100 w=50 → left edge at 100
    // gap = 50..100
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const hGuide = findGuide(guides, 'horizontal');
    expect(hGuide.line.x1).toBe(50);
    expect(hGuide.line.x2).toBe(100);
    // y should be at midpoint of vertical overlap (both are 0..50, mid = 25)
    expect(hGuide.line.y1).toBe(25);
    expect(hGuide.line.y2).toBe(25);
  });

  it('vertical guide line spans the gap between elements', () => {
    // sibling: top=0 h=50 → bottom edge at 50
    // active: top=100 h=50 → top edge at 100
    // gap = 50..100
    const active = { left: 0, top: 100, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const vGuide = findGuide(guides, 'vertical');
    expect(vGuide.line.y1).toBe(50);
    expect(vGuide.line.y2).toBe(100);
    // x should be at midpoint of horizontal overlap (both are 0..50, mid = 25)
    expect(vGuide.line.x1).toBe(25);
    expect(vGuide.line.x2).toBe(25);
  });

  it('includes label position at midpoint of the guide line', () => {
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    const hGuide = findGuide(guides, 'horizontal');
    // Midpoint of line x1=50, x2=100 → 75
    expect(hGuide.labelPosition.x).toBe(75);
    expect(hGuide.labelPosition.y).toBe(25);
  });

  it('handles multiple siblings producing multiple guides', () => {
    const active = { left: 100, top: 100, width: 50, height: 50 };
    const siblings = [
      { left: 0, top: 100, width: 50, height: 50 }, // left neighbor, vertically aligned
      { left: 200, top: 100, width: 50, height: 50 }, // right neighbor, vertically aligned
      { left: 100, top: 0, width: 50, height: 50 }, // top neighbor, horizontally aligned
    ];
    const guides = calculateSpacingGuides(active, siblings);
    const hGuides = guides.filter((g) => g.direction === 'horizontal');
    const vGuides = guides.filter((g) => g.direction === 'vertical');
    expect(hGuides).toHaveLength(2);
    expect(vGuides).toHaveLength(1);
  });

  it('handles touching elements (zero gap) without producing guides', () => {
    const active = { left: 50, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];
    const guides = calculateSpacingGuides(active, siblings);
    // Zero-pixel gap is not useful as a spacing guide
    expect(guides.filter((g) => g.distance === 0)).toHaveLength(0);
  });

  it('produces no guides for diagonal neighbor with overlap on both axes', () => {
    // Active: 100,100 size 50x50 → right=150, bottom=150
    // Sibling: 0,0 size 120x120 → right=120, bottom=120
    // Horizontal: sibling right edge (120) vs active left (100) → overlap, no horizontal gap
    // Vertical: sibling bottom edge (120) vs active top (100) → overlap, no vertical gap
    const active = { left: 100, top: 100, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 120, height: 120 }];
    const guides = calculateSpacingGuides(active, siblings);
    // Both axes overlap → no positive gaps
    expect(guides).toHaveLength(0);
  });
});
