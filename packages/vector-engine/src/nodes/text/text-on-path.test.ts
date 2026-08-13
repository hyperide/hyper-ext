import { describe, expect, it } from 'bun:test';
import type { Font, Glyph } from 'opentype.js';
import { PathBuilder } from '../../path/builder';
import { decodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import { registerFont } from './text-to-path';
import { type GlyphOutline, layoutGlyphsOnPath, textOnPathNode } from './text-on-path';

/** A 10x10 unit square glyph (single contour) with a given advance width. */
function squareGlyph(advance: number): GlyphOutline {
  return {
    advance,
    outline: [
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Line, x: 10, y: 10 },
      { type: PathCmd.Line, x: 0, y: 10 },
      { type: PathCmd.Close },
    ],
  };
}

/** A two-contour glyph (like 'O' or 'i') — outer + inner square. */
function twoContourGlyph(advance: number): GlyphOutline {
  return {
    advance,
    outline: [
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Line, x: 10, y: 10 },
      { type: PathCmd.Close },
      { type: PathCmd.Move, x: 3, y: 3 },
      { type: PathCmd.Line, x: 6, y: 3 },
      { type: PathCmd.Line, x: 6, y: 6 },
      { type: PathCmd.Close },
    ],
  };
}

/** Build a horizontal line path from (0,0) to (length,0). */
function horizontalPath(length: number): Float64Array {
  return new PathBuilder().moveTo(0, 0).lineTo(length, 0).build().commands;
}

/** Build a vertical line path from (0,0) to (0,length). */
function verticalPath(length: number): Float64Array {
  return new PathBuilder().moveTo(0, 0).lineTo(0, length).build().commands;
}

/** Split a decoded command list into subpaths (each Move starts a new one). */
function subpaths(cmds: PathCommand[]): PathCommand[][] {
  const groups: PathCommand[][] = [];
  for (const c of cmds) {
    if (c.type === PathCmd.Move) groups.push([]);
    if (groups.length === 0) groups.push([]);
    groups[groups.length - 1].push(c);
  }
  return groups;
}

/** First Move point of each subpath (glyph origin marker). */
function originPoints(cmds: PathCommand[]): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (const c of cmds) {
    if (c.type === PathCmd.Move) pts.push({ x: c.x, y: c.y });
  }
  return pts;
}

describe('layoutGlyphsOnPath (pure layout)', () => {
  it('returns empty path for no glyphs', () => {
    const result = layoutGlyphsOnPath([], horizontalPath(100), {});
    expect(decodeCommands(result.commands).length).toBe(0);
  });

  it('advances glyph origins monotonically along a horizontal path', () => {
    const glyphs = [squareGlyph(20), squareGlyph(20), squareGlyph(20)];
    const result = layoutGlyphsOnPath(glyphs, horizontalPath(200), {});
    const pts = originPoints(decodeCommands(result.commands));

    expect(pts.length).toBe(3);
    // x increases monotonically; y stays ~0 (baseline) on a horizontal path
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    }
    for (const p of pts) {
      expect(Math.abs(p.y)).toBeLessThan(1e-6);
    }
  });

  it('on a horizontal path the glyph outline matches plain (unrotated) translation', () => {
    // A straight horizontal baseline ⇒ identity rotation: each glyph is just
    // translated by its cumulative advance, the shape is preserved.
    const glyphs = [squareGlyph(20), squareGlyph(20)];
    const result = layoutGlyphsOnPath(glyphs, horizontalPath(200), {});
    const groups = subpaths(decodeCommands(result.commands));
    expect(groups.length).toBe(2);

    // First glyph origin should sit at offset 0 (left edge placement).
    const first = groups[0];
    expect(first[0].type).toBe(PathCmd.Move);
    const m0 = first[0] as { x: number; y: number };
    expect(Math.abs(m0.x)).toBeLessThan(1e-6);
    expect(Math.abs(m0.y)).toBeLessThan(1e-6);

    // Second glyph sits at its true cumulative advance (20px), NOT stretched to
    // fill the 200px path. This is the "advance spacing along the curve" property.
    const m1 = groups[1][0] as { x: number; y: number };
    expect(m1.x).toBeCloseTo(20, 6);
    expect(Math.abs(m1.y)).toBeLessThan(1e-6);

    // The square's second vertex (10,0) stays at (10,0): no rotation/skew.
    const l0 = first[1] as { x: number; y: number };
    expect(Math.abs(l0.x - 10)).toBeLessThan(1e-6);
    expect(Math.abs(l0.y - 0)).toBeLessThan(1e-6);
    // Third vertex (10,10) preserved.
    const l1 = first[2] as { x: number; y: number };
    expect(Math.abs(l1.x - 10)).toBeLessThan(1e-6);
    expect(Math.abs(l1.y - 10)).toBeLessThan(1e-6);
  });

  it('rotates glyphs to follow the path tangent (vertical path ⇒ ~90deg)', () => {
    // On a vertical path (tangent points +y), a glyph's local +x axis must map
    // to the path's +y direction. The square vertex local (10,0) should rotate
    // to approximately (0,10) relative to its origin.
    const glyphs = [squareGlyph(20)];
    const result = layoutGlyphsOnPath(glyphs, verticalPath(200), {});
    const cmds = decodeCommands(result.commands);
    const m0 = cmds[0] as { x: number; y: number };
    const l0 = cmds[1] as { x: number; y: number }; // image of local (10,0)

    const dx = l0.x - m0.x;
    const dy = l0.y - m0.y;
    // local +x (1,0) rotated by tangent (0,1) ⇒ (0,1); times 10 ⇒ (0,10)
    expect(Math.abs(dx - 0)).toBeLessThan(1e-6);
    expect(Math.abs(dy - 10)).toBeLessThan(1e-6);
  });

  it('drops glyphs that overflow past the path end (no endpoint pileup)', () => {
    // Path length 30 fits only the first two advance-20 glyphs (at 0 and 20);
    // the third (at 40 > 30) overflows and is dropped, not clamped onto the end.
    const glyphs = [squareGlyph(20), squareGlyph(20), squareGlyph(20)];
    const result = layoutGlyphsOnPath(glyphs, horizontalPath(30), {});
    const pts = originPoints(decodeCommands(result.commands));
    expect(pts.length).toBe(2);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[1].x).toBeCloseTo(20, 6);
  });

  it('preserves all subpaths of multi-contour glyphs (counter holes survive)', () => {
    const glyphs = [twoContourGlyph(20), twoContourGlyph(20)];
    const result = layoutGlyphsOnPath(glyphs, horizontalPath(200), {});
    const groups = subpaths(decodeCommands(result.commands));
    // 2 glyphs × 2 contours each = 4 subpaths
    expect(groups.length).toBe(4);
  });
});

