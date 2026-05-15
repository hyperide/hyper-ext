/**
 * @file Unit tests for the pure className manipulation helpers used by writeOrder.
 *
 * Accessed via: bun test runner; covers the surgical rewrite logic without touching
 *   the AST or AstOperations.
 */
import { describe, expect, it } from 'bun:test';
import { applyOrderClassChange, buildOrderClass, isOrderClassAtBreakpoint } from './order-class-utils';

describe('buildOrderClass', () => {
  it('returns bare order class for base breakpoint', () => {
    expect(buildOrderClass(2, undefined)).toBe('order-2');
  });

  it('prefixes with breakpoint when provided', () => {
    expect(buildOrderClass(3, 'md')).toBe('md:order-3');
    expect(buildOrderClass(1, 'lg')).toBe('lg:order-1');
  });
});

describe('isOrderClassAtBreakpoint', () => {
  it('matches numeric base order classes only when breakpoint undefined', () => {
    expect(isOrderClassAtBreakpoint('order-1', undefined)).toBe(true);
    expect(isOrderClassAtBreakpoint('order-12', undefined)).toBe(true);
    expect(isOrderClassAtBreakpoint('order-none', undefined)).toBe(true);
    expect(isOrderClassAtBreakpoint('order-first', undefined)).toBe(true);
    expect(isOrderClassAtBreakpoint('order-last', undefined)).toBe(true);
    expect(isOrderClassAtBreakpoint('order-[7]', undefined)).toBe(true);
  });

  it('does not match prefixed order classes when breakpoint undefined', () => {
    expect(isOrderClassAtBreakpoint('md:order-1', undefined)).toBe(false);
    expect(isOrderClassAtBreakpoint('lg:order-2', undefined)).toBe(false);
  });

  it('matches only the targeted breakpoint, not other variants', () => {
    expect(isOrderClassAtBreakpoint('md:order-1', 'md')).toBe(true);
    expect(isOrderClassAtBreakpoint('md:order-none', 'md')).toBe(true);
    expect(isOrderClassAtBreakpoint('md:order-[5]', 'md')).toBe(true);
    expect(isOrderClassAtBreakpoint('lg:order-1', 'md')).toBe(false);
    expect(isOrderClassAtBreakpoint('order-1', 'md')).toBe(false);
  });

  it('does not match unrelated tokens', () => {
    expect(isOrderClassAtBreakpoint('flex', undefined)).toBe(false);
    expect(isOrderClassAtBreakpoint('orderfoo', undefined)).toBe(false);
    expect(isOrderClassAtBreakpoint('border-2', undefined)).toBe(false);
    expect(isOrderClassAtBreakpoint('order-', undefined)).toBe(false);
  });
});

describe('applyOrderClassChange — base breakpoint', () => {
  it('appends order class when none present', () => {
    expect(applyOrderClassChange('flex p-4', 2, undefined)).toBe('flex p-4 order-2');
  });

  it('replaces existing base order class', () => {
    expect(applyOrderClassChange('flex order-1 p-4', 3, undefined)).toBe('flex p-4 order-3');
  });

  it('preserves md:order-N when changing base order', () => {
    expect(applyOrderClassChange('flex order-1 md:order-3 p-4', 2, undefined)).toBe('flex md:order-3 p-4 order-2');
  });

  it('removes order class when value is null', () => {
    expect(applyOrderClassChange('flex order-1 md:order-3 p-4', null, undefined)).toBe('flex md:order-3 p-4');
  });

  it('handles empty/undefined className', () => {
    expect(applyOrderClassChange('', 1, undefined)).toBe('order-1');
    expect(applyOrderClassChange(undefined, 1, undefined)).toBe('order-1');
  });

  it('normalises whitespace', () => {
    expect(applyOrderClassChange('  flex   order-1   p-4  ', 2, undefined)).toBe('flex p-4 order-2');
  });
});

describe('applyOrderClassChange — md breakpoint', () => {
  it('appends md:order-N without disturbing base order', () => {
    expect(applyOrderClassChange('order-1 flex', 3, 'md')).toBe('order-1 flex md:order-3');
  });

  it('replaces only md:order, leaves base + lg untouched', () => {
    expect(applyOrderClassChange('order-1 md:order-2 lg:order-5 flex', 4, 'md')).toBe(
      'order-1 lg:order-5 flex md:order-4',
    );
  });

  it('removes md:order when value is null, base preserved', () => {
    expect(applyOrderClassChange('order-1 md:order-2 lg:order-5 flex', null, 'md')).toBe('order-1 lg:order-5 flex');
  });
});
