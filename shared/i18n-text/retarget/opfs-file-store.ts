/**
 * @file OpfsFileStore — the NodePod (in-browser) FileStore over the Origin Private File System,
 *   used so the SAME retarget orchestrator that runs on the Docker backend (NodeFileStore) runs
 *   unchanged inside the serverless SaaS runtime (HYP-372 Phase 2 / HYP-746).
 *
 * Accessed via: the NodePod transport in client/lib/platform (createNodePodAstOperations →
 *   runRetargetInOpfs), which injects this into the shared handler when the active runtime is
 *   NodePod. The orchestrator NEVER touches a filesystem directly — read/write/hash/withLock all
 *   go through this seam, which is the whole point: identical policy code, two transports.
 *
 * OPFS path layout: files live under `hyper-nodepod/<projectId>/<project-relative path>`, the SAME
 *   layout client/lib/client-file-store/opfs.ts seeds and the NodePod pod mounts — so a retarget
 *   here mutates exactly the bytes the in-browser dev server is serving.
 *
 * Two durability guarantees the FileStore seam (and the SRE note on Phase 1) demand:
 *
 *   1. ATOMIC WRITE (torn-read-free). OPFS has no rename(2), and the non-standard
 *      FileSystemFileHandle.move() is unsupported in the repo's TS DOM lib. The portable atomic
 *      primitive OPFS DOES give is createWritable()+close(): a writable stream commits its bytes to
 *      the live file ATOMICALLY on close() (the implementation writes to an internal swap file and
 *      swaps it in on close, NOT truncate-in-place — we never pass { keepExistingData } and never
 *      seek, so the default replace-on-close applies). A reader's getFile() before close() sees the
 *      OLD content; after close(), the NEW — never a half-written mix. That closes the torn-read
 *      window for the dev server reading the same file. (If a future browser/runtime were found to
 *      truncate-in-place, the temp-file-then-content-copy fallback would be the next step; flagged.)
 *
 *   2. CROSS-TAB LOCK via the Web Locks API (navigator.locks). An in-process mutex (as
 *      NodeFileStore uses) does NOT serialize across browser tabs — two tabs of the same SaaS
 *      project share the SAME OPFS but are SEPARATE JS realms, so an in-proc Map can't see the
 *      other tab's pending write. navigator.locks IS scoped to the origin across all same-origin
 *      tabs/workers: an exclusive lock held in one tab blocks request() for the same name in
 *      another tab until released. We acquire one exclusive lock PER path (sorted, so two
 *      overlapping path sets can never deadlock by acquiring in opposite order) and run fn inside
 *      the innermost callback — navigator.locks holds each lock for exactly the duration of its
 *      callback's returned promise.
 *
 * Past-bug guard: the Phase-1 NodeFileStore note warns a naive truncate-write torn-reads HMR. The
 *   createWritable swap-on-close path here is the OPFS equivalent of temp+rename — chosen for the
 *   same reason.
 */
import type { FileStore } from './file-store';

/**
 * SHA-256 hex of a UTF-8 string via the Web Crypto API (crypto.subtle), so this module pulls ZERO
 * node:* builtins and stays bundleable for the browser/webview (HYP-747). Byte-identical to the
 * NodeFileStore's `createHash('sha256').update(content).digest('hex')`: both digest the same UTF-8
 * bytes with SHA-256, so the cross-transport parity the FileStore seam relies on holds. Hash is
 * telemetry-only (never a write gate), so the async digest fits the already-async `hash` signature.
 */
async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The slice of LockManager.request we use; typed locally so a missing DOM lib decl can't break us. */
type LockHeldCallback<T> = () => Promise<T>;
interface LockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, fn: LockHeldCallback<T>): Promise<T>;
}

