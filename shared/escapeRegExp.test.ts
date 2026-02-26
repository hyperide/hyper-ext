import { describe, expect, it } from 'bun:test';
import { escapeRegExp } from './escapeRegExp';

describe('escapeRegExp', () => {
  it('escapes dots', () => {
    expect(escapeRegExp('file.txt')).toBe('file\\.txt');
  });

  it('escapes all special RegExp characters', () => {
    const specials = '.*+?^' + '${}()|[]\\';
    const escaped = escapeRegExp(specials);
    // Every special char should be preceded by a backslash
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });

  it('preserves alphanumeric strings unchanged', () => {
    expect(escapeRegExp('hello123')).toBe('hello123');
  });

  it('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });

  it('handles string with multiple consecutive specials', () => {
    expect(escapeRegExp('($$$)')).toBe('\\(\\$\\$\\$\\)');
  });

  it('produces a string safe for new RegExp()', () => {
    const input = 'price is $100.00 (USD)';
    const escaped = escapeRegExp(input);
    const regex = new RegExp(escaped);
    expect(regex.test(input)).toBe(true);
    expect(regex.test('price is X100Y00 ZUSDW')).toBe(false);
  });
});
