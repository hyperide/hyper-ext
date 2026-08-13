import { describe, expect, it } from 'bun:test';

import { parseOpacity } from './effects';

describe('parseOpacity', () => {
  it('rounds arbitrary opacity to an integer percentage (no float artifacts)', () => {
    // 0.55 * 100 === 55.00000000000001 in IEEE-754 floating point
    expect(parseOpacity(['opacity-[0.55]']).opacity).toBe('55');
  });

  it('rounds 0.07 to 7 without trailing float noise', () => {
    // 0.07 * 100 === 7.000000000000001
    expect(parseOpacity(['opacity-[0.07]']).opacity).toBe('7');
  });

  it('rounds 0.29 to 29 without trailing float noise', () => {
    // 0.29 * 100 === 28.999999999999996
    expect(parseOpacity(['opacity-[0.29]']).opacity).toBe('29');
  });

  it('preserves a legitimate fractional percentage (0.335 -> 33.5)', () => {
    // 0.335 * 100 === 33.5; must not be coerced to an integer
    expect(parseOpacity(['opacity-[0.335]']).opacity).toBe('33.5');
  });

  it('preserves 0.555 as 55.5 while trimming only float noise', () => {
    // 0.555 * 100 === 55.50000000000001; trim noise but keep the .5
    expect(parseOpacity(['opacity-[0.555]']).opacity).toBe('55.5');
  });

  it('keeps the non-arbitrary opacity branch untouched', () => {
    expect(parseOpacity(['opacity-50']).opacity).toBe('50');
  });
});
