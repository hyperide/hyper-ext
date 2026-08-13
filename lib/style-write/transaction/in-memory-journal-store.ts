/**
 * @file In-memory JournalStore — the default B0 WAL transport (master spec §9.1, HYP-722 T1a)
 *
 * Accessed via: WriteTransaction default journal store; unit tests assert on the journaled record.
 * Assumptions: single-process. This is NOT crash-durable on its own — a real realm injects a
 *   disk-fsynced / OPFS / server-FS JournalStore behind the same interface so crash recovery (a later
 *   task) survives a process kill. The in-memory store keeps the saga semantics testable without a
 *   filesystem and is the correct default for single-element single-process writes.
 *
 * Records are stored by deep clone on put() so a later in-place mutation of the caller's record
 * object cannot retroactively rewrite journal history (a real fsynced store has this property for
 * free; the in-memory store must clone to match it).
 */
import type { JournalRecord, JournalStore, WriteId } from './types';
import { TERMINAL_SAGA_STATES } from './types';

function cloneRecord(record: JournalRecord): JournalRecord {
  return {
    writeId: record.writeId,
    state: record.state,
    inversePatches: record.inversePatches.map((patch) => ({ ...patch })),
    hunks: { ...record.hunks },
    createdAt: record.createdAt,
  };
}

export class InMemoryJournalStore implements JournalStore {
  private readonly records = new Map<WriteId, JournalRecord>();

  async put(record: JournalRecord): Promise<void> {
    this.records.set(record.writeId, cloneRecord(record));
  }

  async get(writeId: WriteId): Promise<JournalRecord | undefined> {
    const record = this.records.get(writeId);
    return record ? cloneRecord(record) : undefined;
  }

  async listNonTerminal(): Promise<JournalRecord[]> {
    return [...this.records.values()].filter((record) => !TERMINAL_SAGA_STATES.has(record.state)).map(cloneRecord);
  }
}