export interface OpfsFileStoreOptions {
  /** The project id — files live under `hyper-nodepod/<projectId>/`. */
  projectId: string;
  /**
   * Resolve the OPFS root directory handle. Defaults to navigator.storage.getDirectory(). Injected
   * in tests (and overridable for a non-default storage root) so the store is unit-testable without
   * a real browser FS.
   */
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  /**
   * The Web Locks manager. Defaults to navigator.locks. Injected in tests; the cross-tab guarantee
   * comes from this being the REAL navigator.locks at runtime (origin-scoped across tabs).
   */
  locks?: LockManagerLike;
}

const NODEPOD_ROOT_DIR = 'hyper-nodepod';

function defaultGetRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export class OpfsFileStore implements FileStore {
  private readonly projectId: string;
  private readonly getRoot: () => Promise<FileSystemDirectoryHandle>;
  private readonly locks: LockManagerLike;

  constructor(options: OpfsFileStoreOptions) {
    this.projectId = options.projectId;
    this.getRoot = options.getRoot ?? defaultGetRoot;
    // navigator.locks is the cross-tab primitive; the cast narrows to the slice we use.
    this.locks = options.locks ?? (navigator.locks as unknown as LockManagerLike);
  }

  /** Resolve the project directory handle (hyper-nodepod/<projectId>/), creating when asked. */
  private async projectDir(create: boolean): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    const nodepod = await root.getDirectoryHandle(NODEPOD_ROOT_DIR, { create: true });
    return nodepod.getDirectoryHandle(this.projectId, { create });
  }

  /** Walk the project-relative path to its containing directory handle, returning [dir, filename]. */
  private async resolveFile(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; filename: string }> {
    const parts = path.split('/').filter((p) => p.length > 0 && p !== '.');
    if (parts.length === 0) throw new Error('OpfsFileStore: empty path');
    // Reject traversal segments explicitly rather than trusting the OPFS handle API to refuse a
    // '..' name — sandbox enforcement is ours, not the platform's. A '..' could otherwise escape
    // hyper-nodepod/<projectId>/ into another project's tree.
    if (parts.some((p) => p === '..')) throw new Error(`OpfsFileStore: path traversal rejected: ${path}`);
    let cur = await this.projectDir(create);
    for (const part of parts.slice(0, -1)) {
      cur = await cur.getDirectoryHandle(part, { create });
    }
    const filename = parts[parts.length - 1] as string;
    return { dir: cur, filename };
  }

  async read(path: string): Promise<string> {
    const { dir, filename } = await this.resolveFile(path, false);
    const fh = await dir.getFileHandle(filename, { create: false });
    const file = await fh.getFile();
    return file.text();
  }

  async hash(path: string): Promise<string> {
    const content = await this.read(path);
    return sha256Hex(content);
  }

  /**
   * Atomic replace via createWritable()+close() (OPFS swap-on-close). We create the file if absent
   * so the Phase-2 locale-JSON-first write can land a brand-new dictionary file.
   */
  async write(path: string, content: string): Promise<void> {
    const { dir, filename } = await this.resolveFile(path, true);
    const fh = await dir.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (err) {
      // close() commits; if write/close threw, abort discards the swap so the live file is intact.
      await writable.abort?.().catch(() => {});
      throw err;
    }
  }

  /**
   * Hold an exclusive Web Lock over EVERY path in `paths` for the duration of `fn`. Locks are
   * acquired in a stable sorted order so two overlapping path sets requested concurrently can never
   * deadlock by grabbing them in opposite orders. Each lock name namespaces the project so two
   * different projects never contend on a shared path string.
   */
  async withLock<T>(paths: string[], fn: LockHeldCallback<T>): Promise<T> {
    const names = [...new Set(paths)].sort().map((p) => `hyp-retarget:${this.projectId}:${p}`);
    // Acquire nested: each request() holds its lock for the lifetime of the inner promise, so by
    // the time fn runs we hold them all; they release in reverse as the callbacks unwind.
    const acquire = (i: number): Promise<T> => {
      const name = names[i];
      if (name === undefined) return fn();
      return this.locks.request(name, { mode: 'exclusive' }, () => acquire(i + 1));
    };
    return acquire(0);
  }
}
