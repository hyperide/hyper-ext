/**
 * @file File-not-found detection for the B0 transaction (master spec §9.1, HYP-722 T1a)
 *
 * Accessed via: SnapshotFileIO (deciding whether a failed read means "file does not exist" vs a
 *   transient/permission error) and WriteTransaction (treating an already-absent created file as
 *   already-reverted on rollback).
 * Assumptions: the FileIO surface is realm-agnostic, so a missing file surfaces differently per
 *   transport — Node's `fs` throws an `Error` with `code === 'ENOENT'`; VS Code's `vscode.workspace.fs`
 *   throws a `FileSystemError` with `code === 'FileNotFound'`; the serverless/OPFS transport (NodePod
 *   `opfsFileIO`) throws a `DOMException` with `name === 'NotFoundError'`; the in-memory transport throws
 *   a plain `Error` whose message names the missing path ("File not found: …"). This helper recognizes
 *   ALL of these so a genuine not-found is never confused with a real I/O failure, which must propagate
 *   (a permission error misread as "absent" would make rollback delete a real file).
 */

/**
 * True when `error` represents a "file does not exist" condition across the FileIO transports.
 *
 * A structured `code`/`name` is AUTHORITATIVE and short-circuits — fail-closed: if `code`/`name` is
 * present and is NOT the not-found marker, return `false` immediately WITHOUT consulting the message
 * text. Otherwise a permission error (`EACCES`) whose path happens to contain "enoent"/"NotFoundError"
 * would be misread as absent, and rollback would delete a real file. The message regex is the fallback
 * ONLY for transports that throw a plain `Error` with no structured code (the in-memory IO).
 */
export function isFileNotFound(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    // Node fs throws `code === 'ENOENT'`; VS Code's `FileSystemError` throws `code === 'FileNotFound'`.
    // Both are authoritative structured codes for "absent path".
    if (typeof code === 'string') return code === 'ENOENT' || code === 'FileNotFound';
    // A DOMException's `name` is authoritative (OPFS/NodePod). A plain Error's name is the generic
    // 'Error', which is NOT authoritative — fall through to the message regex for those transports.
    if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
      return error.name === 'NotFoundError';
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /file not found|no such file|enoent|notfounderror/i.test(message);
}
