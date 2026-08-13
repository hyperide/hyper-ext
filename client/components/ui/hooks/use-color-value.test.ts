import '../../../../test/setup-dom';
import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { normalizeHexInput, resolveTokenSelection, useColorValue } from './use-color-value';

// --- normalizeHexInput (pure function) ---

describe('normalizeHexInput', () => {
  test('adds # prefix to bare 6-digit hex', () => {
    expect(normalizeHexInput('ff0000')).toBe('#ff0000');
  });

  test('keeps existing # prefix on 6-digit hex', () => {
    expect(normalizeHexInput('#ff0000')).toBe('#ff0000');
  });

  test('accepts bare 3-digit hex', () => {
    expect(normalizeHexInput('abc')).toBe('#abc');
  });

  test('accepts 3-digit hex with #', () => {
    expect(normalizeHexInput('#abc')).toBe('#abc');
  });

  test('returns empty string for empty input', () => {
    expect(normalizeHexInput('')).toBe('');
  });

  test('returns empty string for bare #', () => {
    expect(normalizeHexInput('#')).toBe('');
  });

  test('returns null for invalid hex characters', () => {
    expect(normalizeHexInput('xyz')).toBeNull();
    expect(normalizeHexInput('gggggg')).toBeNull();
    expect(normalizeHexInput('#zzzzzz')).toBeNull();
  });

  test('returns null for wrong lengths', () => {
    expect(normalizeHexInput('ab')).toBeNull();
    expect(normalizeHexInput('abcd')).toBeNull();
    expect(normalizeHexInput('abcde')).toBeNull();
    expect(normalizeHexInput('1234567')).toBeNull();
    expect(normalizeHexInput('f')).toBeNull();
  });

  test('trims whitespace', () => {
    expect(normalizeHexInput('  ff0000  ')).toBe('#ff0000');
  });

  test('preserves case', () => {
    expect(normalizeHexInput('FF00AA')).toBe('#FF00AA');
  });

  test('# with whitespace trims to bare #, returns empty', () => {
    expect(normalizeHexInput('  #  ')).toBe('');
  });
});

// --- resolveTokenSelection (pure function) ---

