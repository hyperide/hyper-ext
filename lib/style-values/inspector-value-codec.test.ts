/**
 * @file Tests for InspectorValueCodec — validates and normalizes user input to canonical inspector form
 *
 * Accessed via: bun run test lib/style-values/inspector-value-codec.test.ts
 * Assumptions: codec only normalizes to inspector canonical form, target conversion is the adapter's job
 */
import { describe, expect, it } from 'bun:test';
import { inspectorValueCodec } from './inspector-value-codec';

describe('inspectorValueCodec', () => {
  describe('normalize — opacity', () => {
    it('passes through integer string', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '50' })).toEqual({
        kind: 'value',
        value: '50',
      });
    });

    it('strips % suffix', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '50%' })).toEqual({
        kind: 'value',
        value: '50',
      });
    });

    it('accepts number input', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: 50 })).toEqual({
        kind: 'value',
        value: '50',
      });
    });

    it('converts whole float to integer string', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '50.0' })).toEqual({
        kind: 'value',
        value: '50',
      });
    });

    it('preserves non-integer decimal', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '33.5' })).toEqual({
        kind: 'value',
        value: '33.5',
      });
    });

    it('clamps value above 100', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '150' })).toEqual({
        kind: 'value',
        value: '100',
      });
    });

    it('clamps value below 0', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '-10' })).toEqual({
        kind: 'value',
        value: '0',
      });
    });

    it('throws on non-numeric input', () => {
      expect(() => inspectorValueCodec.normalize({ key: 'opacity', value: 'foo' })).toThrow();
    });

    it('throws on bare percent sign', () => {
      expect(() => inspectorValueCodec.normalize({ key: 'opacity', value: '%' })).toThrow();
    });

    it('returns remove for empty string', () => {
      expect(inspectorValueCodec.normalize({ key: 'opacity', value: '' })).toEqual({
        kind: 'remove',
        value: '',
      });
    });
  });

  describe('normalize — lengths', () => {
    it('strips px suffix from paddingLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'paddingLeft', value: '16px' })).toEqual({
        kind: 'value',
        value: '16',
      });
    });

    it('passes through bare number for paddingLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'paddingLeft', value: '16' })).toEqual({
        kind: 'value',
        value: '16',
      });
    });

    it('accepts number input for width', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 16 })).toEqual({
        kind: 'value',
        value: '16',
      });
    });

    it('preserves auto keyword for width', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'auto' })).toEqual({
        kind: 'value',
        value: 'auto',
      });
    });

    it('preserves percentage for width', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: '50%' })).toEqual({
        kind: 'value',
        value: '50%',
      });
    });

    it('preserves rem unit for paddingLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'paddingLeft', value: '1rem' })).toEqual({
        kind: 'value',
        value: '1rem',
      });
    });

    it('preserves vh unit for height', () => {
      expect(inspectorValueCodec.normalize({ key: 'height', value: '100vh' })).toEqual({
        kind: 'value',
        value: '100vh',
      });
    });

    it('returns remove for empty string paddingLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'paddingLeft', value: '' })).toEqual({
        kind: 'remove',
        value: '',
      });
    });

    it('preserves fit-content keyword for width', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'fit-content' })).toEqual({
        kind: 'value',
        value: 'fit-content',
      });
    });

    it('preserves min-content keyword for width', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'min-content' })).toEqual({
        kind: 'value',
        value: 'min-content',
      });
    });

    it('passes through bare px unit as-is (non-numeric prefix)', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'px' })).toEqual({
        kind: 'value',
        value: 'px',
      });
    });

    it('passes through non-numeric px suffixed value as-is', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'apx' })).toEqual({
        kind: 'value',
        value: 'apx',
      });
    });

    it('preserves negative bare number for marginLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'marginLeft', value: '-8' })).toEqual({
        kind: 'value',
        value: '-8',
      });
    });

    it('strips px from negative value for marginLeft', () => {
      expect(inspectorValueCodec.normalize({ key: 'marginLeft', value: '-8px' })).toEqual({
        kind: 'value',
        value: '-8',
      });
    });

    it('handles fontSize as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'fontSize', value: '14px' })).toEqual({
        kind: 'value',
        value: '14',
      });
    });

    it('handles borderRadius as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'borderRadius', value: '4px' })).toEqual({
        kind: 'value',
        value: '4',
      });
    });

    it('handles borderTopLeftRadius as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'borderTopLeftRadius', value: '8px' })).toEqual({
        kind: 'value',
        value: '8',
      });
    });

    it('handles gap as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'gap', value: '12px' })).toEqual({
        kind: 'value',
        value: '12',
      });
    });

    it('handles rowGap as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'rowGap', value: '8px' })).toEqual({
        kind: 'value',
        value: '8',
      });
    });

    it('handles columnGap as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'columnGap', value: '16px' })).toEqual({
        kind: 'value',
        value: '16',
      });
    });

    it('handles letterSpacing as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'letterSpacing', value: '2px' })).toEqual({
        kind: 'value',
        value: '2',
      });
    });

    it('handles outlineWidth as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'outlineWidth', value: '1px' })).toEqual({
        kind: 'value',
        value: '1',
      });
    });

    it('handles outlineOffset as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'outlineOffset', value: '2px' })).toEqual({
        kind: 'value',
        value: '2',
      });
    });

    it('handles borderWidth as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'borderWidth', value: '1px' })).toEqual({
        kind: 'value',
        value: '1',
      });
    });

    it('handles borderTopWidth as length property', () => {
      expect(inspectorValueCodec.normalize({ key: 'borderTopWidth', value: '2px' })).toEqual({
        kind: 'value',
        value: '2',
      });
    });

    it('preserves em unit for fontSize', () => {
      expect(inspectorValueCodec.normalize({ key: 'fontSize', value: '1.2em' })).toEqual({
        kind: 'value',
        value: '1.2em',
      });
    });

    it('preserves none keyword for maxWidth', () => {
      expect(inspectorValueCodec.normalize({ key: 'maxWidth', value: 'none' })).toEqual({
        kind: 'value',
        value: 'none',
      });
    });

    it('preserves inherit keyword', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'inherit' })).toEqual({
        kind: 'value',
        value: 'inherit',
      });
    });

    it('preserves initial keyword', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'initial' })).toEqual({
        kind: 'value',
        value: 'initial',
      });
    });

    it('preserves unset keyword', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'unset' })).toEqual({
        kind: 'value',
        value: 'unset',
      });
    });

    it('preserves revert keyword', () => {
      expect(inspectorValueCodec.normalize({ key: 'width', value: 'revert' })).toEqual({
        kind: 'value',
        value: 'revert',
      });
    });
  });

  describe('normalize — colors', () => {
    it('passes through hex color for backgroundColor', () => {
      expect(inspectorValueCodec.normalize({ key: 'backgroundColor', value: '#4285f4' })).toEqual({
        kind: 'value',
        value: '#4285f4',
      });
    });

    it('passes through rgb() for color', () => {
      expect(inspectorValueCodec.normalize({ key: 'color', value: 'rgb(255, 0, 0)' })).toEqual({
        kind: 'value',
        value: 'rgb(255, 0, 0)',
      });
    });

    it('passes through named color for borderColor', () => {
      expect(inspectorValueCodec.normalize({ key: 'borderColor', value: 'red' })).toEqual({
        kind: 'value',
        value: 'red',
      });
    });

    it('passes through transparent for backgroundColor', () => {
      expect(inspectorValueCodec.normalize({ key: 'backgroundColor', value: 'transparent' })).toEqual({
        kind: 'value',
        value: 'transparent',
      });
    });

    it('returns remove for empty string backgroundColor', () => {
      expect(inspectorValueCodec.normalize({ key: 'backgroundColor', value: '' })).toEqual({
        kind: 'remove',
        value: '',
      });
    });
  });

  describe('normalize — enum properties', () => {
    it('passes through display flex', () => {
      expect(inspectorValueCodec.normalize({ key: 'display', value: 'flex' })).toEqual({
        kind: 'value',
        value: 'flex',
      });
    });

    it('passes through position absolute', () => {
      expect(inspectorValueCodec.normalize({ key: 'position', value: 'absolute' })).toEqual({
        kind: 'value',
        value: 'absolute',
      });
    });

    it('passes through flexDirection column', () => {
      expect(inspectorValueCodec.normalize({ key: 'flexDirection', value: 'column' })).toEqual({
        kind: 'value',
        value: 'column',
      });
    });

    it('returns remove for empty string display', () => {
      expect(inspectorValueCodec.normalize({ key: 'display', value: '' })).toEqual({
        kind: 'remove',
        value: '',
      });
    });
  });

  describe('format', () => {
    it('passes through opacity value', () => {
      expect(inspectorValueCodec.format({ key: 'opacity', value: '50' })).toBe('50');
    });

    it('passes through length value', () => {
      expect(inspectorValueCodec.format({ key: 'paddingLeft', value: '16' })).toBe('16');
    });

    it('passes through color value', () => {
      expect(inspectorValueCodec.format({ key: 'backgroundColor', value: '#4285f4' })).toBe('#4285f4');
    });

    it('passes through enum value', () => {
      expect(inspectorValueCodec.format({ key: 'display', value: 'flex' })).toBe('flex');
    });
  });
});
