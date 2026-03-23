/**
 * @file Utility helpers — convenience functions for elegant one-liners
 *
 * Accessed via: Global functions in sandbox — grid(), radial(), rainbow(), arcText(), burst(), etc.
 */

import { ChainableNode } from './chainable';
import type { EvalContext } from './context';

/** Generate HSL color from index. rainbow(i, total) → "#rrggbb" */
export function rainbow(index: number, total: number): string {
  const hue = Math.round((index / total) * 360);
  return hslToHex(hue, 80, 50);
}

/** HSL to hex color */
export function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100;
  const ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Generate a color palette. palette(5) → ["#ff0000", "#ff9900", ...] */
export function palette(count: number, saturation = 80, lightness = 50): string[] {
  return Array.from({ length: count }, (_, i) => {
    const hue = Math.round((i / count) * 360);
    return hslToHex(hue, saturation, lightness);
  });
}

/** Lerp between two values */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Random number in range (seeded for reproducibility) */
let seed = 42;
export function random(min = 0, max = 1): number {
  seed = (seed * 16807 + 0) % 2147483647;
  return min + (seed / 2147483647) * (max - min);
}

export function setSeed(s: number): void {
  seed = s;
}

/** Degrees to radians */
export function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Point on circle */
export function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = deg(angleDeg);
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/**
 * Create helpers that need EvalContext (they create nodes).
 * These are factory functions that return the globals to inject.
 */
export function createHelpers(_ctx: EvalContext): Record<string, unknown> {
  return {
    /** Create grid of shapes: grid(cols, rows, spacing, fn) */
    grid: (
      cols: number,
      rows: number,
      spacing: number,
      fn: (x: number, y: number, i: number) => ChainableNode,
    ): ChainableNode[] => {
      const results: ChainableNode[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;
          const y = row * spacing;
          results.push(fn(x, y, row * cols + col));
        }
      }
      return results;
    },

    /** Create radial arrangement: radial(count, radius, fn) */
    radial: (
      count: number,
      radius: number,
      fn: (angle: number, i: number, x: number, y: number) => ChainableNode,
      cx = 0,
      cy = 0,
    ): ChainableNode[] => {
      const results: ChainableNode[] = [];
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * 360;
        const pt = pointOnCircle(cx, cy, radius, angle);
        results.push(fn(angle, i, pt.x, pt.y));
      }
      return results;
    },

    /** Repeat shape n times with transform: repeat(n, fn) */
    repeat: (n: number, fn: (i: number, t: number) => ChainableNode): ChainableNode[] => {
      return Array.from({ length: n }, (_, i) => fn(i, i / (n - 1 || 1)));
    },

    // Pure math helpers (no context needed)
    rainbow,
    palette,
    lerp,
    random,
    setSeed,
    deg,
    pointOnCircle,
    hsl: hslToHex,
  };
}

/**
 * Word art and decorative shape helpers.
 * Text-based helpers (arcText, wavyText) position individual characters —
 * text() requires a loaded font to produce actual path outlines.
 */
