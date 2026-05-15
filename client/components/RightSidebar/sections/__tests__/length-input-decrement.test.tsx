/**
 * @file Numeric inspector input ArrowUp/ArrowDown helper tests
 *
 * Accessed via: Right sidebar > any numeric input (padding, margin, gap,
 *   width/height, position offsets) responding to ArrowUp/ArrowDown.
 * Assumptions: length values must clamp at 0 and never produce a unit-only
 *   string like "px" with no number.
 *
 * Bug: pressing ArrowDown twice on `2px` padding produced `-1px` first,
 * then CSS rejected the negative value, the parsed style went missing,
 * the input was reset to '', and the second ArrowDown landed in the
 * empty-leak branch and emitted `-1px` again. The bare-`px` rendering
 * reported in the memory note is reachable because nothing in this code
 * path enforced `newNum >= 0` for length properties.
 *
 * Cases:
 *   - `2px` → ArrowDown → `1px` (normal decrement, parser path)
 *   - `1px` → ArrowDown → `0px` (lands at 0)
 *   - `0px` → ArrowDown → `0px` (clamps, must not go negative)  ← RED until fix
 *   - `''`  → ArrowDown → `0px` (empty input, must not go negative) ← RED until fix
 *   - `20px` + shift → ArrowDown → `10px` (step=10 path still works)
 */

import { describe, expect, it } from 'bun:test';
import { computeNumericArrowValue } from '../../utils';

describe('computeNumericArrowValue — length decrement', () => {
  it('returns null for non-arrow keys', () => {
    expect(computeNumericArrowValue({ key: 'Enter', currentValue: '2px', styleKey: 'paddingTop' })).toBeNull();
  });

  it('decrements `2px` to `1px`', () => {
    expect(computeNumericArrowValue({ key: 'ArrowDown', currentValue: '2px', styleKey: 'paddingTop' })).toBe('1px');
  });

  it('decrements `1px` to `0px`', () => {
    expect(computeNumericArrowValue({ key: 'ArrowDown', currentValue: '1px', styleKey: 'paddingTop' })).toBe('0px');
  });

  it('clamps at 0 when current value is `0px`', () => {
    expect(computeNumericArrowValue({ key: 'ArrowDown', currentValue: '0px', styleKey: 'paddingTop' })).toBe('0px');
  });

  it('clamps at 0 when current value is empty', () => {
    expect(computeNumericArrowValue({ key: 'ArrowDown', currentValue: '', styleKey: 'paddingTop' })).toBe('0px');
  });

  it('preserves the step=10 (shift) decrement path on length', () => {
    expect(
      computeNumericArrowValue({
        key: 'ArrowDown',
        currentValue: '20px',
        styleKey: 'paddingTop',
        shiftKey: true,
      }),
    ).toBe('10px');
  });

  it('clamps step=10 (shift) decrement to 0 instead of going negative', () => {
    expect(
      computeNumericArrowValue({
        key: 'ArrowDown',
        currentValue: '5px',
        styleKey: 'paddingTop',
        shiftKey: true,
      }),
    ).toBe('0px');
  });

  it('still allows ArrowUp to increment past current value', () => {
    expect(computeNumericArrowValue({ key: 'ArrowUp', currentValue: '0px', styleKey: 'paddingTop' })).toBe('1px');
  });

  it('keeps opacity clamped to [0, 100] (regression guard for existing behaviour)', () => {
    expect(computeNumericArrowValue({ key: 'ArrowUp', currentValue: '100', styleKey: 'opacity' })).toBe('100');
    expect(computeNumericArrowValue({ key: 'ArrowDown', currentValue: '0', styleKey: 'opacity' })).toBe('0');
  });
});
