import { describe, expect, test } from 'bun:test';
import { formatColorValues, matchHotkey } from './color-tooltip';

describe('formatColorValues', () => {
  test('generates all 4 formats for a token', () => {
    const values = formatColorValues('blue-500', '#3b82f6');
    expect(values).toHaveLength(4);
    expect(values[0]).toEqual({ label: 'blue-500', hotkey: 't', value: 'blue-500' });
    expect(values[1]).toEqual({ label: '#3b82f6', hotkey: '#', value: '#3b82f6' });
    expect(values[2].hotkey).toBe('r');
    expect(values[2].value).toMatch(/^rgb\(/);
    expect(values[3].hotkey).toBe('h');
    expect(values[3].value).toMatch(/^hsl\(/);
  });

  test('rgb values are correct', () => {
    const values = formatColorValues('red-500', '#ef4444');
    const rgb = values[2];
    expect(rgb.value).toBe('rgb(239, 68, 68)');
    expect(rgb.label).toBe('rgb(239, 68, 68)');
  });

  test('hsl values are correct for pure red', () => {
    const values = formatColorValues('red', '#ff0000');
    const hsl = values[3];
    expect(hsl.value).toBe('hsl(0, 100%, 50%)');
  });

  test('returns only token name for non-hex values (transparent)', () => {
    const values = formatColorValues('transparent', 'transparent');
    expect(values).toHaveLength(1);
    expect(values[0]).toEqual({ label: 'transparent', hotkey: 't', value: 'transparent' });
  });

  test('returns only token name for inherit', () => {
    const values = formatColorValues('inherit', 'inherit');
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('inherit');
  });

  test('returns only token name for currentColor', () => {
    const values = formatColorValues('currentColor', 'currentColor');
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe('currentColor');
  });
});

describe('matchHotkey', () => {
  const makeEvent = (key: string, code: string) => ({ key, code }) as KeyboardEvent;

  test('matches by key for letter hotkeys', () => {
    expect(matchHotkey(makeEvent('t', 'KeyT'), 't')).toBe(true);
    expect(matchHotkey(makeEvent('r', 'KeyR'), 'r')).toBe(true);
    expect(matchHotkey(makeEvent('h', 'KeyH'), 'h')).toBe(true);
  });

  test('matches by code for non-latin layouts (e.g. Russian)', () => {
    // Russian layout: KeyT produces 'е', KeyR produces 'к', KeyH produces 'р'
    expect(matchHotkey(makeEvent('е', 'KeyT'), 't')).toBe(true);
    expect(matchHotkey(makeEvent('к', 'KeyR'), 'r')).toBe(true);
    expect(matchHotkey(makeEvent('р', 'KeyH'), 'h')).toBe(true);
  });

  test('matches # by key fallback', () => {
    expect(matchHotkey(makeEvent('#', 'Digit3'), '#')).toBe(true);
  });

  test('does not match wrong keys', () => {
    expect(matchHotkey(makeEvent('x', 'KeyX'), 't')).toBe(false);
  });
});
