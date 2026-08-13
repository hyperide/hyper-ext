/**
 * @file B0 write transaction — the journaled saga that brackets every style write (master spec §9.1)
 *
 * Accessed via: runStyleWriteTransaction (the executor integration) and directly by callers that own
 *   their own apply step. One WriteTransaction == one writeId == one B0 saga.
 * Assumptions: platform-independent. The FS transport is injected (FileIO); the durable WAL is
 *   injected (JournalStore, default in-memory). The transaction snapshots every file the apply step
 *   touches BEFORE the first forward patch is journaled as in-progress, commits on success, and on any
 *   failure rolls back EVERY touched file to its snapshot — surgically (the inverse of our own hunk),
 *   never `git checkout` — collapsing to one editor undo step.
 *
 * SCOPE — T1a / B0 FOUNDATION (read this before extending):
 *   IN:  one writeId; write-ahead journal of inverse patches (snapshot → forward_in_progress →
 *        commit | rollback); the four-way CAS classification governing every inverse application
 *        (§9.1 step 5 / invariant 3); per-file surgical restore; per-hunk ledger → derived saga
 *        terminal (§9.1 table); terminal states never auto-replayed (invariant 5); one-undo journal.
 *   OUT (explicitly deferred to later tasks, spec marks this machinery `design-intent` validated by
 *        an executable state-machine model per the §9.1.0 validation gate — NOT prose, NOT this
 *        foundation): the exact fsync ORDERING proof; the path-keyed mutation queue serializing
 *        concurrent writeIds on one file; deadlock-free multi-file lock ordering; live crash-recovery
 *        replay; B1 verify (forward_applied_pending_verify); B3 compensation (compensating /
 *        compensated); OD-11 held_pending_repair. The state machine and CAS branches are DECLARED in
 *        types.ts so the later executable model has one contract to prove against.
 */
import type { FileIO } from '@lib/ast/file-io';
import { classifyInverse } from './cas-classify';
import type { ContentHasher } from './content-hash';
import { isFileNotFound } from './fs-errors';
import { InMemoryJournalStore } from './in-memory-journal-store';
import { deriveRollbackTerminal } from './saga-terminal';
import { SnapshotFileIO } from './snapshot-file-io';
import type { HunkStatus, InversePatch, JournalRecord, JournalStore, SagaState, WriteId } from './types';

let writeIdCounter = 0;

/** Allocate one writeId for a B0 saga. Monotonic + random so two sagas in one process never collide. */
export function allocateWriteId(): WriteId {
  writeIdCounter += 1;
  return `w-${Date.now().toString(36)}-${writeIdCounter}-${Math.random().toString(36).slice(2, 8)}` as WriteId;
}

export interface WriteTransactionOptions {
  fileIO: FileIO;
  /**
   * The CAS content hasher. REQUIRED — the shared `WriteTransaction` stays browser-safe by never
   * importing a Node default. The Node realms pass `hashContent` from `content-hash.node`; a
   * browser/OPFS realm passes its own (e.g. SubtleCrypto-backed).
   */
  hasher: ContentHasher;
  journalStore?: JournalStore;
  writeId?: WriteId;
}

export interface RollbackResult {
  terminal: SagaState;
  hunks: Record<string, HunkStatus>;
  /** Files the CAS classified `revert-failed` — surfaced to the user, never silent debris (§9.1). */
  failedFiles: string[];
  /**
   * Set when persisting the journal record failed during rollback. The files WERE still reverted from
   * the in-memory snapshots (a journal-store outage never blocks the restoration); this surfaces that
   * the durable record is degraded.
   */
  journalError?: string;
}

export class WriteTransaction {
  readonly writeId: WriteId;
  private readonly innerFileIO: FileIO;
  private readonly fs: SnapshotFileIO;
  private readonly journalStore: JournalStore;
  private readonly hasher: ContentHasher;
  private record: JournalRecord;

  constructor(options: WriteTransactionOptions) {
    this.writeId = options.writeId ?? allocateWriteId();
    this.innerFileIO = options.fileIO;
    this.fs = new SnapshotFileIO(options.fileIO);
    this.journalStore = options.journalStore ?? new InMemoryJournalStore();
    this.hasher = options.hasher;
    this.record = {
      writeId: this.writeId,
      state: 'open',
      inversePatches: [],
      hunks: {},
      createdAt: Date.now(),
    };
  }

  /** The snapshotting FileIO the apply step MUST use so every touched file is captured (§9.1 step 2). */
  get fileIO(): FileIO {
    return this.fs;
  }

  get state(): SagaState {
    return this.record.state;
  }

