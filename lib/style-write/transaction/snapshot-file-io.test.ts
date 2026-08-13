/**
 * @file SnapshotFileIO + InMemoryJournalStore tests (spec §9.1 step 2 snapshot + the §9.5 WAL)
 *
 * Accessed via: bun test lib/style-write/transaction/snapshot-file-io.test.ts
 */
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { InMemoryFileIO } from '../testing/in-memory-file-io';
import { InMemoryJournalStore } from './in-memory-journal-store';
import { SnapshotFileIO } from './snapshot-file-io';
import { TERMINAL_SAGA_STATES } from './types';
import type { JournalRecord, WriteId } from './types';

const F = '/project/f.txt';
const G = '/project/g.txt';

describe('SnapshotFileIO — first-touch before-content capture (§9.1 step 2)', () => {
  it('captures before-content on first write and the latest after-content', async () => {
    const inner = new InMemoryFileIO({ [F]: 'before' });
    const fs = new SnapshotFileIO(inner);

    await fs.writeFile(F, 'after');

    const snapshot = fs.collect().find((s) => s.filePath === F);
    expect(snapshot?.beforeContent).toBe('before');
    expect(snapshot?.afterContent).toBe('after');
    expect(snapshot?.attempted).toBe(true);
  });

  it('marks the file attempted (a write target) even when the inner write throws', async () => {
    const inner: FileIO = {
      async readFile() {
        return 'before';
      },
      async writeFile() {
        throw new Error('boom');
      },
      async access() {},
    };
    const fs = new SnapshotFileIO(inner);

    await expect(fs.writeFile(F, 'after')).rejects.toThrow('boom');
    const snapshot = fs.collect().find((s) => s.filePath === F);
    // Marked attempted (set before the inner write) so it is a hunk the fail-closed CAS classifies on
    // rollback — never skipped as "never landed".
    expect(snapshot?.attempted).toBe(true);
  });

  it('before-content of a twice-written file is the content before the FIRST write', async () => {
    const inner = new InMemoryFileIO({ [F]: 'v0' });
    const fs = new SnapshotFileIO(inner);

    await fs.writeFile(F, 'v1');
    await fs.writeFile(F, 'v2');

    const snapshot = fs.collect().find((s) => s.filePath === F);
    expect(snapshot?.beforeContent).toBe('v0');
    expect(snapshot?.afterContent).toBe('v2');
  });

  it('captures before-content on a read even if the file is never written (afterContent null)', async () => {
    const inner = new InMemoryFileIO({ [F]: 'read-me' });
    const fs = new SnapshotFileIO(inner);

    await fs.readFile(F);

    const snapshot = fs.collect().find((s) => s.filePath === F);
    expect(snapshot?.beforeContent).toBe('read-me');
    expect(snapshot?.afterContent).toBeNull();
  });

  it('captures every file an apply touches across reads and writes', async () => {
    const inner = new InMemoryFileIO({ [F]: 'f0', [G]: 'g0' });
    const fs = new SnapshotFileIO(inner);

    await fs.readFile(F);
    await fs.writeFile(G, 'g1');

    const paths = fs
      .collect()
      .map((s) => s.filePath)
      .sort();
    expect(paths).toEqual([F, G]);
  });

  it('forwards writes to the inner FileIO (the apply actually mutates)', async () => {
    const inner = new InMemoryFileIO({ [F]: 'x' });
    const fs = new SnapshotFileIO(inner);

    await fs.writeFile(F, 'y');
    expect(inner.content(F)).toBe('y');
  });

  it('does NOT expose deleteFile even when the inner IO supports it (un-rollbackable delete guard)', async () => {
    // A delete is a structural change B0 rollback cannot restore in T1a, so the transactional FileIO
    // must not let an apply step delete a file it could not undo.
    const inner: FileIO = {
      async readFile() {
        return '';
      },
      async writeFile() {},
      async access() {},
      async deleteFile() {
        throw new Error('should never be reachable through SnapshotFileIO');
      },
    };
    const fs = new SnapshotFileIO(inner);
    expect(fs.deleteFile).toBeUndefined();
  });

  it('still forwards the non-destructive mkdir / listFiles when the inner IO supports them', async () => {
    const inner = new InMemoryFileIO({ [F]: 'f0', [G]: 'g0' });
    const fs = new SnapshotFileIO(inner);
    expect(typeof fs.listFiles).toBe('function');
    const listed = await fs.listFiles?.('/project');
    expect(listed?.sort()).toEqual([F, G]);
  });
});

describe('InMemoryJournalStore — durable-store contract (the §9.5 WAL abstraction)', () => {
  function record(writeId: string, state: JournalRecord['state']): JournalRecord {
    return { writeId: writeId as WriteId, state, inversePatches: [], hunks: {}, createdAt: 0 };
  }

  it('round-trips a record by writeId', async () => {
    const store = new InMemoryJournalStore();
    await store.put(record('w1', 'forward_in_progress'));
    expect((await store.get('w1' as WriteId))?.state).toBe('forward_in_progress');
  });

  it('clones on put so later mutation of the caller record does not rewrite history', async () => {
    const store = new InMemoryJournalStore();
    const rec = record('w1', 'open');
    await store.put(rec);
    rec.state = 'committed'; // mutate the caller's object AFTER put

    expect((await store.get('w1' as WriteId))?.state).toBe('open');
  });

  it('listNonTerminal returns only non-terminal records (the recovery scan input)', async () => {
    const store = new InMemoryJournalStore();
    await store.put(record('committed-1', 'committed'));
    await store.put(record('rolled-1', 'rolled_back'));
    await store.put(record('inflight-1', 'forward_in_progress'));
    await store.put(record('open-1', 'open'));

    const nonTerminal = (await store.listNonTerminal()).map((r) => r.writeId).sort();
    expect(nonTerminal).toEqual(['inflight-1', 'open-1'] as WriteId[]);
  });

  it('declares the full §9.1 state contract: HELD states are non-terminal (recovery rolls them back)', async () => {
    // The spec's held states (forward_applied_pending_verify, held_pending_repair) are NOT auto-replayed
    // but are NOT terminal either — a recovery scan must SEE them (to roll back with notice). Asserting
    // they appear in listNonTerminal proves the declared contract is wired into the terminal set.
    const store = new InMemoryJournalStore();
    await store.put(record('held-verify', 'forward_applied_pending_verify'));
    await store.put(record('held-repair', 'held_pending_repair'));
    await store.put(record('compensating-1', 'compensating'));
    await store.put(record('compensated-1', 'compensated')); // compensated IS terminal

    const nonTerminal = (await store.listNonTerminal()).map((r) => r.writeId).sort();
    expect(nonTerminal).toEqual(['compensating-1', 'held-repair', 'held-verify'] as WriteId[]);
    expect(TERMINAL_SAGA_STATES.has('compensated')).toBe(true);
    expect(TERMINAL_SAGA_STATES.has('forward_applied_pending_verify')).toBe(false);
    expect(TERMINAL_SAGA_STATES.has('held_pending_repair')).toBe(false);
  });
});
