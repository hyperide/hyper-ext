/**
 * @file Tests for Tamagui style property validation
 */
import { describe, expect, it } from 'bun:test';
import { isValidTamaguiStyleProp, VALID_TAMAGUI_STYLE_PROPS } from '../style-props';

describe('VALID_TAMAGUI_STYLE_PROPS', () => {
  it('should contain core layout properties', () => {
    for (const prop of ['display', 'flex', 'flexDirection', 'alignItems', 'justifyContent', 'position']) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it('should contain spacing properties', () => {
    for (const prop of ['padding', 'paddingTop', 'margin', 'marginLeft', 'gap']) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it('should contain color properties', () => {
    for (const prop of ['backgroundColor', 'color', 'borderColor', 'shadowColor']) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it('should contain sizing properties', () => {
    for (const prop of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it('should contain text properties', () => {
    for (const prop of ['fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'fontFamily']) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it('should not contain unknown properties', () => {
    expect(VALID_TAMAGUI_STYLE_PROPS.has('foo')).toBe(false);
    expect(VALID_TAMAGUI_STYLE_PROPS.has('backgroundColour')).toBe(false);
    expect(VALID_TAMAGUI_STYLE_PROPS.has('class')).toBe(false);
  });
});

describe('isValidTamaguiStyleProp', () => {
  it('should return true for valid props', () => {
    expect(isValidTamaguiStyleProp('backgroundColor')).toBe(true);
    expect(isValidTamaguiStyleProp('flex')).toBe(true);
  });

  it('should return false for invalid props', () => {
    expect(isValidTamaguiStyleProp('foo')).toBe(false);
    expect(isValidTamaguiStyleProp('')).toBe(false);
  });
});