  /**
   * Build the inverse patches from the captured snapshots (pure — never touches the journal store).
   *
   * KNOWN LIMITATION (deferred per the §9.1.0 validation gate, NOT a T1a deliverable): the spec's true
   * WAL persists the inverse patches with a fsync-ORDERED apply-intent BEFORE the first forward patch
   * mutates a file (invariant 1), which presupposes the file set is known up front (the frozen plan's
   * `writes[]`). T1a discovers the touched set DURING the apply (the executor reveals files as it touches
   * them through the snapshotting FileIO), so the durable record is written AFTER the forward patches.
   * The consequence — a crash between the forward write and the commit/rollback persist leaving edits
   * with no recoverable record — is closed only by the frozen-plan pre-snapshot + the fsync ordering
   * proof, which the spec routes to the executable state-machine model (out of scope for this
   * foundation). Commit persists a SINGLE terminal record (no orphan non-terminal record on put-failure);
   * a commit-journal failure is surfaced to the caller (`journalError`), never swallowed.
   */
  private buildInversePatches(): InversePatch[] {
    return this.fs.collect().map((snapshot) => ({
      filePath: snapshot.filePath,
      beforeContent: snapshot.beforeContent ?? '',
      beforeExisted: snapshot.beforeContent !== null,
      attempted: snapshot.attempted,
      beforeHash: this.hasher(snapshot.beforeContent ?? ''),
      // afterHash is the INTENDED after-content hash for an attempted write; null for a read-only file.
      afterHash: snapshot.attempted && snapshot.afterContent !== null ? this.hasher(snapshot.afterContent) : null,
    }));
  }

  /**
   * Commit the saga: persist a SINGLE `committed` record, marking every ATTEMPTED file `committed` (a
   * file the apply only READ is not a hunk). It does NOT pre-persist a `forward_in_progress` record:
   * if this one put fails, NO recoverable non-terminal record is left behind, so a future recovery scan
   * cannot roll back an edit the caller already saw succeed (the orphaned-`forward_in_progress` hole).
   * The inverse patches are captured in the same record so a successful commit is still one-undo-able.
   */
  async commit(): Promise<void> {
    const inversePatches = this.buildInversePatches();
    const hunks: Record<string, HunkStatus> = {};
    for (const patch of inversePatches) {
      if (patch.attempted) hunks[patch.filePath] = 'committed';
    }
    this.record = { ...this.record, state: 'committed', inversePatches, hunks };
    await this.journalStore.put(this.record);
  }

  /**
   * Roll back the saga: restore every ATTEMPTED file to its snapshot, surgically and CAS-guarded.
   *
   * Resilience (review P1): the file restoration is BEST-EFFORT and is NOT blocked by the durable
   * journal store. A `journalStore.put()` failure (the store is down) is captured and surfaced as
   * `journalError` AFTER every file has been reverted from the in-memory snapshots — it never throws
   * before reverting, which would leave half-written files on disk. The per-file inverse uses the ONE
   * four-way CAS rule; the saga terminal is DERIVED from the per-hunk statuses (§9.1 ledger table).
   */
  async rollback(): Promise<RollbackResult> {
    if (this.record.inversePatches.length === 0) {
      // Nothing journaled yet (apply threw before commit); capture whatever was touched. Build the
      // patches purely first so the in-memory revert can proceed even if the durable persist fails.
      this.record = { ...this.record, inversePatches: this.buildInversePatches() };
    }
    let journalError = await this.putBestEffort({ ...this.record, state: 'forward_in_progress' }, undefined);
    journalError = await this.putBestEffort({ ...this.record, state: 'rolling_back' }, journalError);

    const hunks: Record<string, HunkStatus> = {};
    const failedFiles: string[] = [];
    for (const patch of this.record.inversePatches) {
      if (!patch.attempted) continue; // read-only file: no forward patch to undo
      hunks[patch.filePath] = await this.revertOne(patch, failedFiles);
    }

    const terminal = deriveRollbackTerminal(Object.values(hunks));
    this.record = { ...this.record, state: terminal, hunks };
    journalError = await this.putBestEffort(this.record, journalError);
    return { terminal, hunks, failedFiles, journalError };
  }

