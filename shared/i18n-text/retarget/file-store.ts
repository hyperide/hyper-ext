/**
 * @file The injectable FileStore seam the retarget orchestrator runs over.
 *
 * Accessed via: orchestrator.run(ctx, store, req). The Docker backend injects NodeFileStore
 *   (node:fs + temp/rename + in-process mutex); the test suite injects an in-memory mock; Phase 2
 *   NodePod injects OpfsFileStore (OPFS + a SharedWorker/Atomics lock). The orchestrator NEVER
 *   touches fs directly — every read/write/lock goes through this interface, which is the whole
 *   point: the same orchestrator code is provably identical across transports.
 *
 * Invariant: withLock MUST serialize concurrent mutations that touch overlapping paths, and the
 *   write inside it MUST be atomic (no torn file on crash/interrupt). NodeFileStore guarantees
 *   this via an in-process path mutex + write-temp-then-rename. OPFS lock semantics are flagged
 *   for SRE review (the brainstorm had no independent SRE voice on cross-tab OPFS locking).
 */
export interface FileStore {
  /** Read a file's UTF-8 content. Rejects if absent. */
  read(path: string): Promise<string>;
  /** Atomically replace a file's content (temp + rename on Node). */
  write(path: string, content: string): Promise<void>;
  /** Content hash (telemetry only — never a write gate). */
  hash(path: string): Promise<string>;
  /**
   * Run `fn` while holding an exclusive lock over every path in `paths`. Concurrent withLock
   * calls whose path sets overlap run serially; disjoint sets may proceed in parallel.
   */
  withLock<T>(paths: string[], fn: () => Promise<T>): Promise<T>;
}