describe('textOnPathNode', () => {
  it('has a correct node definition', () => {
    expect(textOnPathNode.type).toBe('textOnPath');
    expect(textOnPathNode.category).toBe('generator');
    const names = textOnPathNode.params.map((p) => p.name);
    expect(names).toContain('text');
    expect(names).toContain('fontSize');
    expect(names).toContain('fontUrl');
  });

  it('outputs an empty path when no font is loaded', () => {
    const result = textOnPathNode.execute({}, { text: 'Hi', fontSize: 24, fontUrl: '' });
    const pathVal = (result.path as { value: { commands: Float64Array } }).value;
    expect(decodeCommands(pathVal.commands).length).toBe(0);
  });

  it('throws (not silent-empty) when a fontUrl is supplied but the font is not registered', () => {
    // CLI users can only pass a fontUrl string; without a host registerFont() the cache
    // is empty and glyph extraction yields nothing. Surface a clear error instead of a
    // silently-blank path (HYP-513).
    const path = new PathBuilder().moveTo(0, 0).lineTo(200, 0).build();
    expect(() =>
      textOnPathNode.execute(
        { path: { type: 'path', value: path } },
        { text: 'Hi', fontSize: 24, fontUrl: 'mock://unregistered.ttf', letterSpacing: 0, startOffset: 0 },
      ),
    ).toThrow(/HYP-513/);
  });

  it('lays real glyph outlines along the input path (compound path, not annotations)', () => {
    // Mock a font with two distinct glyphs whose outlines/advances are known.
    const glyphPaths: Record<string, { type: string; x?: number; y?: number }[]> = {
      A: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'Z' }],
      B: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 8, y: 0 }, { type: 'Z' }],
    };
    const makeGlyph = (ch: string): Glyph =>
      ({
        advanceWidth: 600,
        getPath: (gx: number, gy: number, _size: number) => ({
          commands: glyphPaths[ch].map((c) =>
            c.type === 'Z' ? { type: 'Z' } : { type: c.type, x: (c.x ?? 0) + gx, y: (c.y ?? 0) + gy },
          ),
        }),
      }) as unknown as Glyph;

    const mockFont = {
      unitsPerEm: 1000,
      stringToGlyphs: (s: string): Glyph[] => s.split('').map(makeGlyph),
    } as unknown as Font;

    registerFont('mock://onpath.ttf', mockFont);

    const path = new PathBuilder().moveTo(0, 0).lineTo(300, 0).build();
    const result = textOnPathNode.execute(
      { path: { type: 'path', value: path } },
      { text: 'AB', fontSize: 48, fontUrl: 'mock://onpath.ttf' },
    );

    const out = (result.path as { value: { commands: Float64Array } }).value;
    const cmds = decodeCommands(out.commands);
    // Two glyphs ⇒ at least two Move-started subpaths, real geometry (not text annotations).
    const moves = cmds.filter((c) => c.type === PathCmd.Move);
    expect(moves.length).toBe(2);
    // Second glyph must start further along the path than the first.
    const pts = originPoints(cmds);
    expect(pts[1].x).toBeGreaterThan(pts[0].x);
  });
});
