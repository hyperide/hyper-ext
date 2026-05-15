/**
 * @file Unit tests for serializeRejectionReason — the function that converts
 * an unhandled rejection / uncaught exception reason to a JSON-safe value
 * written to 'HyperIDE Diagnostics' output channel and the optional
 * HYPERIDE_DIAGNOSTIC_ERROR_SINK file.
 *
 * Accessed via: extension.ts activate() — process error handlers
 * Assumptions: pure function, no VS Code API dependencies
 */
import { describe, expect, it } from 'bun:test';
import { serializeRejectionReason } from '../extension-utils';

describe('serializeRejectionReason', () => {
  it('returns name/message/stack for a regular Error', () => {
    const err = new Error('boom');
    const result = serializeRejectionReason(err);
    expect(result).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof (result as { stack?: string }).stack).toBe('string');
  });

  it('returns name/message with undefined stack for Error without stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const result = serializeRejectionReason(err);
    expect(result).toMatchObject({ name: 'Error', message: 'no stack' });
    expect((result as { stack?: string }).stack).toBeUndefined();
  });

  it('preserves custom Error subclass name', () => {
    class CustomError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomError';
      }
    }
    const result = serializeRejectionReason(new CustomError('custom'));
    expect((result as { name: string }).name).toBe('CustomError');
  });

  it('returns JSON string for a plain object', () => {
    const result = serializeRejectionReason({ code: 42, detail: 'x' });
    expect(result).toBe('{"code":42,"detail":"x"}');
  });

  it('returns JSON string for a number', () => {
    expect(serializeRejectionReason(404)).toBe('404');
  });

  it('returns JSON string for a string primitive', () => {
    expect(serializeRejectionReason('network timeout')).toBe('"network timeout"');
  });

  it('returns JSON string for null', () => {
    expect(serializeRejectionReason(null)).toBe('null');
  });

  it('falls back to String() for undefined (JSON.stringify(undefined) returns undefined, not a string)', () => {
    expect(serializeRejectionReason(undefined)).toBe('undefined');
  });

  it('falls back to String() for circular reference objects', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = serializeRejectionReason(obj);
    // JSON.stringify throws on circular → fallback to String(obj)
    expect(typeof result).toBe('string');
    expect(result).toContain('[object Object]');
  });
});
