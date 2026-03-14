import { describe, expect, it } from 'bun:test';
import { commandsToSvgD, decodeCommands, encodeCommands, PathCmd, type PathCommand, svgDToCommands } from './commands';

describe('PathCmd encoding', () => {
  it('should encode move + line + close', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 50 },
      { type: PathCmd.Close },
    ]);
    expect(cmds).toBeInstanceOf(Float64Array);
    // Move(0,0) = [0, 0, 0], Line(100,0) = [1, 100, 0], Line(100,50) = [1, 100, 50], Close = [5]
    expect(cmds.length).toBe(10); // 3 + 3 + 3 + 1
  });

  it('should encode cubic bezier', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Cubic, cx1: 10, cy1: 20, cx2: 30, cy2: 40, x: 50, y: 60 },
    ]);
    // Move = 3, Cubic = 7 (type + 6 coords)
    expect(cmds.length).toBe(10);
  });

  it('should roundtrip encode → decode', () => {
    const original: PathCommand[] = [
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 30, y: 40 },
      { type: PathCmd.Quad, cx: 50, cy: 60, x: 70, y: 80 },
      { type: PathCmd.Close },
    ];
    const encoded = encodeCommands(original);
    const decoded = decodeCommands(encoded);
    expect(decoded).toEqual(original);
  });

  it('should roundtrip arc commands', () => {
    const original: PathCommand[] = [
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Arc, rx: 25, ry: 25, rotation: 0, largeArc: 1, sweep: 0, x: 50, y: 0 },
    ];
    const encoded = encodeCommands(original);
    const decoded = decodeCommands(encoded);
    expect(decoded).toEqual(original);
  });

  it('should handle empty command list', () => {
    const encoded = encodeCommands([]);
    expect(encoded.length).toBe(0);
    const decoded = decodeCommands(encoded);
    expect(decoded).toEqual([]);
  });
});

describe('SVG d attribute conversion', () => {
  it('should convert commands to SVG d string', () => {
    const cmds = encodeCommands([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 0 },
      { type: PathCmd.Line, x: 100, y: 50 },
      { type: PathCmd.Close },
    ]);
    expect(commandsToSvgD(cmds)).toBe('M 0 0 L 100 0 L 100 50 Z');
  });

  it('should parse SVG d string to commands', () => {
    const cmds = svgDToCommands('M 10 20 L 30 40 C 1 2 3 4 5 6 Z');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 30, y: 40 },
      { type: PathCmd.Cubic, cx1: 1, cy1: 2, cx2: 3, cy2: 4, x: 5, y: 6 },
      { type: PathCmd.Close },
    ]);
  });

  it('should handle Q (quadratic) commands', () => {
    const cmds = svgDToCommands('M 0 0 Q 50 100 100 0 Z');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({ type: PathCmd.Quad, cx: 50, cy: 100, x: 100, y: 0 });
  });

  it('should handle A (arc) commands', () => {
    const cmds = svgDToCommands('M 0 0 A 25 25 0 1 0 50 0');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({
      type: PathCmd.Arc,
      rx: 25,
      ry: 25,
      rotation: 0,
      largeArc: 1,
      sweep: 0,
      x: 50,
      y: 0,
    });
  });

  it('should roundtrip SVG d → commands → SVG d', () => {
    const original = 'M 10 20 L 30 40 Q 50 60 70 80 Z';
    const cmds = svgDToCommands(original);
    const result = commandsToSvgD(cmds);
    expect(result).toBe(original);
  });

  it('should handle comma-separated coordinates', () => {
    const cmds = svgDToCommands('M 0,0 L 100,50');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100, y: 50 },
    ]);
  });

  it('should parse negative coords without separators: M10-20L30-40', () => {
    const cmds = svgDToCommands('M10-20L30-40');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 10, y: -20 },
      { type: PathCmd.Line, x: 30, y: -40 },
    ]);
  });

  it('should parse implicit line after move: M10 20 30 40', () => {
    // Per SVG spec, extra coords after M become implicit L commands
    const cmds = svgDToCommands('M10 20 30 40');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 10, y: 20 },
      { type: PathCmd.Line, x: 30, y: 40 },
    ]);
  });

  it('should parse adjacent decimal dots: M0 0L100.5.5', () => {
    const cmds = svgDToCommands('M0 0L100.5.5');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 100.5, y: 0.5 },
    ]);
  });

  it('should handle H and V commands', () => {
    const cmds = svgDToCommands('M0 0 H10 V20');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 10, y: 0 },
      { type: PathCmd.Line, x: 10, y: 20 },
    ]);
  });

  it('should handle S (smooth cubic) command', () => {
    const cmds = svgDToCommands('M0 0 C10 10 20 20 30 30 S50 50 60 60');
    const decoded = decodeCommands(cmds);
    expect(decoded).toHaveLength(3);
    expect(decoded[0].type).toBe(PathCmd.Move);
    expect(decoded[1].type).toBe(PathCmd.Cubic);
    expect(decoded[2].type).toBe(PathCmd.Cubic);
  });
});

