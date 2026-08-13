/**
 * @file Client Tailwind parser tests for text size and text color disambiguation
 *
 * Accessed via: Right sidebar style inspector when reading Tailwind text styles
 * Assumptions: text-* Tailwind classes can represent either font size or color.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import { parseTailwindClasses } from './tailwindParser';

describe('client tailwindParser text styles', () => {
  it('parses arbitrary text size separately from text color', () => {
    const result = parseTailwindClasses('text-[15px] text-[#fff]');

    expect(result.fontSize).toBe('15px');
    expect(result.textColor).toBe('#fff');
  });

  it('parses named text colors separately from text size', () => {
    const result = parseTailwindClasses('text-sm text-white');

    expect(result.fontSize).toBe('0.875rem');
    expect(result.textColor).toBe('#ffffff');
  });
});
