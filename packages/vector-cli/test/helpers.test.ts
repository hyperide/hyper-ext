import { describe, expect, it } from 'bun:test';
import { createContext, executeAndRender } from '../src/context';
import { deg, hslToHex, lerp, palette, pointOnCircle, rainbow } from '../src/helpers';
import { runInSandbox } from '../src/sandbox';

describe('helpers', () => {
  describe('rainbow', () => {
    it('should return hex color', () => {
      const color = rainbow(0, 10);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('should cycle through hues', () => {
      const c0 = rainbow(0, 4);
      const c1 = rainbow(1, 4);
      const c2 = rainbow(2, 4);
      expect(c0).not.toBe(c1);
      expect(c1).not.toBe(c2);
    });
  });

  describe('palette', () => {
    it('should return array of colors', () => {
      const colors = palette(5);
      expect(colors.length).toBe(5);
      for (const c of colors) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe('lerp', () => {
    it('should interpolate', () => {
      expect(lerp(0, 100, 0.5)).toBe(50);
      expect(lerp(0, 100, 0)).toBe(0);
      expect(lerp(0, 100, 1)).toBe(100);
    });
  });

  describe('hslToHex', () => {
    it('should convert red', () => {
      expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    });
    it('should convert green-ish', () => {
      expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    });
  });

  describe('pointOnCircle', () => {
    it('should compute point at 0 degrees', () => {
      const p = pointOnCircle(0, 0, 100, 0);
      expect(p.x).toBeCloseTo(100, 1);
      expect(p.y).toBeCloseTo(0, 1);
    });
    it('should compute point at 90 degrees', () => {
      const p = pointOnCircle(0, 0, 100, 90);
      expect(p.x).toBeCloseTo(0, 1);
      expect(p.y).toBeCloseTo(100, 1);
    });
  });

  describe('deg', () => {
    it('should convert degrees to radians', () => {
      expect(deg(180)).toBeCloseTo(Math.PI, 5);
      expect(deg(90)).toBeCloseTo(Math.PI / 2, 5);
    });
  });

  describe('sandbox integration', () => {
    it('should use rainbow in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        for (let i = 0; i < 5; i++) {
          circle(10).translate(i * 30 + 15, 100).fill(rainbow(i, 5))
        }
      `,
      );
      expect(ctx.graph.nodeCount).toBe(15); // 5 * (circle + translate + fill)
    });

    it('should use grid in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        grid(3, 3, 50, (x, y, i) =>
          rect(40, 40).translate(x, y).fill(rainbow(i, 9))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(27); // 9 * (rect + translate + fill)
    });

    it('should use radial in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        radial(6, 60, (angle, i, x, y) =>
          circle(10).translate(x + 100, y + 100).fill(rainbow(i, 6))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(18); // 6 * (circle + translate + fill)
    });

    it('should use repeat in sandbox', () => {
      const ctx = createContext(200, 20);
      runInSandbox(
        ctx,
        `
        repeat(5, (i, t) =>
          circle(lerp(5, 15, t)).translate(i * 40 + 20, 10).fill(rainbow(i, 5))
        )
      `,
      );
      expect(ctx.graph.nodeCount).toBe(15);
    });

    it('should use palette in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        const colors = palette(4)
        for (let i = 0; i < colors.length; i++) {
          rect(40, 40).translate(i * 50, 0).fill(colors[i])
        }
      `,
      );
      expect(ctx.graph.nodeCount).toBe(12);
    });

    it('should use hsl in sandbox', () => {
      const ctx = createContext();
      runInSandbox(
        ctx,
        `
        rect(100, 100).fill(hsl(200, 80, 50))
      `,
      );
      expect(ctx.graph.nodeCount).toBe(2);
    });

    it('should use pointOnCircle in sandbox', () => {
      const ctx = createContext(200, 200);
      runInSandbox(
        ctx,
        `
        const p = pointOnCircle(100, 100, 50, 45)
        circle(5).translate(p.x, p.y).fill("#f00")
      `,
      );
      expect(ctx.graph.nodeCount).toBe(3);
    });
  });

  describe('word art helpers', () => {
    it('should create ribbon', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'ribbon(120, 30).fill("#e74c3c")');
      expect(ctx.graph.nodeCount).toBe(2); // svgPath + fill
    });

    it('should create badge', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'badge(100, 40).fill("#333")');
      expect(ctx.graph.nodeCount).toBe(2);
    });

    it('should create burst', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'burst(12, 50, 25).fill("#ff0")');
      expect(ctx.graph.nodeCount).toBe(2);
    });

    it('should create bubble', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'bubble(150, 80).fill("#fff").stroke("#333", 2)');
      expect(ctx.graph.nodeCount).toBe(3);
    });

    it('should create spiralPath', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'spiralPath(3, 40).stroke("#333", 1)');
      expect(ctx.graph.nodeCount).toBe(2);
    });

    it('arcText positions individual chars by default (one node per glyph)', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'arcText("abc", 80)');
      // 3 chars × (textToPath + translate + rotate) = 9 nodes
      expect(ctx.graph.nodeCount).toBe(9);
    });

    it('arcText outline mode builds an arc curve + single textOnPath node', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'arcText("abc", 80, -90, 180, 24, { fontUrl: "mock://f.ttf" })');
      // arc generator + textOnPath = 2 nodes, 1 edge
      expect(ctx.graph.nodeCount).toBe(2);
      expect(ctx.graph.edgeCount).toBe(1);
    });

    it('wavyText outline mode builds a sine curve + single textOnPath node', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'wavyText("abc", 15, 0.3, 24, { fontUrl: "mock://f.ttf" })');
      // svgPath sine curve + textOnPath = 2 nodes, 1 edge
      expect(ctx.graph.nodeCount).toBe(2);
      expect(ctx.graph.edgeCount).toBe(1);
    });

    it('should access input global', () => {
      const ctx = createContext();
      ctx.stdinData = 'Hello World';
      runInSandbox(
        ctx,
        `
        if (input !== 'Hello World') throw new Error('input mismatch');
      `,
      );
    });

    it('should have empty input when no stdin', () => {
      const ctx = createContext();
      runInSandbox(
        ctx,
        `
        if (input !== '') throw new Error('should be empty');
      `,
      );
    });
  });

  describe('ribbon V-notch', () => {
    it('should create ribbon with V-notched ends', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'ribbon(120, 30).fill("#e74c3c")');
      expect(ctx.graph.nodeCount).toBe(2);
    });
  });

  describe('label text annotation', () => {
    it('should create label text annotation', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'label("Hello", 50, 50)');
      expect(ctx.textAnnotations.length).toBe(1);
      expect(ctx.textAnnotations[0].text).toBe('Hello');
    });

    it('should render label in SVG output', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'rect(100,50).fill("#eee"); label("Hello", 50, 30)');
      const svg = executeAndRender(ctx);
      expect(svg).toContain('<text');
      expect(svg).toContain('Hello');
    });

    it('should accept label options', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'label("Big", 10, 20, { size: 32, fill: "#f00", font: "monospace", anchor: "middle" })');
      expect(ctx.textAnnotations.length).toBe(1);
      expect(ctx.textAnnotations[0].fontSize).toBe(32);
      expect(ctx.textAnnotations[0].fill).toBe('#f00');
      expect(ctx.textAnnotations[0].fontFamily).toBe('monospace');
      expect(ctx.textAnnotations[0].anchor).toBe('middle');
    });
  });

  describe('heart', () => {
    it('should create heart shape', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'heart(50).fill("#e74c3c")');
      expect(ctx.graph.nodeCount).toBe(2); // svgPath + fill
    });

    it('should create heart with default size', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'heart().fill("#f00")');
      expect(ctx.graph.nodeCount).toBe(2);
    });
  });

  describe('cowsay', () => {
    it('should create cowsay with text annotation', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'cowsay("Hello World!")');
      expect(ctx.graph.nodeCount).toBeGreaterThanOrEqual(1);
      expect(ctx.textAnnotations.length).toBeGreaterThanOrEqual(1);
    });

    it('should include message and cow art annotations', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'cowsay("Moo!")');
      // 1 message + 5 cow lines = 6 annotations
      expect(ctx.textAnnotations.length).toBe(6);
      expect(ctx.textAnnotations[0].text).toBe('Moo!');
      expect(ctx.textAnnotations[0].fontFamily).toBe('monospace, Courier');
    });

    it('should render cowsay in SVG output', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'cowsay("Test").fill("#fff")');
      const svg = executeAndRender(ctx);
      expect(svg).toContain('<text');
      expect(svg).toContain('Test');
    });
  });

  describe('bubble with text', () => {
    it('should create bubble with text', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'bubble("Hello!", 150, 80).fill("#fff").stroke("#333", 2)');
      expect(ctx.graph.nodeCount).toBe(3); // svgPath + fill + stroke
      expect(ctx.textAnnotations.length).toBe(1);
    });

    it('should create empty bubble without text', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'bubble(150, 80).fill("#fff")');
      expect(ctx.graph.nodeCount).toBe(2);
      expect(ctx.textAnnotations.length).toBe(0);
    });

    it('should render bubble text in SVG', () => {
      const ctx = createContext();
      runInSandbox(ctx, 'bubble("Hello!", 150, 80).fill("#fff")');
      const svg = executeAndRender(ctx);
      expect(svg).toContain('<text');
      expect(svg).toContain('Hello!');
    });
  });
});