describe('decodeCommands error handling', () => {
  it('should throw on unknown discriminant to prevent infinite loop', () => {
    // Discriminant 99 is not a valid PathCmd
    const corrupt = new Float64Array([99, 0, 0]);
    expect(() => decodeCommands(corrupt)).toThrow(/Unknown path command type/);
  });
});

describe('SVG parsing edge cases', () => {
  it('should parse scientific notation: M1e2 3e1 → M(100, 30)', () => {
    const cmds = svgDToCommands('M1e2 3e1');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([{ type: PathCmd.Move, x: 100, y: 30 }]);
  });

  it('should parse scientific notation with negative exponent: L1.5e-3 2 → L(0.0015, 2)', () => {
    const cmds = svgDToCommands('M0 0 L1.5e-3 2');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({ type: PathCmd.Line, x: 0.0015, y: 2 });
  });

  it('should return empty Float64Array for empty d string', () => {
    const cmds = svgDToCommands('');
    expect(cmds).toBeInstanceOf(Float64Array);
    expect(cmds.length).toBe(0);
  });

  it('should return empty Float64Array for whitespace-only d string', () => {
    const cmds = svgDToCommands('   ');
    expect(cmds).toBeInstanceOf(Float64Array);
    expect(cmds.length).toBe(0);
  });

  it('should parse multiple decimal points: M1.2.3.4.5 → M(1.2, 0.3) L(0.4, 0.5)', () => {
    // Per SVG spec: adjacent decimals split at the dot boundary.
    // M consumes (1.2, 0.3), then implicit L consumes (0.4, 0.5).
    const cmds = svgDToCommands('M1.2.3.4.5');
    const decoded = decodeCommands(cmds);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual({ type: PathCmd.Move, x: 1.2, y: 0.3 });
    expect(decoded[1]).toEqual({ type: PathCmd.Line, x: 0.4, y: 0.5 });
  });

  it('should continue parsing L after Z: M0 0 L10 0 Z L20 0', () => {
    // Per SVG spec, after Z, further drawing commands start a new implicit subpath.
    // The parser retains the last command letter across Z, so L20 0 is parsed normally.
    const cmds = svgDToCommands('M0 0 L10 0 Z L20 0');
    const decoded = decodeCommands(cmds);
    expect(decoded).toHaveLength(4);
    expect(decoded[0]).toEqual({ type: PathCmd.Move, x: 0, y: 0 });
    expect(decoded[1]).toEqual({ type: PathCmd.Line, x: 10, y: 0 });
    expect(decoded[2]).toEqual({ type: PathCmd.Close });
    expect(decoded[3]).toEqual({ type: PathCmd.Line, x: 20, y: 0 });
  });

  it('should convert relative m/l to absolute coordinates', () => {
    // SVG spec: m10 20 → M(10,20), then l30 40 → L(10+30, 20+40) = L(40, 60)
    const cmds = svgDToCommands('m10 20 l30 40');
    const decoded = decodeCommands(cmds);
    expect(decoded[0]).toEqual({ type: PathCmd.Move, x: 10, y: 20 });
    expect(decoded[1]).toEqual({ type: PathCmd.Line, x: 40, y: 60 });
  });

  it('should convert relative c (cubic) to absolute coordinates', () => {
    // m0 0 c10 10 20 20 30 30 → M(0,0) C(10,10, 20,20, 30,30) — same as absolute since start is 0,0
    // m10 20 c10 10 20 20 30 30 → M(10,20) C(20,30, 30,40, 40,50)
    const cmds = svgDToCommands('m10 20 c10 10 20 20 30 30');
    const decoded = decodeCommands(cmds);
    expect(decoded[0]).toEqual({ type: PathCmd.Move, x: 10, y: 20 });
    expect(decoded[1]).toEqual({
      type: PathCmd.Cubic,
      cx1: 20,
      cy1: 30,
      cx2: 30,
      cy2: 40,
      x: 40,
      y: 50,
    });
  });

  it('should convert relative q (quad) to absolute coordinates', () => {
    const cmds = svgDToCommands('M10 20 q5 10 15 0');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({
      type: PathCmd.Quad,
      cx: 15,
      cy: 30,
      x: 25,
      y: 20,
    });
  });

  it('should convert relative a (arc) to absolute coordinates', () => {
    const cmds = svgDToCommands('M10 20 a25 25 0 1 0 50 0');
    const decoded = decodeCommands(cmds);
    // rx/ry/rotation/flags stay the same, only endpoint is relative: x=10+50=60, y=20+0=20
    expect(decoded[1]).toEqual({
      type: PathCmd.Arc,
      rx: 25,
      ry: 25,
      rotation: 0,
      largeArc: 1,
      sweep: 0,
      x: 60,
      y: 20,
    });
  });

  it('should handle mixed absolute and relative commands: M0 0 l50 0 L100 50', () => {
    const cmds = svgDToCommands('M0 0 l50 0 L100 50');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 0, y: 0 },
      { type: PathCmd.Line, x: 50, y: 0 }, // relative: 0+50, 0+0
      { type: PathCmd.Line, x: 100, y: 50 }, // absolute
    ]);
  });

  it('should handle relative h and v commands', () => {
    // M10 20 h30 v40 → L(10+30, 20) L(40, 20+40)
    const cmds = svgDToCommands('M10 20 h30 v40');
    const decoded = decodeCommands(cmds);
    expect(decoded[1]).toEqual({ type: PathCmd.Line, x: 40, y: 20 });
    expect(decoded[2]).toEqual({ type: PathCmd.Line, x: 40, y: 60 });
  });

  it('should chain relative commands: m5 5 l10 0 l0 10 l-10 0 z', () => {
    // A relative square starting at (5,5)
    const cmds = svgDToCommands('m5 5 l10 0 l0 10 l-10 0 z');
    const decoded = decodeCommands(cmds);
    expect(decoded).toEqual([
      { type: PathCmd.Move, x: 5, y: 5 },
      { type: PathCmd.Line, x: 15, y: 5 },
      { type: PathCmd.Line, x: 15, y: 15 },
      { type: PathCmd.Line, x: 5, y: 15 },
      { type: PathCmd.Close },
    ]);
  });

  it('should not parse condensed arc flags without separators — known limitation', () => {
    // TODO: The SVG spec allows arc flag digits (0 or 1) to be written without
    // separators: "A25 25 0 00-25 25" where the two 0s are largeArc=0 and sweep=0.
    // The current TOKEN_RE treats "00" as the single number 0, consuming both flags
    // as one token. The result is mis-parsed (only 6 values consumed instead of 7).
    // Track in: HYP-308 (requires special arc tokenization).
    //
    // This test documents that parsing does NOT throw (no crash) but produces
    // wrong output — serving as a regression baseline for the future fix.
    expect(() => svgDToCommands('M0 0 A25 25 0 00-25 25')).not.toThrow();
    // Full correct behavior once implemented:
    //   decoded[1] = { type: PathCmd.Arc, rx: 25, ry: 25, rotation: 0, largeArc: 0, sweep: 0, x: -25, y: 25 }
  });
});
