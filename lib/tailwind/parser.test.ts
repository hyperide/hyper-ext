/**
 * Tests for Tailwind parser utilities
 */

import { describe, expect, it } from 'bun:test';
import { getConflictingPrefixes, parseTailwindClasses, removeConflictingClasses } from './parser';

describe('parseTailwindClasses', () => {
  it('should parse position classes', () => {
    const result = parseTailwindClasses('relative absolute fixed sticky static');

    expect(result.position).toBe('static'); // Last one wins
  });

  it('should parse spacing classes', () => {
    const result = parseTailwindClasses('w-64 h-32 mt-4 mb-8 ml-2 mr-6');

    expect(result.width).toBe('16rem');
    expect(result.height).toBe('8rem');
    expect(result.marginTop).toBe('1rem');
    expect(result.marginBottom).toBe('2rem');
    expect(result.marginLeft).toBe('0.5rem');
    expect(result.marginRight).toBe('1.5rem');
  });

  it('should parse arbitrary values', () => {
    const result = parseTailwindClasses('w-[227px] h-[100vh] mt-[1.5rem]');

    expect(result.width).toBe('227px');
    expect(result.height).toBe('100vh');
    expect(result.marginTop).toBe('1.5rem');
  });

  it('should parse negative values', () => {
    const result = parseTailwindClasses('-mt-4 -ml-2 -top-8');

    expect(result.marginTop).toBe('-1rem');
    expect(result.marginLeft).toBe('-0.5rem');
    expect(result.top).toBe('-2rem');
  });

  it('should parse color classes', () => {
    const result = parseTailwindClasses('bg-[#ff0000] border-[rgba(0,0,0,0.5)]');

    expect(result.backgroundColor).toBe('#ff0000');
    expect(result.borderColor).toBe('rgba(0,0,0,0.5)');
  });

  it('should parse border radius', () => {
    const result = parseTailwindClasses('rounded-lg');

    expect(result.borderRadius).toBe('0.5rem');
  });

  it('should parse overflow', () => {
    const result = parseTailwindClasses('overflow-hidden');

    expect(result.overflow).toBe('hidden');
  });

  it('should parse display and flexbox', () => {
    const result = parseTailwindClasses('flex flex-col');

    expect(result.display).toBe('flex');
    expect(result.flexDirection).toBe('column');
  });

  it('should handle empty or invalid input', () => {
    expect(parseTailwindClasses('')).toEqual({});
    expect(parseTailwindClasses('   ')).toEqual({});
  });

  it('should handle position values for non-static positions', () => {
    const result = parseTailwindClasses('absolute top-4 left-8');

    expect(result.position).toBe('absolute');
    expect(result.top).toBe('1rem');
    expect(result.left).toBe('2rem');
  });
});

describe('getConflictingPrefixes', () => {
  it('should return prefixes for width', () => {
    const prefixes = getConflictingPrefixes(['width']);

    expect(prefixes).toContain('w-');
  });

  it('should return prefixes for margin', () => {
    const prefixes = getConflictingPrefixes(['marginTop', 'marginLeft']);

    expect(prefixes).toContain('mt-');
    expect(prefixes).toContain('-mt-');
    expect(prefixes).toContain('ml-');
    expect(prefixes).toContain('-ml-');
  });

  it('should return prefixes for position', () => {
    const prefixes = getConflictingPrefixes(['position', 'top']);

    expect(prefixes).toContain('static');
    expect(prefixes).toContain('relative');
    expect(prefixes).toContain('absolute');
    expect(prefixes).toContain('top-');
    expect(prefixes).toContain('-top-');
  });

  it('should return prefixes for display', () => {
    const prefixes = getConflictingPrefixes(['display']);

    expect(prefixes).toContain('flex');
    expect(prefixes).toContain('block');
    expect(prefixes).toContain('grid');
  });

  it('should return prefixes for border radius', () => {
    const prefixes = getConflictingPrefixes(['borderRadius']);

    expect(prefixes).toContain('rounded-');
  });

  it('should handle opacity', () => {
    const prefixes = getConflictingPrefixes(['opacity']);

    expect(prefixes).toContain('opacity-');
  });
});

describe('removeConflictingClasses', () => {
  it('should remove conflicting width classes', () => {
    const { preserved, removed } = removeConflictingClasses('w-32 w-64 h-16', ['width']);

    expect(removed).toContain('w-32');
    expect(removed).toContain('w-64');
    expect(preserved).toContain('h-16');
  });

  it('should remove conflicting margin classes', () => {
    const { preserved, removed } = removeConflictingClasses('mt-4 mt-8 mb-2', ['marginTop']);

    expect(removed).toContain('mt-4');
    expect(removed).toContain('mt-8');
    expect(preserved).toContain('mb-2');
  });

  it('should preserve border width when removing border color', () => {
    const { preserved, removed } = removeConflictingClasses('border border-red-500', ['borderColor']);

    expect(preserved).toContain('border');
    expect(removed).toContain('border-red-500');
  });

  it('should remove position classes', () => {
    const { preserved, removed } = removeConflictingClasses('relative absolute flex', ['position']);

    expect(removed).toContain('relative');
    expect(removed).toContain('absolute');
    expect(preserved).toContain('flex');
  });

  it('should handle negative values', () => {
    const { preserved, removed } = removeConflictingClasses('-mt-4 mt-8 flex', ['marginTop']);

    expect(removed).toContain('-mt-4');
    expect(removed).toContain('mt-8');
    expect(preserved).toContain('flex');
  });

  it('should handle arbitrary values', () => {
    const { preserved, removed } = removeConflictingClasses('w-[227px] w-64 h-32', ['width']);

    expect(removed).toContain('w-[227px]');
    expect(removed).toContain('w-64');
    expect(preserved).toContain('h-32');
  });

  it('should preserve non-conflicting classes', () => {
    const { preserved, removed } = removeConflictingClasses('flex items-center justify-between w-32', ['width']);

    expect(preserved).toContain('flex');
    expect(preserved).toContain('items-center');
    expect(preserved).toContain('justify-between');
    expect(removed).toContain('w-32');
  });

  it('should handle empty className', () => {
    const { preserved, removed } = removeConflictingClasses('', ['width']);
    expect(preserved).toBe('');
    expect(removed).toEqual([]);
  });

  it('should handle multiple style keys', () => {
    const { preserved, removed } = removeConflictingClasses('w-32 h-16 mt-4 mb-8 flex', ['width', 'marginTop']);

    expect(removed).toContain('w-32');
    expect(removed).toContain('mt-4');
    expect(preserved).toContain('h-16');
    expect(preserved).toContain('mb-8');
    expect(preserved).toContain('flex');
  });
});
