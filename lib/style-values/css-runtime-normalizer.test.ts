/**
 * @file Tests for CssRuntimeNormalizer — validates and normalizes CSS values using CSS.supports or static fallback
 *
 * Accessed via: bun run test lib/style-values/css-runtime-normalizer.test.ts
 * Assumptions: happy-dom's CSS.supports may be a no-op stub (always true) — tests must pass regardless
 *   of whether the native API or static fallback is used
 */
import { describe, expect, it } from 'bun:test';
import { cssRuntimeNormalizer } from './css-runtime-normalizer';

describe('cssRuntimeNormalizer', () => {
  describe('normalize — length properties', () => {
    it('appends px to bare number for padding-left', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '16' })).toEqual({
        kind: 'value',
        value: '16px',
      });
    });

    it('preserves value with px unit', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '16px' })).toEqual({
        kind: 'value',
        value: '16px',
      });
    });

    it('preserves rem unit', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'margin-top', value: '1rem' })).toEqual({
        kind: 'value',
        value: '1rem',
      });
    });

    it('accepts auto keyword', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'auto' })).toEqual({
        kind: 'value',
        value: 'auto',
      });
    });

    it('accepts percentage value', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: '50%' })).toEqual({
        kind: 'value',
        value: '50%',
      });
    });

    it('appends px to negative bare number', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'margin-left', value: '-8' })).toEqual({
        kind: 'value',
        value: '-8px',
      });
    });
  });

  describe('normalize — opacity', () => {
    it('accepts decimal opacity', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'opacity', value: '0.5' })).toEqual({
        kind: 'value',
        value: '0.5',
      });
    });

    it('accepts integer opacity', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'opacity', value: '1' })).toEqual({
        kind: 'value',
        value: '1',
      });
    });
  });

  describe('normalize — colors', () => {
    it('accepts hex color', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'background-color', value: '#4285f4' })).toEqual({
        kind: 'value',
        value: '#4285f4',
      });
    });

    it('accepts named color', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'color', value: 'red' })).toEqual({
        kind: 'value',
        value: 'red',
      });
    });

    it('accepts transparent', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'background-color', value: 'transparent' })).toEqual({
        kind: 'value',
        value: 'transparent',
      });
    });
  });

  describe('normalize — remove', () => {
    it('returns remove for empty string', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'padding-left', value: '' })).toEqual({
        kind: 'remove',
      });
    });
  });

  describe('normalize — invalid', () => {
    it('rejects nonsense value for width', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'foo' });
      expect(result.kind).toBe('invalid');
    });

    it('rejects another nonsense value for width', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'abc' });
      expect(result.kind).toBe('invalid');
    });
  });

  describe('normalize — cross-property validation', () => {
    it('rejects bare number for display (not a length property)', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'display', value: '1' });
      expect(result.kind).toBe('invalid');
    });

    it('rejects color value for width', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: 'red' });
      expect(result.kind).toBe('invalid');
    });

    it('rejects length value for display', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'display', value: '16px' });
      expect(result.kind).toBe('invalid');
    });

    it('rejects length value for position', () => {
      const result = cssRuntimeNormalizer.normalize({ cssProperty: 'position', value: '10px' });
      expect(result.kind).toBe('invalid');
    });

    it('accepts color for color property', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'color', value: 'blue' })).toEqual({
        kind: 'value',
        value: 'blue',
      });
    });

    it('accepts length for length property', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'width', value: '100px' })).toEqual({
        kind: 'value',
        value: '100px',
      });
    });
  });

  describe('normalize — unitless numeric properties', () => {
    it('preserves bare number for font-weight', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'font-weight', value: '700' })).toEqual({
        kind: 'value',
        value: '700',
      });
    });

    it('preserves bare number for flex-grow', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'flex-grow', value: '2' })).toEqual({
        kind: 'value',
        value: '2',
      });
    });
  });

  describe('normalize — enum/keyword properties', () => {
    it('accepts display flex', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'display', value: 'flex' })).toEqual({
        kind: 'value',
        value: 'flex',
      });
    });

    it('accepts position absolute', () => {
      expect(cssRuntimeNormalizer.normalize({ cssProperty: 'position', value: 'absolute' })).toEqual({
        kind: 'value',
        value: 'absolute',
      });
    });
  });
});
