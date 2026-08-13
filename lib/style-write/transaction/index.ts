/**
 * @file Browser-safe public surface of the B0 write-transaction layer (master spec §9.1, HYP-722 T1a)
 *
 * Accessed via: any realm — including the serverless/OPFS browser bundle — that drives a transaction
 *   with its OWN injected FileIO + hasher. This barrel has NO Node imports (`node:crypto`, NodeFileIO),
 *   so importing it never pulls Node-only code into a browser bundle.
 * Node-realm callers (server-backed SaaS, the VS Code extension host) import the Node entry
 *   `./index.node`, which adds `runStyleWriteTransaction` (wraps the Node executor) and the Node
 *   `hashContent` default. Splitting the two keeps the shared `lib/` core realm-agnostic (spec §9.1
 *   "realm asymmetry is absorbed into one shared contract; realms differ only in the FS transport").
 */
export { allocateWriteId, WriteTransaction } from './write-transaction';
export type { RollbackResult, WriteTransactionOptions } from './write-transaction';
export { InMemoryJournalStore } from './in-memory-journal-store';
export { SnapshotFileIO } from './snapshot-file-io';
export type { FileSnapshot } from './snapshot-file-io';
export type { ContentHasher } from './content-hash';
export { classifyInverse } from './cas-classify';
export type { CasOutcome } from './cas-classify';
export { deriveRollbackTerminal } from './saga-terminal';
export { isFileNotFound } from './fs-errors';
export { TERMINAL_SAGA_STATES } from './types';
export type { ContentHash, HunkStatus, InversePatch, JournalRecord, JournalStore, SagaState, WriteId } from './types';
