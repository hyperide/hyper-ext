/**
 * @file B0 write-transaction types — the saga journal contract (master spec §9.1, HYP-722 T1a)
 *
 * Accessed via: the WriteTransaction wrapper around the style-write executor; the journal store
 *   implementations (in-memory default + future server-FS / OPFS / vscode-file-io transports).
 * Assumptions: platform-independent — no VS Code, browser, or Node-specific imports here. The
 *   concrete FS transport is injected via FileIO; the durable journal store is injected via
 *   JournalStore so the same saga semantics run in all three realms (spec §9.1 "realm asymmetry is
 *   absorbed into one shared contract").
 *
 * Scope (T1a / B0 FOUNDATION): this module realizes the load-bearing, unit-testable core of the
 *   §9.1.0 invariants — one writeId per edit, a write-ahead journal of inverse patches snapshotted
 *   BEFORE the first forward patch, the four-way CAS classification governing every inverse
 *   application (invariant 3), terminal states that are never auto-replayed (invariant 5), and a
 *   surgical per-file rollback that is the inverse of our own hunk, never `git checkout`. The full
 *   distributed machinery the spec marks `design-intent` (fsync ordering proof, path-keyed mutation
 *   queue across concurrent writeIds, deadlock-free multi-file lock ordering, crash-recovery replay)
 *   is validated by the executable state-machine model per the §9.1.0 validation gate and is OUT OF
 *   SCOPE for this foundation commit — see the section header in write-transaction.ts.
 */

/** One writeId per B0 saga (spec §6.8 / §9.1). Branded so a raw string is not assignable. */
export type WriteId = string & { readonly __brand: 'WriteId' };

/**
 * Content hash of a file's bytes at a journaled point. The spec's identity sourceHash (§2.1) is a
 * git-blob hash; the B0 CAS hash is only an equality witness for "is the on-disk content still what
 * the journal recorded", so any stable content hash satisfies the contract. Branded to keep
 * before/after hashes from being confused with arbitrary strings.
 */
export type ContentHash = string & { readonly __brand: 'ContentHash' };

/**
 * Per-file inverse patch — the snapshot that the rollback restores. For B0 the inverse patch is the
 * full before-content of the touched file plus the before/after content hashes that the four-way CAS
 * classification (spec §9.1 step 5) compares the current on-disk content against.
 *
 *   - `beforeContent` / `beforeHash`: the snapshot taken before the first forward patch.
 *   - `beforeExisted`: false when the saga CREATED the file (it had no pre-saga content). Rollback of
 *     a created file must DELETE it, not write empty bytes — so this is tracked distinctly from a file
 *     whose genuine before-content was the empty string.
 *   - `attempted`: true when a forward write was ATTEMPTED on this file (vs a read-only touch). Set
 *     BEFORE the inner write so a write that mutates then THROWS is still recognized as a hunk. A
 *     read-only file has `attempted: false` and is not a hunk. The actual revert is FAIL-CLOSED CAS:
 *     the on-disk bytes must match `beforeHash` (skip — never landed) or `afterHash` (apply — restore);
 *     anything else is `revert-failed`, never force-restored over content we cannot account for.
 *   - `afterHash`: the content hash of the INTENDED after-content of our forward patch; `null` for a
 *     read-only file (no forward write). A write that threw partway may match neither hash → the CAS
 *     surfaces it as `revert-failed` rather than clobbering possibly-foreign content.
 */
export interface InversePatch {
  filePath: string;
  beforeContent: string;
  beforeExisted: boolean;
  attempted: boolean;
  beforeHash: ContentHash;
  afterHash: ContentHash | null;
}

/**
 * Per-hunk status under the saga header (spec §9.1 "per-hunk ledger"). For B0 the unit is one touched
 * file. The domain is rich enough to express every terminal the saga can reach so the saga terminal is
 * a pure function of the hunk multiset, NOT a parallel hand-maintained flag (spec §9.1 ledger table).
 *   - `committed`     — the forward patch landed and was kept.
 *   - `reverted`      — the inverse patch was applied (or the forward never landed: nothing to undo).
 *   - `compensated`   — a committed hunk was B3-unwound post-commit (the §9.6 visual-regression guard).
 *   - `superseded-skipped` — current content is a LATER committed writeId's after-hash; inverse skipped.
 *   - `revert-failed` — the inverse patch could not be applied (CAS fourth branch); stop-the-line.
 * T1a drives only `committed` / `reverted` / `superseded-skipped` / `revert-failed`; `compensated`
 * is declared for the B3 layer (spec §9.6) that consumes the same ledger.
 */
export type HunkStatus = 'committed' | 'reverted' | 'compensated' | 'superseded-skipped' | 'revert-failed';

/**
 * The saga state machine (spec §9.1). Transient states are auto-recoverable; HELD states are NOT
 * terminal and NOT auto-replayed (rolled back WITH a user notice on crash, §9.1 recovery table);
 * terminal states are NEVER auto-replayed (invariant 5). The FULL contract is declared here so the
 * later executable model + B1/B3 layers have one surface to prove against; T1a DRIVES only the subset
 * reachable from the single-process `open → forward_in_progress → committed | rolling_back →
 * rolled_back | partially_committed | rollback_failed` flow. The remaining members
 * (`snapshotted`, `compensating`, the held + `superseded`/`compensated` states) belong to
 * B1/B3/concurrency/crash-recovery and are DECLARED, not driven.
 */
export type SagaState =
  // transient (auto-recovered on crash)
  | 'open'
  | 'snapshotted'
  | 'forward_in_progress'
  | 'rolling_back'
  | 'compensating'
  // held (NOT terminal, NOT auto-replayed — rolled back with notice on crash, §9.1 table)
  | 'forward_applied_pending_verify'
  | 'held_pending_repair'
  // terminal (never auto-replayed)
  | 'committed'
  | 'rolled_back'
  | 'partially_committed'
  | 'rollback_failed'
  | 'superseded'
  | 'compensated';

/** The terminal saga states — recovery skips every one of these (spec §9.1.0 invariant 5). */
export const TERMINAL_SAGA_STATES: ReadonlySet<SagaState> = new Set<SagaState>([
  'committed',
  'rolled_back',
  'partially_committed',
  'rollback_failed',
  'superseded',
  'compensated',
]);

/**
 * The durable journal record for one writeId. In a real realm this is fsynced to disk before the
 * first forward patch (spec §9.1 step 3, the §9.5 WAL); the in-memory store keeps the same shape so
 * the saga logic is transport-agnostic.
 */
export interface JournalRecord {
  writeId: WriteId;
  state: SagaState;
  /** Per-file inverse patches, keyed by absolute file path. Recorded write-ahead. */
  inversePatches: InversePatch[];
  /** Per-file resolved status once the saga reaches a terminal state. */
  hunks: Record<string, HunkStatus>;
  createdAt: number;
}

/**
 * Durable store for journal records — the §9.1 WAL abstraction. The in-memory implementation is the
 * default for unit tests and single-process use; server-FS / OPFS / vscode-file-io transports provide
 * persistent implementations behind the SAME interface so crash recovery (a later task) can scan
 * non-terminal records uniformly.
 */
export interface JournalStore {
  put(record: JournalRecord): Promise<void>;
  get(writeId: WriteId): Promise<JournalRecord | undefined>;
  /** Every record whose state is NOT in the terminal set — the crash-recovery scan input (§9.1). */
  listNonTerminal(): Promise<JournalRecord[]>;
}