export function createWordArtHelpers(
  ctx: EvalContext,
  textFn: (text: string, fontSize: number) => ChainableNode,
): Record<string, (...args: never[]) => unknown> {
  return {
    /** Inject a raw SVG text annotation (no font rendering required) */
    label: (
      str: string,
      x: number,
      y: number,
      opts?: { size?: number; fill?: string; font?: string; anchor?: string },
    ): void => {
      ctx.textAnnotations.push({
        text: str,
        x,
        y,
        fontSize: opts?.size ?? 16,
        fontFamily: opts?.font ?? 'system-ui, -apple-system, Segoe UI, sans-serif',
        fill: opts?.fill ?? '#000000',
        anchor: opts?.anchor ?? 'start',
      });
    },
    /** Word art — text along an arc */
    arcText: (str: string, radius: number, startAngle = -90, spread = 180, fontSize = 24): ChainableNode[] => {
      const chars = str.split('');
      const angleStep = spread / Math.max(chars.length - 1, 1);
      return chars.map((char, i) => {
        const angle = startAngle + i * angleStep;
        const p = pointOnCircle(0, 0, radius, angle);
        return textFn(char, fontSize)
          .translate(p.x, p.y)
          .rotate(angle + 90);
      });
    },

    /** Word art — wavy text */
    wavyText: (str: string, amplitude = 15, frequency = 0.3, fontSize = 24): ChainableNode[] => {
      const chars = str.split('');
      return chars.map((char, i) => {
        const x = i * fontSize * 0.6;
        const y = Math.sin(i * frequency) * amplitude;
        return textFn(char, fontSize).translate(x, y);
      });
    },

    /** Ribbon/banner shape — hexagonal with V-notched ends */
    ribbon: (width: number, height: number, notch = 10): ChainableNode => {
      const half = height / 2;
      const d = `M ${notch} 0 L ${width - notch} 0 L ${width} ${half} L ${width - notch} ${height} L ${notch} ${height} L 0 ${half} Z`;
      return ChainableNode.generator(ctx, 'svgPath', { d });
    },

    /** Badge — octagonal shape with notched corners */
    badge: (width: number, height: number, notchSize = 8): ChainableNode => {
      const d = `M ${notchSize} 0 L ${width - notchSize} 0 L ${width} ${notchSize} L ${width} ${height - notchSize} L ${width - notchSize} ${height} L ${notchSize} ${height} L 0 ${height - notchSize} L 0 ${notchSize} Z`;
      return ChainableNode.generator(ctx, 'svgPath', { d });
    },

    /** Starburst — pointed star with many rays */
    burst: (rays: number, outerR: number, innerR: number): ChainableNode => {
      const points: string[] = [];
      for (let i = 0; i < rays * 2; i++) {
        const angle = (i / (rays * 2)) * 360 - 90;
        const r = i % 2 === 0 ? outerR : innerR;
        const p = pointOnCircle(0, 0, r, angle);
        points.push(i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`);
      }
      return ChainableNode.generator(ctx, 'svgPath', { d: `${points.join(' ')} Z` });
    },

    /** Spiral path */
    spiralPath: (turns: number, maxRadius: number, points = 100): ChainableNode => {
      const cmds: string[] = [];
      for (let i = 0; i <= points; i++) {
        const t = i / points;
        const angle = t * turns * 360;
        const r = t * maxRadius;
        const p = pointOnCircle(0, 0, r, angle);
        cmds.push(i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`);
      }
      return ChainableNode.generator(ctx, 'svgPath', { d: cmds.join(' ') });
    },

    /** Heart shape via cubic bezier */
    heart: (size = 50): ChainableNode => {
      const s = size;
      // Heart shape: two cubic beziers meeting at bottom point
      const d = [
        `M 0 ${-s * 0.35}`,
        `C ${-s * 0.05} ${-s * 0.55} ${-s * 0.35} ${-s * 0.6} ${-s * 0.5} ${-s * 0.35}`,
        `C ${-s * 0.65} ${-s * 0.1} ${-s * 0.5} ${s * 0.1} 0 ${s * 0.5}`,
        `C ${s * 0.5} ${s * 0.1} ${s * 0.65} ${-s * 0.1} ${s * 0.5} ${-s * 0.35}`,
        `C ${s * 0.35} ${-s * 0.6} ${s * 0.05} ${-s * 0.55} 0 ${-s * 0.35}`,
        'Z',
      ].join(' ');
      return ChainableNode.generator(ctx, 'svgPath', { d });
    },

    /** Cowsay — speech bubble with ASCII cow, uses text annotations */
    cowsay: (message: string, fontSize = 14): ChainableNode => {
      const padding = 10;
      const charWidth = fontSize * 0.6;
      const lineHeight = fontSize * 1.3;
      const textWidth = message.length * charWidth + padding * 2;
      const bubbleW = Math.max(textWidth, 60);
      const bubbleH = lineHeight + padding * 2;

      // Inline bubble path (avoids recursive createWordArtHelpers call)
      const r = Math.min(10, bubbleW * 0.1, bubbleH * 0.1);
      const tx = bubbleW * 0.3;
      const ty = bubbleH + 20;
      const bubblePath = [
        `M ${r} 0`,
        `L ${bubbleW - r} 0`,
        `Q ${bubbleW} 0 ${bubbleW} ${r}`,
        `L ${bubbleW} ${bubbleH - r}`,
        `Q ${bubbleW} ${bubbleH} ${bubbleW - r} ${bubbleH}`,
        `L ${tx + 10} ${bubbleH}`,
        `L ${tx} ${ty}`,
        `L ${tx - 10} ${bubbleH}`,
        `L ${r} ${bubbleH}`,
        `Q 0 ${bubbleH} 0 ${bubbleH - r}`,
        `L 0 ${r}`,
        `Q 0 0 ${r} 0`,
        'Z',
      ].join(' ');
      const node = ChainableNode.generator(ctx, 'svgPath', { d: bubblePath });

      // Add message text
      ctx.textAnnotations.push({
        text: message,
        x: bubbleW / 2,
        y: bubbleH / 2 + fontSize * 0.35,
        fontSize,
        fontFamily: 'monospace, Courier',
        fill: '#000000',
        anchor: 'middle',
      });

      // Add cow ASCII art as text annotations
      const cowLines = [
        '\\   ^__^',
        ' \\  (oo)\\_______',
        '    (__)\\       )\\/\\',
        '        ||----w |',
        '        ||     ||',
      ];
      const cowStartY = bubbleH + 25;
      for (let i = 0; i < cowLines.length; i++) {
        ctx.textAnnotations.push({
          text: cowLines[i],
          x: bubbleW * 0.25,
          y: cowStartY + i * (fontSize * 1.1),
          fontSize: fontSize * 0.85,
          fontFamily: 'monospace, Courier',
          fill: '#333333',
          anchor: 'start',
        });
      }

      return node;
    },

    /** Speech bubble with tail. Accepts optional leading text string. */
    bubble: (...args: unknown[]): ChainableNode => {
      let label: string | undefined;
      let width: number;
      let height: number;
      let tailX: number;
      let tailY: number;

      if (typeof args[0] === 'string') {
        label = args[0] as string;
        width = (args[1] as number) ?? 150;
        height = (args[2] as number) ?? 80;
        tailX = (args[3] as number) ?? -1;
        tailY = (args[4] as number) ?? -1;
      } else {
        width = (args[0] as number) ?? 150;
        height = (args[1] as number) ?? 80;
        tailX = (args[2] as number) ?? -1;
        tailY = (args[3] as number) ?? -1;
      }

      const tx = tailX < 0 ? width * 0.3 : tailX;
      const ty = tailY < 0 ? height + 20 : tailY;
      const r = Math.min(10, width * 0.1, height * 0.1);
      const d = [
        `M ${r} 0`,
        `L ${width - r} 0`,
        `Q ${width} 0 ${width} ${r}`,
        `L ${width} ${height - r}`,
        `Q ${width} ${height} ${width - r} ${height}`,
        `L ${tx + 10} ${height}`,
        `L ${tx} ${ty}`,
        `L ${tx - 10} ${height}`,
        `L ${r} ${height}`,
        `Q 0 ${height} 0 ${height - r}`,
        `L 0 ${r}`,
        `Q 0 0 ${r} 0`,
        'Z',
      ].join(' ');

      if (label !== undefined) {
        ctx.textAnnotations.push({
          text: label,
          x: width / 2,
          y: height / 2 + 5,
          fontSize: 16,
          fontFamily: 'sans-serif',
          fill: '#333',
          anchor: 'middle',
        });
      }

      return ChainableNode.generator(ctx, 'svgPath', { d });
    },
  };
}
