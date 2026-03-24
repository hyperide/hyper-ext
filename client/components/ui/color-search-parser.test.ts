import { describe, expect, test } from 'bun:test';
import { parseColorInput } from './color-search-parser';

// Canvas API is not available in bun:test — named color fallback returns null.
// Tests cover hex/rgb/hsl parsing via regex + math (no canvas needed).

describe('parseColorInput', () => {
  test('parses 6-digit hex with #', () => {
    const result = parseColorInput('#3b82f6');
    expect(result).toEqual({ hex: '#3b82f6', original: '#3b82f6', format: 'hex' });
  });

  test('parses 6-digit hex without #', () => {
    const result = parseColorInput('3b82f6');
    expect(result).toEqual({ hex: '#3b82f6', original: '3b82f6', format: 'hex' });
  });

  test('parses 3-digit hex', () => {
    const result = parseColorInput('#abc');
    expect(result).toEqual({ hex: '#aabbcc', original: '#abc', format: 'hex-short' });
  });

  test('parses 3-digit hex without #', () => {
    const result = parseColorInput('000');
    expect(result).toEqual({ hex: '#000000', original: '000', format: 'hex-short' });
  });

  test('parses 1-digit hex (#a → #aaaaaa)', () => {
    expect(parseColorInput('#a')).toEqual({ hex: '#aaaaaa', original: '#a', format: 'hex-short' });
    expect(parseColorInput('f')).toEqual({ hex: '#ffffff', original: 'f', format: 'hex-short' });
    expect(parseColorInput('#0')).toEqual({ hex: '#000000', original: '#0', format: 'hex-short' });
  });

  test('parses rgb format', () => {
    const result = parseColorInput('rgb(59, 130, 246)');
    expect(result?.format).toBe('rgb');
    expect(result?.hex).toBe('#3b82f6');
  });

  test('parses rgb without commas', () => {
    const result = parseColorInput('rgb(59 130 246)');
    expect(result?.format).toBe('rgb');
    expect(result?.hex).toBe('#3b82f6');
  });

  test('parses hsl format', () => {
    const result = parseColorInput('hsl(0, 100%, 50%)');
    expect(result?.format).toBe('hsl');
    expect(result?.hex).toBe('#ff0000');
  });

  test('returns null for non-color text', () => {
    expect(parseColorInput('hello')).toBeNull();
    expect(parseColorInput('blue-500')).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(parseColorInput('')).toBeNull();
    expect(parseColorInput('   ')).toBeNull();
  });
});
