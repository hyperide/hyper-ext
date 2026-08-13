/**
 * @file isFileNotFound tests — B0 not-found detection across FileIO transports (spec §9.1, T1a)
 *
 * Accessed via: bun test lib/style-write/transaction/fs-errors.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { isFileNotFound } from './fs-errors';

describe('isFileNotFound', () => {
  it('detects a Node ENOENT error by code', () => {
    expect(isFileNotFound(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(true);
  });

  it("detects VS Code's FileSystemError by code (FileNotFound)", () => {
    // vscode.workspace.fs throws a FileSystemError with code 'FileNotFound' on a missing path —
    // the first-touch read of a brand-new file must be recognized as not-found, not a real I/O error.
    expect(isFileNotFound(Object.assign(new Error('Unable to read file'), { code: 'FileNotFound' }))).toBe(true);
  });

  it('detects the in-memory / OPFS "File not found" message', () => {
    expect(isFileNotFound(new Error('File not found: /project/a.txt'))).toBe(true);
  });

  it('detects a "no such file" message', () => {
    expect(isFileNotFound(new Error('no such file or directory'))).toBe(true);
  });

  it('detects an OPFS / NodePod DOMException by name (NotFoundError)', () => {
    // happy-dom / Node provide DOMException; fall back to a name-bearing object if absent.
    const domError =
      typeof DOMException === 'function'
        ? new DOMException('entry not found', 'NotFoundError')
        : Object.assign(new Error('entry not found'), { name: 'NotFoundError' });
    expect(isFileNotFound(domError)).toBe(true);
  });

  it('does NOT treat a permission error as not-found (must propagate)', () => {
    expect(isFileNotFound(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))).toBe(false);
  });

  it('a structured non-ENOENT code is authoritative even if the MESSAGE looks like not-found (review #3)', () => {
    // An EACCES error whose path/message happens to contain "ENOENT"/"NotFoundError" must NOT be
    // misread as absent — the code is authoritative and short-circuits the message regex.
    const tricky = Object.assign(new Error('EACCES on /var/enoent/NotFoundError.css'), { code: 'EACCES' });
    expect(isFileNotFound(tricky)).toBe(false);
  });

  it('a non-NotFound DOMException is authoritative even with a not-found-looking message (review #3)', () => {
    if (typeof DOMException !== 'function') return; // environment lacks DOMException
    const secErr = new DOMException('SecurityError reading /enoent path', 'SecurityError');
    expect(isFileNotFound(secErr)).toBe(false);
  });

  it('does NOT treat an arbitrary I/O error as not-found', () => {
    expect(isFileNotFound(new Error('disk read timeout'))).toBe(false);
  });

  it('handles a non-Error throw value', () => {
    expect(isFileNotFound('File not found')).toBe(true);
    expect(isFileNotFound('boom')).toBe(false);
  });
});
