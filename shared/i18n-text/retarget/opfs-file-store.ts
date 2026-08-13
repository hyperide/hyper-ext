/**
 * @file OpfsFileStore — Phase 2 STUB. The NodePod (in-browser) FileStore over the Origin Private
 *   File System. Defined now so the FileStore seam is provably pluggable; every method throws
 *   until Phase 2 implements OPFS + a cross-tab lock.
 *
 * Accessed via: (Phase 2) the NodePod service-worker intercept, which will inject this instead of
 *   NodeFileStore so the SAME orchestrator runs in the browser.
 *
 * TODO(Phase 2 / M3.5 — needs SRE eyes): implement over
 *   `navigator.storage.getDirectory()` + `FileSystemSyncAccessHandle`. Two hard parts the
 *   brainstorm flagged with NO independent SRE voice:
 *     1. ATOMIC WRITE: OPFS has no rename(2). Emulate temp+swap, or hold a single
 *        FileSystemSyncAccessHandle and truncate+write under the lock. Decide which gives a
 *        torn-read-free guarantee for the dev server reading the same file.
 *     2. CROSS-TAB LOCK: an in-process mutex (as NodeFileStore uses) does NOT serialize across
 *        browser tabs. Use the Web Locks API (`navigator.locks.request`) or an Atomics-based
 *        SharedWorker lock keyed by path. Confirm the chosen primitive actually blocks a second
 *        tab's withLock for the same path — this is the riskiest unverified assumption.
 */
import type { FileStore } from './file-store';

const NOT_IMPLEMENTED = 'OpfsFileStore is a Phase 2 stub — NodePod OPFS transport is not implemented yet';

export class OpfsFileStore implements FileStore {
  read(_path: string): Promise<string> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  write(_path: string, _content: string): Promise<void> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  hash(_path: string): Promise<string> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }

  withLock<T>(_paths: string[], _fn: () => Promise<T>): Promise<T> {
    return Promise.reject(new Error(NOT_IMPLEMENTED));
  }
}
