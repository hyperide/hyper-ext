import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock dom-utils
let mockComputedStyle: CSSStyleDeclaration | null = null;

mock.module('../dom-utils', () => ({
  getComputedStylesFromIframe: (_elementId: string, _instanceId?: string | null) => {
    if (!mockComputedStyle) return null;
    return mockComputedStyle;
  },
  getPreviewIframe: () => null,
}));

// Import after mocking
import {
  captureComputedStyles,
  detectUnchangedProperties,
  getCSSProperty,
  getUniqueCSSProperties,
} from '../style-change-detector';

describe('getCSSProperty', () => {
  it('should map shadow keys to boxShadow', () => {
    expect(getCSSProperty('shadow')).toBe('boxShadow');
    expect(getCSSProperty('shadowX')).toBe('boxShadow');
    expect(getCSSProperty('shadowY')).toBe('boxShadow');
    expect(getCSSProperty('shadowBlur')).toBe('boxShadow');
    expect(getCSSProperty('shadowSpread')).toBe('boxShadow');
    expect(getCSSProperty('shadowColor')).toBe('boxShadow');
    expect(getCSSProperty('shadowOpacity')).toBe('boxShadow');
  });

  it('should map layoutType to display', () => {
    expect(getCSSProperty('layoutType')).toBe('display');
  });

  it('should map blur to filter', () => {
    expect(getCSSProperty('blur')).toBe('filter');
  });

  it('should map border radius keys', () => {
    expect(getCSSProperty('borderRadiusTopLeft')).toBe('borderTopLeftRadius');
    expect(getCSSProperty('borderRadiusBottomRight')).toBe('borderBottomRightRadius');
  });

  it('should return identity for standard CSS properties', () => {
    expect(getCSSProperty('backgroundColor')).toBe('backgroundColor');
    expect(getCSSProperty('color')).toBe('color');
    expect(getCSSProperty('width')).toBe('width');
    expect(getCSSProperty('display')).toBe('display');
    expect(getCSSProperty('padding')).toBe('padding');
  });
});

describe('getUniqueCSSProperties', () => {
  it('should deduplicate shadow keys to single boxShadow', () => {
    const result = getUniqueCSSProperties(['shadowX', 'shadowY', 'shadowBlur', 'shadowColor']);
    expect(result).toEqual(['boxShadow']);
  });

  it('should preserve unique properties', () => {
    const result = getUniqueCSSProperties(['backgroundColor', 'color', 'width']);
    expect(result).toEqual(['backgroundColor', 'color', 'width']);
  });

  it('should deduplicate mixed keys', () => {
    const result = getUniqueCSSProperties(['shadowX', 'backgroundColor', 'shadowY']);
    expect(result).toEqual(['boxShadow', 'backgroundColor']);
  });

  it('should handle empty array', () => {
    expect(getUniqueCSSProperties([])).toEqual([]);
  });
});

describe('detectUnchangedProperties', () => {
  it('should return empty when all properties changed', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(255, 0, 0)', width: '200px' };
    expect(detectUnchangedProperties(before, after)).toEqual([]);
  });

  it('should return unchanged property names when values match', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(0, 0, 0)', width: '200px' };
    expect(detectUnchangedProperties(before, after)).toEqual(['color']);
  });

  it('should return all keys when nothing changed', () => {
    const before = { color: 'rgb(0, 0, 0)', width: '100px' };
    const after = { color: 'rgb(0, 0, 0)', width: '100px' };
    expect(detectUnchangedProperties(before, after)).toEqual(['color', 'width']);
  });

  it('should handle empty objects', () => {
    expect(detectUnchangedProperties({}, {})).toEqual([]);
  });
});

describe('captureComputedStyles', () => {
  beforeEach(() => {
    mockComputedStyle = null;
  });

  it('should return null when element not found', () => {
    mockComputedStyle = null;
    const result = captureComputedStyles('test-id', ['color']);
    expect(result).toBeNull();
  });

  it('should snapshot correct property values', () => {
    const values: Record<string, string> = {
      'background-color': 'rgb(255, 0, 0)',
      color: 'rgb(0, 0, 0)',
    };
    mockComputedStyle = {
      getPropertyValue: (prop: string) => values[prop] ?? '',
    } as unknown as CSSStyleDeclaration;

    const result = captureComputedStyles('test-id', ['backgroundColor', 'color']);
    expect(result).toEqual({
      backgroundColor: 'rgb(255, 0, 0)',
      color: 'rgb(0, 0, 0)',
    });
  });

  it('should handle properties with no value', () => {
    mockComputedStyle = {
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration;

    const result = captureComputedStyles('test-id', ['width']);
    expect(result).toEqual({ width: '' });
  });
});