describe('resolveTokenSelection', () => {
  test('resolves "none" to empty string with no hex', () => {
    const result = resolveTokenSelection('none', 'tailwind');
    expect(result.value).toBe('');
    expect(result.hex).toBeNull();
  });

  test('resolves special CSS values', () => {
    expect(resolveTokenSelection('transparent', 'tailwind').value).toBe('transparent');
    expect(resolveTokenSelection('inherit', 'tailwind').value).toBe('inherit');
    expect(resolveTokenSelection('currentColor', 'tailwind').value).toBe('currentColor');
  });

  test('resolves tailwind token to hex value', () => {
    const result = resolveTokenSelection('blue-500', 'tailwind');
    expect(result.value).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(result.hex).toBe(result.value);
  });

  test('resolves tailwind white/black', () => {
    expect(resolveTokenSelection('white', 'tailwind').value).toBe('#ffffff');
    expect(resolveTokenSelection('black', 'tailwind').value).toBe('#000000');
  });

  test('resolves tamagui token with $ prefix', () => {
    const result = resolveTokenSelection('blue9', 'tamagui');
    expect(result.value).toBe('$blue9');
    expect(result.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  test('returns token as-is when hex not found', () => {
    const result = resolveTokenSelection('nonexistent-999', 'tailwind');
    expect(result.value).toBe('nonexistent-999');
    expect(result.hex).toBeNull();
  });

  test('"none" handled for tamagui too', () => {
    expect(resolveTokenSelection('none', 'tamagui').value).toBe('');
  });
});

// --- useColorValue (React hook) ---

describe('useColorValue', () => {
  const onChange = mock();
  const addRecentColor = mock();

  function renderColorValue(value: string, tokenSystem: 'tailwind' | 'tamagui' = 'tailwind', isUnlinked?: boolean) {
    onChange.mockReset();
    addRecentColor.mockReset();
    return renderHook(({ v, ts, u }) => useColorValue(v, ts, u, onChange, addRecentColor), {
      initialProps: { v: value, ts: tokenSystem, u: isUnlinked },
    });
  }

  // --- isLinked ---
  test('isLinked is true for empty value', () => {
    const { result } = renderColorValue('');
    expect(result.current.isLinked).toBe(true);
  });

  test('isLinked is true when value matches a tailwind token', () => {
    const { result } = renderColorValue('#3b82f6'); // blue-500
    expect(result.current.isLinked).toBe(true);
  });

  test('isLinked is false when controlled via isUnlinked=true', () => {
    const { result } = renderColorValue('#ff0000', 'tailwind', true);
    expect(result.current.isLinked).toBe(false);
  });

  test('isLinked is true when controlled via isUnlinked=false', () => {
    const { result } = renderColorValue('#123456', 'tailwind', false);
    expect(result.current.isLinked).toBe(true);
  });

  test('isLinked is true for tamagui $ value', () => {
    const { result } = renderColorValue('$blue9', 'tamagui');
    expect(result.current.isLinked).toBe(true);
  });

  // --- currentHex ---
  test('currentHex is empty for empty value', () => {
    const { result } = renderColorValue('');
    expect(result.current.currentHex).toBe('');
  });

  test('currentHex passthrough for # values', () => {
    const { result } = renderColorValue('#ff0000');
    expect(result.current.currentHex).toBe('#ff0000');
  });

  test('currentHex resolves tailwind token to hex', () => {
    // blue-500 is a valid tailwind token
    const { result } = renderColorValue('#3b82f6');
    expect(result.current.currentHex).toBe('#3b82f6');
  });

  test('currentHex resolves tamagui $ token to hex', () => {
    const { result } = renderColorValue('$blue9', 'tamagui');
    expect(result.current.currentHex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  // --- currentToken ---
  test('currentToken is null for empty value', () => {
    const { result } = renderColorValue('');
    expect(result.current.currentToken).toBeNull();
  });

  test('currentToken finds tailwind token from hex', () => {
    const { result } = renderColorValue('#3b82f6');
    expect(result.current.currentToken).toBe('blue-500');
  });

  test('currentToken strips $ for tamagui', () => {
    const { result } = renderColorValue('$blue9', 'tamagui');
    expect(result.current.currentToken).toBe('blue9');
  });

  test('currentToken is null for arbitrary hex', () => {
    const { result } = renderColorValue('#123456');
    expect(result.current.currentToken).toBeNull();
  });

  // --- handleSelect ---
  test('handleSelect calls onChange with resolved value', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleSelect('red-500'));
    expect(onChange).toHaveBeenCalled();
    const calledWith = onChange.mock.calls[0][0] as string;
    expect(calledWith).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(addRecentColor).toHaveBeenCalled();
  });

  test('handleSelect with "none" calls onChange with empty string', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleSelect('none'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  test('handleSelect with "transparent" calls onChange with "transparent"', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleSelect('transparent'));
    expect(onChange).toHaveBeenCalledWith('transparent');
  });

  test('handleSelect with tamagui adds $ prefix', () => {
    const { result } = renderColorValue('$blue9', 'tamagui');
    act(() => result.current.handleSelect('red9'));
    expect(onChange).toHaveBeenCalled();
    const calledWith = onChange.mock.calls[0][0] as string;
    expect(calledWith.startsWith('$')).toBe(true);
  });

  // --- handleHexInput ---
  test('handleHexInput calls onChange for valid hex', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleHexInput('ff0000'));
    expect(onChange).toHaveBeenCalledWith('#ff0000');
    expect(addRecentColor).toHaveBeenCalledWith('#ff0000');
  });

  test('handleHexInput calls onChange with empty for empty input', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleHexInput(''));
    expect(onChange).toHaveBeenCalledWith('');
  });

  test('handleHexInput ignores invalid hex', () => {
    const { result } = renderColorValue('#3b82f6');
    act(() => result.current.handleHexInput('xyz'));
    expect(onChange).not.toHaveBeenCalled();
  });

  // --- handleUnlinkToggle ---
  test('handleUnlinkToggle from linked emits currentHex', () => {
    const { result } = renderColorValue('#3b82f6');
    expect(result.current.isLinked).toBe(true);
    act(() => result.current.handleUnlinkToggle());
    expect(onChange).toHaveBeenCalledWith('#3b82f6');
  });

  test('handleUnlinkToggle from unlinked finds closest token', () => {
    const { result } = renderColorValue('#3b82f6', 'tailwind', true);
    expect(result.current.isLinked).toBe(false);
    act(() => result.current.handleUnlinkToggle());
    expect(onChange).toHaveBeenCalled();
  });

  // --- Refs ---
  test('currentHexRef tracks currentHex', () => {
    const { result } = renderColorValue('#ff0000');
    expect(result.current.currentHexRef.current).toBe('#ff0000');
  });

  test('isLinkedRef tracks isLinked', () => {
    const { result } = renderColorValue('#3b82f6');
    expect(result.current.isLinkedRef.current).toBe(result.current.isLinked);
  });

  // --- Value sync ---
  test('syncs linked mode when value changes to hex', () => {
    const { result, rerender } = renderColorValue('#3b82f6');
    expect(result.current.isLinked).toBe(true);

    rerender({ v: '#123456', ts: 'tailwind', u: undefined });
    // #123456 doesn't match any token — should become unlinked
    expect(result.current.isLinked).toBe(false);
  });

  test('syncs linked mode when value changes to tamagui $token', () => {
    const { result, rerender } = renderHook(({ v, ts, u }) => useColorValue(v, ts, u, onChange, addRecentColor), {
      initialProps: { v: '#123456' as string, ts: 'tamagui' as const, u: undefined as boolean | undefined },
    });
    expect(result.current.isLinked).toBe(false);

    rerender({ v: '$blue9', ts: 'tamagui', u: undefined });
    expect(result.current.isLinked).toBe(true);
  });
});
