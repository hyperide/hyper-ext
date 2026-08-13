/**
 * @file Node public surface of the B0 write-transaction layer (master spec §9.1, HYP-722 T1a)
 *
 * Accessed via: the Node realms — server-backed SaaS update routes and the VS Code extension host —
 *   that wrap the Node style-write executor in a transaction. Re-exports the browser-safe surface plus
 *   the Node-only pieces (`runStyleWriteTransaction`, which imports NodeFileIO + the Node executor, and
 *   the `node:crypto` default hasher). A browser/OPFS realm imports `./index` instead and injects its
 *   own FileIO + hasher.
 */
export * from './index';
export { hashContent } from './content-hash.node';
export { runStyleWriteTransaction } from './run-style-write-transaction';
export type { RunStyleWriteTransactionInput, TransactionalStyleWriteResult } from './run-style-write-transaction';
