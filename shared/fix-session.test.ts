import { describe, expect, it } from 'bun:test';
import { extractErrors, hasErrorsInLogs, hasSuccessInLogs } from './fix-session';

describe('hasErrorsInLogs', () => {
  it('detects TypeScript errors', () => {
    expect(hasErrorsInLogs('error TS2345: Argument of type...')).toBe(true);
  });

  it('detects SyntaxError', () => {
    expect(hasErrorsInLogs('SyntaxError: Unexpected token')).toBe(true);
  });

  it('detects Module not found (case insensitive)', () => {
    expect(hasErrorsInLogs('Module not found: Error')).toBe(true);
    expect(hasErrorsInLogs('module not found: something')).toBe(true);
  });

  it('detects Build failed', () => {
    expect(hasErrorsInLogs('Build failed with 2 errors')).toBe(true);
  });

  it('detects runtime errors (TypeError, ReferenceError)', () => {
    expect(hasErrorsInLogs('TypeError: Cannot read property')).toBe(true);
    expect(hasErrorsInLogs('ReferenceError: x is not defined')).toBe(true);
  });

  it('detects Cannot find module', () => {
    expect(hasErrorsInLogs("Cannot find module 'react'")).toBe(true);
  });

  it('detects Failed to compile', () => {
    expect(hasErrorsInLogs('Failed to compile.')).toBe(true);
  });

  it('returns false for clean output', () => {
    expect(hasErrorsInLogs('Server started on port 3000\nReady')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasErrorsInLogs('')).toBe(false);
  });
});

describe('hasSuccessInLogs', () => {
  it('detects "compiled successfully"', () => {
    expect(hasSuccessInLogs('compiled successfully in 200ms')).toBe(true);
  });

  it('detects "ready in 200ms"', () => {
    expect(hasSuccessInLogs('ready in 200ms')).toBe(true);
  });

  it('detects "✓ Ready"', () => {
    expect(hasSuccessInLogs('✓ Ready in 150ms')).toBe(true);
  });

  it('detects "built in 1500ms"', () => {
    expect(hasSuccessInLogs('built in 1500ms')).toBe(true);
  });

  it('detects Local: url pattern', () => {
    expect(hasSuccessInLogs('Local:   http://localhost:5173/')).toBe(true);
  });

  it('returns false for error-only logs', () => {
    expect(hasSuccessInLogs('error TS2345: something broke')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasSuccessInLogs('')).toBe(false);
  });
});

describe('extractErrors', () => {
  it('extracts single error with context lines', () => {
    const logs = [
      'Starting build...',
      'Processing files...',
      'error TS2345: Argument of type string',
      '  in file src/app.tsx',
      '  at line 42',
      'Done.',
    ].join('\n');

    const errors = extractErrors(logs);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('error TS2345');
    expect(errors[0]).toContain('in file src/app.tsx');
    expect(errors[0]).toContain('at line 42');
  });

  it('extracts multiple non-adjacent errors', () => {
    const logs = [
      'error TS2345: first error',
      'context 1a',
      'context 1b',
      'clean line 1',
      'clean line 2',
      'clean line 3',
      'SyntaxError: second error',
      'context 2a',
      'context 2b',
    ].join('\n');

    const errors = extractErrors(logs);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('first error');
    expect(errors[1]).toContain('second error');
  });

  it('skips context lines (no double-counting)', () => {
    // If error is on line 0 with context lines 1,2 — line 1 should not start a new error
    const logs = ['TypeError: cannot read property', 'is not a function', 'some other line'].join('\n');

    const errors = extractErrors(logs);
    // "is not a function" matches ERROR_PATTERNS but is inside the context of the first error
    // so it's skipped (i += 2)
    expect(errors).toHaveLength(1);
  });

  it('returns empty array for clean logs', () => {
    expect(extractErrors('Server started\nListening on port 3000')).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(extractErrors('')).toEqual([]);
  });

  it('handles error on last line (less than 3 lines of context)', () => {
    const logs = 'all good\nSyntaxError: oops';
    const errors = extractErrors(logs);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('SyntaxError: oops');
  });
});
