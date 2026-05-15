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
import { isForeignExtensionError, serializeRejectionReason } from '../extension-utils';

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

  it('includes enumerable own properties (e.g. code/errno/syscall/path on Node.js system errors)', () => {
    const err = Object.assign(new Error('ENOENT: no such file'), {
      code: 'ENOENT',
      errno: -2,
      syscall: 'open',
      path: '/tmp/missing.txt',
    });
    const result = serializeRejectionReason(err) as Record<string, unknown>;
    expect(result.code).toBe('ENOENT');
    expect(result.errno).toBe(-2);
    expect(result.syscall).toBe('open');
    expect(result.path).toBe('/tmp/missing.txt');
    expect(result.name).toBe('Error');
    expect(result.message).toBe('ENOENT: no such file');
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
    expect(result).toBe(String(obj));
  });
});

describe('isForeignExtensionError', () => {
  it('returns true for an Error with a stack from a foreign local extension', () => {
    const err = new Error('oops');
    err.stack = `Error: oops\n    at /Users/user/.vscode/extensions/github.copilot-chat-0.26.0/dist/extension.js:1:1`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns false for an Error with a stack from the HyperIDE extension', () => {
    const err = new Error('oops');
    err.stack = `Error: oops\n    at /Users/user/.vscode/extensions/hyperide.hypercanvas-0.1.8/out/extension.js:1:1`;
    expect(isForeignExtensionError(err)).toBe(false);
  });

  it('returns true for an Error with a stack from a remote-SSH extension path', () => {
    const err = new Error('remote');
    err.stack = `Error: remote\n    at /home/user/.vscode-server/extensions/ms-python.python-2024.0.1/out/main.js:1:1`;
    expect(isForeignExtensionError(err)).toBe(true);
  });

  it('returns false for an Error without an extension path in the stack', () => {
    const err = new Error('no ext');
    err.stack = `Error: no ext\n    at node:internal/process/task_queues:140:7`;
    expect(isForeignExtensionError(err)).toBe(false);
  });

  it('returns false for a non-Error string reason', () => {
    // String reason has no stack trace; origin is unknowable → log it (don't filter)
    expect(isForeignExtensionError('network timeout')).toBe(false);
  });
});
