/**
 * @file B0 integration — wrap executeStyleWriteRequest in a write transaction (master spec §9.1, T1a)
 *
 * Accessed via: style-write endpoint callers (VS Code AstBridge, SaaS update route) that today call
 *   executeStyleWriteRequest directly; this is the drop-in transactional wrapper. The executor is
 *   UNCHANGED — the transaction wraps it, snapshotting every file the executor touches through an
 *   injected FileIO and rolling back ALL of them on any failure.
 * Assumptions: the caller passes the same ExecuteStyleWriteRequestInput it passes the executor today,
 *   MINUS the fileIO (the transaction supplies a snapshotting one). A caller that omitted fileIO got
 *   the executor's NodeFileIO default; here it passes through `baseFileIO` (default NodeFileIO) so the
 *   transaction can both snapshot and, on rollback, restore through the same underlying transport.
 *
 * Behavior: success → commit (files stay written, journal `committed`, result carries `writeId`).
 *   Failure result OR a thrown error → rollback EVERY touched file to its snapshot (surgical, CAS-
 *   guarded), and the result is the failure carrying `writeId` + the rollback terminal. A rollback
 *   that itself fails its CAS (foreign mutation) surfaces `failedFiles` — never silent debris.
 */
import type { FileIO } from '@lib/ast/file-io';
import { NodeFileIO } from '@lib/ast/node-file-io';
import type { ExecuteStyleWriteRequestInput, executeStyleWriteRequest } from '../style-write-executor';
import type { StyleWriteResult } from '../types';
import type { ContentHasher } from './content-hash';
import { hashContent } from './content-hash.node';
import type { JournalStore, SagaState, WriteId } from './types';
import { WriteTransaction } from './write-transaction';

/** A StyleWriteResult enriched with the B0 saga's writeId and (on failure) its rollback outcome. */
export type TransactionalStyleWriteResult = StyleWriteResult & {
  writeId: WriteId;
  /** Present only when the saga rolled back: the derived terminal + any files that could not revert. */
  rollback?: { terminal: SagaState; failedFiles: string[] };
  /**
   * Present only when the forward write SUCCEEDED but persisting the commit journal record failed. The
   * edit is KEPT (a bookkeeping failure must not discard a wanted write); this surfaces that the
   * durable one-undo record is degraded so the caller can warn the user.
   */
  journalError?: string;
};

export interface RunStyleWriteTransactionInput {
  /** The same input the caller passes the executor today, WITHOUT fileIO (the transaction owns it). */
  request: Omit<ExecuteStyleWriteRequestInput, 'fileIO'>;
  /** Executes one style-write request — injected so the executor module stays UNCHANGED. */
  execute: typeof executeStyleWriteRequest;
  /** Underlying FS transport (server-FS / vscode-file-io / OPFS). Defaults to NodeFileIO. */
  baseFileIO?: FileIO;
  /** Durable WAL. Defaults to the in-memory store (single-process). */
  journalStore?: JournalStore;
  /** CAS content hasher. Defaults to the Node `hashContent` (SHA-256 via `node:crypto`). */
  hasher?: ContentHasher;
  writeId?: WriteId;
}

export async function runStyleWriteTransaction(
  input: RunStyleWriteTransactionInput,
): Promise<TransactionalStyleWriteResult> {
  const transaction = new WriteTransaction({
    fileIO: input.baseFileIO ?? new NodeFileIO(),
    hasher: input.hasher ?? hashContent,
    journalStore: input.journalStore,
    writeId: input.writeId,
  });

  let result: StyleWriteResult;
  try {
    result = await input.execute({ ...input.request, fileIO: transaction.fileIO });
  } catch (error) {
    const rollback = await transaction.rollback();
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
      writeId: transaction.writeId,
      rollback: { terminal: rollback.terminal, failedFiles: rollback.failedFiles },
      journalError: rollback.journalError,
    };
  }

  if (result.success === false) {
    const rollback = await transaction.rollback();
    return {
      ...result,
      writeId: transaction.writeId,
      rollback: { terminal: rollback.terminal, failedFiles: rollback.failedFiles },
      journalError: rollback.journalError,
    };
  }

  try {
    await transaction.commit();
  } catch (error) {
    // The forward patches landed but persisting the commit record failed (journal-store I/O error).
    // We do NOT roll back a SUCCESSFUL write over a bookkeeping failure — that would discard the edit
    // the user wanted. The write is kept; the failure is surfaced via `journalError` so the caller can
    // warn that this edit's durable one-undo record is degraded (it can still be undone in-session via
    // the editor's own undo stack, just not recovered after a crash).
    return {
      ...result,
      writeId: transaction.writeId,
      journalError: error instanceof Error ? error.message : String(error),
    };
  }
  return { ...result, writeId: transaction.writeId };
}
