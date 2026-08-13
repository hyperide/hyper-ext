/**
 * @file Snapshotting FileIO wrapper — the B0 "snapshot every touched file" mechanism (§9.1 step 2)
 *
 * Accessed via: WriteTransaction wraps the caller's FileIO in one of these before running the
 *   executor; after the run it reads back the snapshots to build the journal's inverse patches.
 * Assumptions: a file's FIRST observation (read, access, or write) is its before-snapshot. The spec
 *   takes the snapshot set as the union over the frozen plan's `writes[]` (§9.1 step 2); the executor
 *   reveals exactly that set as it touches files, so observing the first touch of each path captures
 *   the same union without re-deriving the plan here. The inline-floor write, the system write, and
 *   any wrapper file are all observed because every one of them goes through this FileIO.
 *
 * Why first-touch and not write-only: the executor READS a file (to parse its AST), then WRITES it.
 *   If we only snapshotted on write we would capture content the executor's own read already saw —
 *   correct here, but a file the executor reads-then-decides-not-to-write would never be snapshotted,
 *   and the before-content of a file written twice in one saga must be the content BEFORE the first
 *   write, not before the second. First-touch snapshotting captures the genuine pre-saga content.
 */
import type { FileIO } from '@lib/ast/file-io';
import { isFileNotFound } from './fs-errors';

/** The before/after content this wrapper captured for one touched file. */
export interface FileSnapshot {
  filePath: string;
  /** Content at first touch — `null` when the file did not exist before the saga (created write). */
  beforeContent: string | null;
  /** Latest content this wrapper wrote — `null` if the saga only read the file (never mutated it). */
  afterContent: string | null;
  /**
   * True once a forward write was ATTEMPTED on this path, set BEFORE the inner write runs (so a write
   * that mutates then THROWS is still recognized as a hunk, not skipped as "never landed"). It marks
   * the file as a write target vs a read-only touch; the actual revert is FAIL-CLOSED CAS-guarded in
   * WriteTransaction (the on-disk content must match a hash we recorded, else `revert-failed`), so no
   * separate "did the write resolve" flag is needed — a partial/foreign state simply fails the CAS.
   */
  attempted: boolean;
}

/**
 * Wraps a FileIO and records the first-touch before-content and last-written after-content of every
 * file the wrapped operation touches. The optional-method surface of FileIO (deleteFile, mkdir,
 * listFiles) is forwarded untouched; only read/write/access participate in snapshotting.
 */
export class SnapshotFileIO implements FileIO {
  private readonly snapshots = new Map<string, FileSnapshot>();

  // Optional FileIO surface — present only when the wrapped IO supports it (a wrapper that always
  // exposed these would advertise capabilities the inner IO lacks). Assigned in the constructor AFTER
  // `inner` is set; a class-field initializer would reference `inner` before it exists.
  //
  // `deleteFile` is DELIBERATELY NOT forwarded: a delete is a structural change B0 rollback does not
  // model in T1a, and exposing it would let an apply step delete a file through the transaction that
  // rollback could not restore. A caller that needs to delete must go around the transaction (and own
  // its own undo) until structural rollback lands. `mkdir`/`listFiles` are non-destructive (create a
  // directory / read a listing) and are forwarded so the executor's parser can use them.
  readonly mkdir?: (dirPath: string) => Promise<void>;
  readonly listFiles?: (dirPath: string, extensions?: string[]) => Promise<string[]>;

  constructor(private readonly inner: FileIO) {
    if (inner.mkdir) this.mkdir = (dirPath) => inner.mkdir!(dirPath);
    if (inner.listFiles) this.listFiles = (dirPath, extensions) => inner.listFiles!(dirPath, extensions);
  }

  private ensureSnapshot(filePath: string, beforeContent: string | null): FileSnapshot {
    let snapshot = this.snapshots.get(filePath);
    if (!snapshot) {
      snapshot = { filePath, beforeContent, afterContent: null, attempted: false };
      this.snapshots.set(filePath, snapshot);
    }
    return snapshot;
  }

  async readFile(absolutePath: string): Promise<string> {
    const content = await this.inner.readFile(absolutePath);
    this.ensureSnapshot(absolutePath, content);
    return content;
  }

  async access(absolutePath: string): Promise<void> {
    // A bare access proves the file exists but not its content; it is not itself a snapshot point.
    // The before-content is captured lazily on the first read or write of the path (writeFile reads
    // current content when the path is still unobserved), which is the genuine pre-saga content.
    await this.inner.access(absolutePath);
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    // Capture the genuine pre-saga content BEFORE the first write, by reading current disk content
    // when this path has not been observed yet. A non-existent file (created write) snapshots `null`.
    if (!this.snapshots.has(absolutePath)) {
      const beforeContent = await this.readInnerSafe(absolutePath);
      this.ensureSnapshot(absolutePath, beforeContent);
    }
    const snapshot = this.snapshots.get(absolutePath);
    // Mark the write ATTEMPTED and record the intended after-content BEFORE the inner write runs, so a
    // write that mutates then throws is still recognized as a hunk (not skipped as "never landed"). The
    // rollback decision is FAIL-CLOSED CAS in WriteTransaction — it restores only when the on-disk bytes
    // match a hash we recorded — so capturing the intended after-content here is all that is needed.
    if (snapshot) {
      snapshot.attempted = true;
      snapshot.afterContent = content;
    }
    await this.inner.writeFile(absolutePath, content);
  }

  private async readInnerSafe(absolutePath: string): Promise<string | null> {
    try {
      return await this.inner.readFile(absolutePath);
    } catch (error) {
      // ONLY a genuine "file does not exist" becomes a created-write snapshot (`null`). A transient,
      // permission, or transport read error on an EXISTING file must NOT be misread as non-existence —
      // that would set `beforeExisted=false` and make rollback DELETE the user's real file. Re-throw it
      // so the write aborts before mutating anything.
      if (isFileNotFound(error)) return null;
      throw error;
    }
  }

  /** Every file this wrapper observed, with its before/after content. */
  collect(): FileSnapshot[] {
    return [...this.snapshots.values()];
  }
}
