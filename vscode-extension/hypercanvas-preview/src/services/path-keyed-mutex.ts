/**
 * @file HYP-990 (M2) — a minimal per-key async mutex, used to SERIALIZE the non-forwarding
 * style-write saga (write → runtime-verify → rollback) per resolved file path.
 *
 * Why (master spec §9.1 "path-keyed mutation queue"): the M1 auto-wrap path
 * (`ast-update-utils.ts` `retargetNonForwardingWrite`) writes a wrapper to disk, polls the preview
 * iframe for several hundred milliseconds, then rolls back. That multi-second window is NOT
 * serialized: two overlapping style edits to the SAME file (a slider drag, or a second edit landing
 * while the first is still verifying) can interleave — the second wrap nests inside the first, or the
 * coarse whole-file undo tracker absorbs the second edit's bytes into the first edit's undo entry.
 * Serializing the whole saga per RESOLVED file path makes the two edits strictly sequential: the
 * second re-reads the first's committed content and operates on it, instead of racing it.
 *
 * This is the NARROW slice the M2 ticket (HYP-990) asks for — a single-process, in-memory,
 * FIFO-per-key lock — NOT the full distributed journaled saga (durable WAL, four-way CAS recovery,
 * deterministic multi-file lock ordering) the master spec marks `design-intent` / PLANNED. Different
 * keys never contend, so unrelated files still write concurrently.
 *
 * Invariants:
 *  - FIFO per key: callers acquire in call order (fair; no starvation of an early waiter).
 *  - The lock is released even if `fn` throws (so one failed saga never wedges the file forever).
 *  - An empty key chain is dropped from the map, so a long-lived editor session does not leak an
 *    entry per file ever touched.
 */

export class PathKeyedMutex {
  /** Per-key tail of the promise chain. Absent key = currently free. */
  private readonly _chains = new Map<string, Promise<void>>();

  /**
   * Run `fn` with exclusive access to `key`. Concurrent calls for the SAME key run strictly one at a
   * time in call order; calls for DIFFERENT keys run concurrently. The returned promise resolves (or
   * rejects) with `fn`'s result once it is this caller's turn and `fn` has settled.
   */
  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this._chains.get(key) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The next waiter chains onto THIS caller's completion (`mine`), so the queue is strict FIFO.
    const mine = prior.then(() => gate);
    this._chains.set(key, mine);

    // Wait for every earlier holder of this key to finish. `.catch` so a prior caller's rejection
    // (already surfaced to ITS own awaiter) does not poison this one's turn.
    await prior.catch(() => {});

    try {
      return await fn();
    } finally {
      release();
      // If no later waiter appended after us, this key is idle again — drop it so the map does not
      // grow unbounded across an editor session. A newer waiter would have replaced `mine` as the
      // stored tail, so the identity check keeps the still-contended key.
      if (this._chains.get(key) === mine) this._chains.delete(key);
    }
  }
}
