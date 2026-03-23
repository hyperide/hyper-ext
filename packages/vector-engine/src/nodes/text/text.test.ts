import { describe, expect, it } from 'bun:test';
import type { Font, Path as OpentypePath } from 'opentype.js';
import { initShaper, resetShaper, shapeText } from './shaper';
import { registerFont, textToPathNode } from './text-to-path';

describe('text to path', () => {
  it('should have correct node definition', () => {
    expect(textToPathNode.type).toBe('textToPath');
    expect(textToPathNode.category).toBe('generator');
    expect(textToPathNode.params.map((p) => p.name)).toContain('text');
    expect(textToPathNode.params.map((p) => p.name)).toContain('fontSize');
  });

  it('should output empty path when no font loaded', () => {
    const result = textToPathNode.execute(
      {},
      {
        text: 'Hello',
        fontSize: 24,
        fontUrl: '',
      },
    );
    const pathVal = (result.path as { value: { commands: { length: number } } }).value;
    expect(pathVal.commands.length).toBe(0);
  });

  it('should output empty path for empty text', () => {
    const result = textToPathNode.execute(
      {},
      {
        text: '',
        fontSize: 24,
        fontUrl: '',
      },
    );
    const pathVal = (result.path as { value: { commands: { length: number } } }).value;
    expect(pathVal.commands.length).toBe(0);
  });

  it('should convert font path commands to vector path when font is registered', () => {
    // Build a minimal mock Font that returns known path commands
    const mockCommands = [
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'C', x1: 15, y1: 5, x2: 15, y2: 10, x: 10, y: 10 },
      { type: 'Q', x1: 5, y1: 15, x: 0, y: 10 },
      { type: 'Z' },
    ];
    const mockFont = {
      getPath: (_text: string, _x: number, _y: number, _size: number): OpentypePath =>
        ({ commands: mockCommands }) as unknown as OpentypePath,
    } as unknown as Font;

    registerFont('mock://test-font.ttf', mockFont);

    const result = textToPathNode.execute(
      {},
      {
        text: 'A',
        fontSize: 48,
        fontUrl: 'mock://test-font.ttf',
        x: 0,
        y: 0,
      },
    );

    const pathVal = (result.path as { value: { commands: { length: number }; closed: boolean } }).value;
    // Should have encoded the M, L, C, Q, Z commands — non-empty
    expect(pathVal.commands.length).toBeGreaterThan(0);
  });

  it('should return empty path when font throws an error', () => {
    const brokenFont = {
      getPath: () => {
        throw new Error('font broken');
      },
    } as unknown as Font;

    registerFont('mock://broken-font.ttf', brokenFont);

    const result = textToPathNode.execute(
      {},
      {
        text: 'X',
        fontSize: 48,
        fontUrl: 'mock://broken-font.ttf',
        x: 0,
        y: 0,
      },
    );

    // catch block swallows the error; builder.build() still returns empty path
    const pathVal = (result.path as { value: { commands: { length: number } } }).value;
    expect(pathVal.commands.length).toBe(0);
  });
});

describe('shapeText', () => {
  it('should export shapeText function', () => {
    expect(typeof shapeText).toBe('function');
  });

  it('should return empty array when no font blob provided', () => {
    const glyphs = shapeText(null, 'Hello', 24);
    expect(glyphs).toEqual([]);
  });

  it('should return empty array for empty text', () => {
    const glyphs = shapeText(new ArrayBuffer(10), '', 24);
    expect(glyphs).toEqual([]);
  });

  it('should return empty when shaper not initialized', () => {
    resetShaper();
    const glyphs = shapeText(new ArrayBuffer(10), 'Hello', 24);
    expect(glyphs).toEqual([]);
  });

  it('should export initShaper as async function', () => {
    expect(typeof initShaper).toBe('function');
    const result = initShaper();
    expect(result instanceof Promise).toBe(true);
    return result;
  });
});