  /**
   * Persist the record but NEVER let a journal-store failure abort the rollback. Updates the live
   * record on success; on failure keeps the first error message so the caller learns the durable
   * record is degraded (the in-memory rollback still completed).
   */
  private async putBestEffort(record: JournalRecord, priorError: string | undefined): Promise<string | undefined> {
    try {
      this.record = record;
      await this.journalStore.put(record);
      return priorError;
    } catch (error) {
      return priorError ?? (error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Revert one file. A read or write error during the revert (the file was deleted, made unreadable,
   * or the inverse write itself failed mid-rollback) is caught and resolved as `revert-failed` for
   * THIS hunk — never an exception that aborts the whole rollback and leaves the other clean hunks
   * un-reverted with no terminal record (the §9.1 "never silent debris, surface it" rule).
   */
  private async revertOne(patch: InversePatch, failedFiles: string[]): Promise<HunkStatus> {
    try {
      return await this.classifyAndApply(patch);
    } catch {
      failedFiles.push(patch.filePath);
      return 'revert-failed';
    }
  }

  private async classifyAndApply(patch: InversePatch): Promise<HunkStatus> {
    // CREATED file (no pre-saga content): the rollback target state is "file absent". Handle it BEFORE
    // any read — reading a not-yet-present or already-absent created file would throw and mis-classify
    // an already-correct state as `revert-failed`. If it is already gone, the rollback is achieved.
    if (!patch.beforeExisted) {
      return this.revertCreatedFile(patch);
    }
    // EVERY existing-file inverse is CAS-classified — FAIL-CLOSED (§9.1.0 invariant 3, "never force-apply
    // over content we cannot account for"). A write that threw partway leaves bytes matching neither our
    // before-hash nor our intended after-hash → `failed` → `revert-failed`, surfaced to the user; we do
    // NOT force-restore over content we cannot prove is ours, because that content might be a foreign
    // edit (an external editor / formatter-on-save) that landed before our write threw. Distinguishing
    // "our partial garbage" from "a foreign edit" by content alone is impossible without the per-file
    // ownership lock — the §9.1.0 `design-intent` machinery deferred to the executable model. The safe
    // T1a posture is to surface, never clobber. (A write that did NOT mutate leaves current==before →
    // `skip-not-landed` → reverted; a clean landed write → current==after → `apply`.)
    const currentHash = this.hasher(await this.innerFileIO.readFile(patch.filePath));
    // T1a is single-saga: no other committed writeId can own this span, so the supersession lookup is
    // a constant false. The hook exists so the cross-writeId task supplies a real journal lookup
    // WITHOUT changing this call site (the §9.1 "four sites share one rule" requirement).
    const outcome = classifyInverse(patch, currentHash, () => false);
    switch (outcome) {
      case 'apply':
        await this.applyInverse(patch);
        return 'reverted';
      case 'skip-not-landed':
        return 'reverted';
      case 'superseded':
        return 'superseded-skipped';
      case 'failed':
        throw new Error(`rollback_failed: unaccountable content at ${patch.filePath}`);
    }
  }

  /** Restore the before-content of a file that EXISTED pre-saga (the normal value-write inverse). */
  private async applyInverse(patch: InversePatch): Promise<void> {
    await this.innerFileIO.writeFile(patch.filePath, patch.beforeContent);
  }

  /**
   * Revert a file the saga CREATED. The target rollback state is "file absent". FAIL-CLOSED, CAS-guarded
   * so it NEVER deletes content it cannot account for (the same §9.1.0 invariant as the existing-file
   * inverse):
   *   - already gone (read throws not-found) → the desired state already holds → `reverted`, no-op.
   *   - our clean creation still on disk (current == afterHash) → DELETE it (never empty bytes).
   *   - anything ELSE (a partial/garbage create, OR a foreign process changed our created file before
   *     rollback — indistinguishable by content) → `revert-failed`; we never force-delete content we
   *     cannot prove is exactly what we wrote. Distinguishing the two needs the per-file ownership lock
   *     (the deferred §9.1.0 `design-intent` machinery), so the safe T1a posture is to surface, never
   *     force-delete.
   * If the FS transport cannot delete (no `deleteFile`), the creation cannot be cleanly undone → throw,
   * so `revertOne` surfaces it as `revert-failed`.
   */
  private async revertCreatedFile(patch: InversePatch): Promise<HunkStatus> {
    let current: string;
    try {
      current = await this.innerFileIO.readFile(patch.filePath);
    } catch (error) {
      if (isFileNotFound(error)) return 'reverted'; // already absent — rollback achieved
      throw error;
    }
    const isOurCleanCreation = patch.afterHash !== null && this.hasher(current) === patch.afterHash;
    if (!isOurCleanCreation) {
      throw new Error(`rollback_failed: unaccountable content at created file ${patch.filePath}`);
    }
    if (!this.innerFileIO.deleteFile) {
      throw new Error(`rollback_failed: cannot delete created file ${patch.filePath} (no deleteFile)`);
    }
    await this.innerFileIO.deleteFile(patch.filePath);
    return 'reverted';
  }

  /** The durable journal record for this saga (a clone — the live store owns the canonical copy). */
  async getRecord(): Promise<JournalRecord | undefined> {
    return this.journalStore.get(this.writeId);
  }
}
