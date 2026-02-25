import { describe, expect, it } from 'vitest';
import {
  formatSpacingValue,
  getCursorPart,
  getSpacingDisplayValue,
  handleSpacingArrowKey,
  handleSpacingInput,
  incrementSpacingValue,
  isPairedSpacing,
  isZeroValue,
  normalizeSpacingValue,
  parseNumericValue,
  parseSpacingValue,
  updateSpacingFromInput,
} from './spacingValue';

describe('spacingValue', () => {
  describe('parseSpacingValue', () => {
    it('should parse empty string', () => {
      expect(parseSpacingValue('')).toEqual({ first: '', second: '' });
    });

    it('should parse single value', () => {
      expect(parseSpacingValue('auto')).toEqual({ first: 'auto', second: 'auto' });
      expect(parseSpacingValue('1.5rem')).toEqual({ first: '1.5rem', second: '1.5rem' });
      expect(parseSpacingValue('0')).toEqual({ first: '0', second: '0' });
    });

    it('should parse comma-separated pair', () => {
      expect(parseSpacingValue('0, 1.5rem')).toEqual({ first: '0', second: '1.5rem' });
      expect(parseSpacingValue('1rem, 2rem')).toEqual({ first: '1rem', second: '2rem' });
      expect(parseSpacingValue('auto, 0')).toEqual({ first: 'auto', second: '0' });
    });

    it('should handle whitespace', () => {
      expect(parseSpacingValue('  0  ,  1.5rem  ')).toEqual({ first: '0', second: '1.5rem' });
      expect(parseSpacingValue('  auto  ')).toEqual({ first: 'auto', second: 'auto' });
    });

    it('should handle missing parts in comma-separated', () => {
      expect(parseSpacingValue(', 1.5rem')).toEqual({ first: '', second: '1.5rem' });
      expect(parseSpacingValue('1.5rem,')).toEqual({ first: '1.5rem', second: '' });
    });
  });

  describe('formatSpacingValue', () => {
    it('should format empty values', () => {
      expect(formatSpacingValue('', '')).toBe('');
    });

    it('should format same values as single', () => {
      expect(formatSpacingValue('auto', 'auto')).toBe('auto');
      expect(formatSpacingValue('1.5rem', '1.5rem')).toBe('1.5rem');
      expect(formatSpacingValue('0', '0')).toBe('0');
    });

    it('should format different values as pair', () => {
      expect(formatSpacingValue('0', '1.5rem')).toBe('0, 1.5rem');
      expect(formatSpacingValue('1rem', '2rem')).toBe('1rem, 2rem');
    });

    it('should use "0" for empty in pairs', () => {
      expect(formatSpacingValue('', '1.5rem')).toBe('0, 1.5rem');
      expect(formatSpacingValue('1.5rem', '')).toBe('1.5rem, 0');
    });
  });

  describe('isPairedSpacing', () => {
    it('should return false for same values', () => {
      expect(isPairedSpacing('auto', 'auto')).toBe(false);
      expect(isPairedSpacing('', '')).toBe(false);
      expect(isPairedSpacing('1.5rem', '1.5rem')).toBe(false);
    });

    it('should return true for different values', () => {
      expect(isPairedSpacing('0', '1.5rem')).toBe(true);
      expect(isPairedSpacing('', '1.5rem')).toBe(true);
      expect(isPairedSpacing('auto', '0')).toBe(true);
    });
  });

  describe('handleSpacingInput', () => {
    it('should handle comma-separated input', () => {
      expect(handleSpacingInput('0, 2rem', '', '')).toEqual({ first: '0', second: '2rem' });
      expect(handleSpacingInput('1rem, auto', 'auto', 'auto')).toEqual({ first: '1rem', second: 'auto' });
    });

    it('should sync values when they were equal before', () => {
      expect(handleSpacingInput('2rem', '1rem', '1rem')).toEqual({ first: '2rem', second: '2rem' });
      expect(handleSpacingInput('auto', '', '')).toEqual({ first: 'auto', second: 'auto' });
    });

    it('should only update first when values were different before', () => {
      expect(handleSpacingInput('3rem', '1rem', '2rem')).toEqual({ first: '3rem', second: '2rem' });
      expect(handleSpacingInput('0', '', '1.5rem')).toEqual({ first: '0', second: '1.5rem' });
    });
  });

  describe('normalizeSpacingValue', () => {
    it('should trim whitespace', () => {
      expect(normalizeSpacingValue('  auto  ')).toBe('auto');
      expect(normalizeSpacingValue('  1.5rem  ')).toBe('1.5rem');
    });

    it('should keep "0" as is', () => {
      expect(normalizeSpacingValue('0')).toBe('0');
      expect(normalizeSpacingValue('  0  ')).toBe('0');
    });

    it('should keep empty as empty', () => {
      expect(normalizeSpacingValue('')).toBe('');
      expect(normalizeSpacingValue('   ')).toBe('');
    });
  });

  describe('isZeroValue', () => {
    it('should return true for empty and "0"', () => {
      expect(isZeroValue('')).toBe(true);
      expect(isZeroValue('0')).toBe(true);
      expect(isZeroValue('  0  ')).toBe(true);
      expect(isZeroValue('   ')).toBe(true);
    });

    it('should return false for non-zero values', () => {
      expect(isZeroValue('auto')).toBe(false);
      expect(isZeroValue('1.5rem')).toBe(false);
      expect(isZeroValue('0px')).toBe(false);
    });
  });

  describe('getSpacingDisplayValue', () => {
    it('should return first value when linked (4 fields mode)', () => {
      expect(getSpacingDisplayValue('0', '1.5rem', true)).toBe('0');
      expect(getSpacingDisplayValue('auto', 'auto', true)).toBe('auto');
      expect(getSpacingDisplayValue('', '1.5rem', true)).toBe('');
    });

    it('should return formatted pair when not linked (2 fields mode)', () => {
      expect(getSpacingDisplayValue('0', '1.5rem', false)).toBe('0, 1.5rem');
      expect(getSpacingDisplayValue('auto', 'auto', false)).toBe('auto');
      expect(getSpacingDisplayValue('', '1.5rem', false)).toBe('0, 1.5rem');
    });
  });

  describe('updateSpacingFromInput', () => {
    describe('when linked (4 fields mode)', () => {
      it('should only update first value', () => {
        const result = updateSpacingFromInput('2rem', '1rem', '1.5rem', true);
        expect(result).toEqual({
          first: '2rem',
          second: '1.5rem',
          firstChanged: true,
          secondChanged: false,
        });
      });

      it('should not change if same value', () => {
        const result = updateSpacingFromInput('1rem', '1rem', '1.5rem', true);
        expect(result).toEqual({
          first: '1rem',
          second: '1.5rem',
          firstChanged: false,
          secondChanged: false,
        });
      });
    });

    describe('when not linked (2 fields mode)', () => {
      it('should parse comma-separated input', () => {
        const result = updateSpacingFromInput('1rem, 2rem', '0', '1.5rem', false);
        expect(result).toEqual({
          first: '1rem',
          second: '2rem',
          firstChanged: true,
          secondChanged: true,
        });
      });

      it('should sync values when they were equal', () => {
        const result = updateSpacingFromInput('2rem', '1rem', '1rem', false);
        expect(result).toEqual({
          first: '2rem',
          second: '2rem',
          firstChanged: true,
          secondChanged: true,
        });
      });

      it('should only update first when values were different', () => {
        const result = updateSpacingFromInput('3rem', '1rem', '2rem', false);
        expect(result).toEqual({
          first: '3rem',
          second: '2rem',
          firstChanged: true,
          secondChanged: false,
        });
      });
    });
  });

  describe('real-world scenarios', () => {
    it('should handle mx-auto mb-6 scenario', () => {
      // marginLeft = 'auto', marginRight = 'auto', marginTop = '', marginBottom = '1.5rem'

      // Display in 2-field mode
      expect(getSpacingDisplayValue('auto', 'auto', false)).toBe('auto'); // Hor
      expect(getSpacingDisplayValue('', '1.5rem', false)).toBe('0, 1.5rem'); // Vert

      // Display in 4-field mode
      expect(getSpacingDisplayValue('auto', 'auto', true)).toBe('auto'); // Left
      expect(getSpacingDisplayValue('', '1.5rem', true)).toBe(''); // Top
    });

    it('should handle editing comma-separated value', () => {
      // User sees "0, 1.5rem" and changes to "0.5rem, 2rem"
      const result = updateSpacingFromInput('0.5rem, 2rem', '', '1.5rem', false);
      expect(result.first).toBe('0.5rem');
      expect(result.second).toBe('2rem');
    });

    it('should handle editing single part of comma-separated', () => {
      // User sees "0, 1.5rem" and changes to "1rem" (removes comma)
      // Since values were different, only first updates
      const result = updateSpacingFromInput('1rem', '', '1.5rem', false);
      expect(result.first).toBe('1rem');
      expect(result.second).toBe('1.5rem');
    });
  });

  describe('getCursorPart', () => {
    it('should return "first" for single value', () => {
      expect(getCursorPart('auto', 0)).toBe('first');
      expect(getCursorPart('auto', 2)).toBe('first');
      expect(getCursorPart('1.5rem', 3)).toBe('first');
    });

    it('should return "first" when cursor is before comma', () => {
      expect(getCursorPart('0, 1.5rem', 0)).toBe('first');
      expect(getCursorPart('0, 1.5rem', 1)).toBe('first'); // at "0"
    });

    it('should return "second" when cursor is after comma', () => {
      expect(getCursorPart('0, 1.5rem', 2)).toBe('second'); // after comma
      expect(getCursorPart('0, 1.5rem', 3)).toBe('second'); // at space
      expect(getCursorPart('0, 1.5rem', 5)).toBe('second'); // in "1.5rem"
    });

    it('should handle edge cases', () => {
      expect(getCursorPart('', 0)).toBe('first');
      expect(getCursorPart(',', 0)).toBe('first');
      expect(getCursorPart(',', 1)).toBe('second');
    });
  });

  describe('parseNumericValue', () => {
    it('should parse px values', () => {
      expect(parseNumericValue('10px')).toEqual({ value: 10, unit: 'px' });
      expect(parseNumericValue('0px')).toEqual({ value: 0, unit: 'px' });
      expect(parseNumericValue('100px')).toEqual({ value: 100, unit: 'px' });
    });

    it('should parse rem values', () => {
      expect(parseNumericValue('1.5rem')).toEqual({ value: 1.5, unit: 'rem' });
      expect(parseNumericValue('0.25rem')).toEqual({ value: 0.25, unit: 'rem' });
      expect(parseNumericValue('2rem')).toEqual({ value: 2, unit: 'rem' });
    });

    it('should parse unitless values', () => {
      expect(parseNumericValue('0')).toEqual({ value: 0, unit: '' });
      expect(parseNumericValue('10')).toEqual({ value: 10, unit: '' });
    });

    it('should parse negative values', () => {
      expect(parseNumericValue('-10px')).toEqual({ value: -10, unit: 'px' });
      expect(parseNumericValue('-1.5rem')).toEqual({ value: -1.5, unit: 'rem' });
    });

    it('should return null for non-numeric values', () => {
      expect(parseNumericValue('auto')).toBe(null);
      expect(parseNumericValue('')).toBe(null);
      expect(parseNumericValue('abc')).toBe(null);
    });
  });

  describe('incrementSpacingValue', () => {
    it('should increment px values by 1', () => {
      expect(incrementSpacingValue('10px', 1)).toBe('11px');
      expect(incrementSpacingValue('10px', -1)).toBe('9px');
    });

    it('should increment rem values by 0.25', () => {
      expect(incrementSpacingValue('1.5rem', 1)).toBe('1.75rem');
      expect(incrementSpacingValue('1.5rem', -1)).toBe('1.25rem');
    });

    it('should not go below 0', () => {
      expect(incrementSpacingValue('0px', -1)).toBe('0px');
      expect(incrementSpacingValue('0.25rem', -1)).toBe('0rem');
    });

    it('should handle unitless values', () => {
      expect(incrementSpacingValue('5', 1)).toBe('6');
      expect(incrementSpacingValue('5', -1)).toBe('4');
    });

    it('should handle empty string', () => {
      expect(incrementSpacingValue('', 1)).toBe('1');
      expect(incrementSpacingValue('', -1)).toBe('0');
    });

    it('should not change "auto"', () => {
      expect(incrementSpacingValue('auto', 1)).toBe('auto');
      expect(incrementSpacingValue('auto', -1)).toBe('auto');
    });

    it('should use custom step', () => {
      expect(incrementSpacingValue('10px', 1, 5)).toBe('15px');
      expect(incrementSpacingValue('10px', -1, 5)).toBe('5px');
    });
  });

  describe('handleSpacingArrowKey', () => {
    describe('when linked (4 fields mode)', () => {
      it('should increment first value', () => {
        const result = handleSpacingArrowKey('10px', 0, '10px', '20px', 1, true);
        expect(result).toEqual({
          first: '11px',
          second: '20px',
          firstChanged: true,
          secondChanged: false,
        });
      });
    });

    describe('when not linked (2 fields mode)', () => {
      it('should increment first part when cursor is before comma', () => {
        // Cursor at position 0 in "0, 1.5rem" - before comma
        const result = handleSpacingArrowKey('0, 1.5rem', 0, '0', '1.5rem', 1, false);
        expect(result).toEqual({
          first: '1',
          second: '1.5rem',
          firstChanged: true,
          secondChanged: false,
        });
      });

      it('should increment second part when cursor is after comma', () => {
        // Cursor at position 3 in "0, 1.5rem" - after comma
        const result = handleSpacingArrowKey('0, 1.5rem', 3, '0', '1.5rem', 1, false);
        expect(result).toEqual({
          first: '0',
          second: '1.75rem',
          firstChanged: false,
          secondChanged: true,
        });
      });

      it('should decrement correctly', () => {
        const result = handleSpacingArrowKey('0, 1.5rem', 5, '0', '1.5rem', -1, false);
        expect(result).toEqual({
          first: '0',
          second: '1.25rem',
          firstChanged: false,
          secondChanged: true,
        });
      });
    });

    describe('real-world arrow key scenarios', () => {
      it('should handle "0, 1.5rem" with cursor in first part', () => {
        // marginTop = '', marginBottom = '1.5rem', display = "0, 1.5rem"
        // User clicks on "0" and presses up
        const result = handleSpacingArrowKey('0, 1.5rem', 1, '', '1.5rem', 1, false);
        expect(result.first).toBe('1');
        expect(result.second).toBe('1.5rem');
      });

      it('should handle "0, 1.5rem" with cursor in second part', () => {
        // User clicks on "1.5rem" and presses up
        const result = handleSpacingArrowKey('0, 1.5rem', 6, '', '1.5rem', 1, false);
        expect(result.first).toBe('');
        expect(result.second).toBe('1.75rem');
      });
    });
  });
});
