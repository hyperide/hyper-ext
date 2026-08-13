/**
 * @file NodeFileStore — the real Docker-backend FileStore over node:fs.
 *
 * Accessed via: server/routes/retargetI18nKey.ts (the Docker transport). Implements the FileStore
 *   seam with two durability guarantees the orchestrator relies on:
 *     - withLock: an in-process, per-path async mutex chain. Concurrent retargets that touch the
 *       same file serialize; disjoint files proceed in parallel. This is a SINGLE-PROCESS lock —
 *       it does NOT coordinate across separate server processes/containers. The Docker backend
 *       runs one mutation worker per project sandbox, so an in-process lock is sufficient here;
 *       multi-process coordination (and the OPFS cross-tab equivalent) is flagged for SRE review.
 *     - write: atomic via write-to-temp-then-rename. rename(2) is atomic on the same filesystem,
 *       so a crash mid-write never leaves a torn source file (you get either the old or the new
 *       content, never a half-written one). The temp file sits in the same directory as the
 *       target so the rename stays intra-filesystem.
 *
 * Past-bug guard: an earlier naive fs.writeFile (see lib/ast/node-file-io.ts) is fine for the
 *   locale-JSON write but NOT for the JSX source a live dev server is watching — a torn read by
 *   HMR mid-write would crash the preview. Temp+rename closes that window.
 */
import { createHash } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FileStore } from './file-store';

export class NodeFileStore implements FileStore {
  /** path → tail of its lock chain. A new waiter appends to the chain and awaits the predecessor. */
  private readonly locks = new Map<string, Promise<unknown>>();

  async read(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  async hash(path: string): Promise<string> {
    const content = await readFile(path, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  }

  /** Atomic replace: write to a sibling temp file, then rename over the target. */
  async write(path: string, content: string): Promise<void> {
    const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
    try {
      await writeFile(tmp, content, 'utf-8');
      await rename(tmp, path);
    } catch (err) {
      // Best-effort cleanup of the temp file on failure; ignore if it's already gone.
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  /**
   * Serialize over the union of `paths`. We acquire one combined gate keyed by the sorted path
   * set so that two calls sharing ANY path serialize (their gates chain off the same per-path
   * tail), while fully-disjoint calls never block each other.
   */
  async withLock<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(paths)].sort();

    // Chain off the latest pending operation on every involved path.
    const predecessors = keys.map((k) => this.locks.get(k) ?? Promise.resolve());

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Install this gate as the new tail for each path. A later waiter on any of these paths will
    // await `gate`, so it cannot start until we release.
    for (const k of keys) {
      this.locks.set(k, gate);
    }

    // Wait for everyone ahead of us on any shared path.
    await Promise.all(predecessors);

    try {
      return await fn();
    } finally {
      release();
      // Clean up the map entry only if we're still the tail (no later waiter chained on).
      for (const k of keys) {
        if (this.locks.get(k) === gate) this.locks.delete(k);
      }
    }
  }
}
