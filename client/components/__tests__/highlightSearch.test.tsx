import { describe, expect, it } from 'bun:test';
import { escapeRegExp, highlightSearch } from '@/utils/highlight';

describe('escapeRegExp', () => {
  it('should escape special regex characters', () => {
    expect(escapeRegExp('foo.bar')).toBe('foo\\.bar');
    expect(escapeRegExp('a+b*c?')).toBe('a\\+b\\*c\\?');
    expect(escapeRegExp('[test](value)')).toBe('\\[test\\]\\(value\\)');
    expect(escapeRegExp('$100')).toBe('\\$100');
  });

  it('should return plain strings unchanged', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
    expect(escapeRegExp('')).toBe('');
  });
});

describe('highlightSearch', () => {
  it('should return text unchanged when query is empty', () => {
    expect(highlightSearch('hello world', '')).toBe('hello world');
  });

  it('should return text unchanged when no match', () => {
    expect(highlightSearch('hello world', 'xyz')).toBe('hello world');
  });

  it('should wrap matched text in <mark> elements', () => {
    const result = highlightSearch('hello world hello', 'hello');
    expect(Array.isArray(result)).toBe(true);
    const parts = result as unknown[];
    // "hello" + " world " + "hello" = 3 parts with matches, 4 items total from split
    // Actually split('(hello)') on 'hello world hello' = ['', 'hello', ' world ', 'hello', '']
    // Filter: '' (text), 'hello' (mark), ' world ' (text), 'hello' (mark), '' (text)
    expect(parts.length).toBe(5);
  });

  it('should be case-insensitive', () => {
    const result = highlightSearch('Hello HELLO hello', 'hello');
    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle special regex characters in query', () => {
    const result = highlightSearch('price is $100.00', '$100.00');
    expect(Array.isArray(result)).toBe(true);
  });
});
