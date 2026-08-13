/**
 * @file WriteTransaction tests — B0 saga: snapshot, commit, surgical CAS-guarded rollback, journal
 *
 * Accessed via: bun test lib/style-write/transaction/write-transaction.test.ts
 * Assumptions: an apply step that mutates files THROUGH `transaction.fileIO` is correctly snapshotted;
 *   rollback restores byte-for-byte; the journal record is the durable one-undo source (spec §9.1).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileIO } from '@lib/ast/file-io';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { InMemoryFileIO } from '../testing/in-memory-file-io';
import { hashContent } from './content-hash.node';
import { InMemoryJournalStore } from './in-memory-journal-store';
import type { JournalRecord, JournalStore, WriteId } from './types';
import { allocateWriteId, WriteTransaction, type WriteTransactionOptions } from './write-transaction';

const A = '/project/a.txt';
const B = '/project/b.txt';

function makeFileIO(files: Record<string, string>): InMemoryFileIO {
  return new InMemoryFileIO(files);
}

/** Construct a transaction with the Node `hashContent` default so tests need not pass it each time. */
function makeTx(options: Omit<WriteTransactionOptions, 'hasher'> & { hasher?: WriteTransactionOptions['hasher'] }) {
  return new WriteTransaction({ hasher: hashContent, ...options });
}

/**
 * A FileIO that supports file CREATION and DELETION (the shared InMemoryFileIO refuses to write a
 * non-existent path). Used to exercise created-file rollback (delete) and read-error-on-rollback.
 */
class MutableFileIO implements FileIO {
  readonly files = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(initial)) this.files.set(p, c);
  }

  async readFile(p: string): Promise<string> {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  }

  async writeFile(p: string, content: string): Promise<void> {
    this.files.set(p, content); // creates the file if absent
  }

  async access(p: string): Promise<void> {
    if (!this.files.has(p)) throw new Error(`File not found: ${p}`);
  }

  async deleteFile(p: string): Promise<void> {
    this.files.delete(p);
  }

  has(p: string): boolean {
    return this.files.has(p);
  }

  content(p: string): string {
    const c = this.files.get(p);
    if (c === undefined) throw new Error(`File not found: ${p}`);
    return c;
  }
}

describe('allocateWriteId', () => {
  it('allocates unique writeIds', () => {
    const ids = new Set<WriteId>();
    for (let i = 0; i < 100; i += 1) ids.add(allocateWriteId());
    expect(ids.size).toBe(100);
  });
});

describe('WriteTransaction — commit', () => {
  it('keeps written files and journals a committed terminal with per-file hunks', async () => {
    const fileIO = makeFileIO({ [A]: 'old-a', [B]: 'old-b' });
    const journalStore = new InMemoryJournalStore();
    const tx = makeTx({ fileIO, journalStore });

    await tx.fileIO.writeFile(A, 'new-a');
    await tx.fileIO.writeFile(B, 'new-b');
    await tx.commit();

    expect(fileIO.content(A)).toBe('new-a');
    expect(fileIO.content(B)).toBe('new-b');
    expect(tx.state).toBe('committed');

    const record = await tx.getRecord();
    expect(record?.state).toBe('committed');
    expect(record?.hunks).toEqual({ [A]: 'committed', [B]: 'committed' });
    expect(record?.writeId).toBe(tx.writeId);
  });

  it('records the before-content as the inverse patch even on commit (one-undo journal)', async () => {
    const fileIO = makeFileIO({ [A]: 'before' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'after');
    await tx.commit();

    const record = await tx.getRecord();
    const patch = record?.inversePatches.find((p) => p.filePath === A);
    expect(patch?.beforeContent).toBe('before');
    expect(patch?.beforeHash).toBe(hashContent('before'));
    expect(patch?.afterHash).toBe(hashContent('after'));
  });

  it('does not journal a read-only file as a committed hunk', async () => {
    const fileIO = makeFileIO({ [A]: 'a', [B]: 'b' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.readFile(A); // read only — no forward patch
    await tx.fileIO.writeFile(B, 'b2');
    await tx.commit();

    const record = await tx.getRecord();
    expect(record?.hunks).toEqual({ [B]: 'committed' });
  });
});

describe('WriteTransaction — rollback restores every touched file byte-for-byte', () => {
  it('restores a single mutated file to its snapshot', async () => {
    const fileIO = makeFileIO({ [A]: 'original' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'mutated');
    expect(fileIO.content(A)).toBe('mutated');

    const result = await tx.rollback();
    expect(fileIO.content(A)).toBe('original');
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [A]: 'reverted' });
    expect(result.failedFiles).toEqual([]);
  });

  it('restores ALL files of a multi-file write together (atomic one-undo)', async () => {
    const fileIO = makeFileIO({ [A]: 'a-0', [B]: 'b-0' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'a-1');
    await tx.fileIO.writeFile(B, 'b-1');

    const result = await tx.rollback();
    expect(fileIO.content(A)).toBe('a-0');
    expect(fileIO.content(B)).toBe('b-0');
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [A]: 'reverted', [B]: 'reverted' });
  });

  it('restores a file written TWICE to the content before the FIRST write', async () => {
    const fileIO = makeFileIO({ [A]: 'genuine-pre-saga' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'intermediate');
    await tx.fileIO.writeFile(A, 'final');

    await tx.rollback();
    expect(fileIO.content(A)).toBe('genuine-pre-saga');
  });

  it('journals a rolled_back terminal record', async () => {
    const fileIO = makeFileIO({ [A]: 'original' });
    const journalStore = new InMemoryJournalStore();
    const tx = makeTx({ fileIO, journalStore });

    await tx.fileIO.writeFile(A, 'mutated');
    await tx.rollback();

    const record = await journalStore.get(tx.writeId);
    expect(record?.state).toBe('rolled_back');
    expect(record?.hunks).toEqual({ [A]: 'reverted' });
  });
});

describe('WriteTransaction — four-way CAS guards the inverse (spec §9.1 step 5)', () => {
  it('skips the inverse cleanly when current == before-hash (forward already reverted externally)', async () => {
    // We write A, then something external restores A to its EXACT before-content before rollback.
    // current == before-hash → the second CAS branch: nothing to undo, hunk resolves `reverted`.
    const fileIO = makeFileIO({ [A]: 'before-a' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'ours-a');
    await fileIO.writeFile(A, 'before-a'); // externally reverted to exactly the snapshot

    const result = await tx.rollback();
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [A]: 'reverted' });
    expect(fileIO.content(A)).toBe('before-a'); // unchanged — the inverse was correctly skipped
  });

  it('does not treat a read-only touched file as a hunk on rollback', async () => {
    const fileIO = makeFileIO({ [A]: 'x', [B]: 'b' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(B, 'b2'); // real forward patch on B
    await tx.fileIO.readFile(A); // read only — never a forward patch

    const result = await tx.rollback();
    expect(fileIO.content(A)).toBe('x');
    expect(fileIO.content(B)).toBe('b');
    expect(result.hunks).toEqual({ [B]: 'reverted' });
  });

  it('marks revert-failed and surfaces the file when content was foreign-mutated (CAS fourth branch)', async () => {
    const fileIO = makeFileIO({ [A]: 'original' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'ours');
    // Simulate a foreign mutation (formatter-on-save / another editor) AFTER our write, BEFORE rollback.
    await fileIO.writeFile(A, 'foreign-content-we-cannot-account-for');

    const result = await tx.rollback();
    expect(result.terminal).toBe('rollback_failed');
    expect(result.hunks).toEqual({ [A]: 'revert-failed' });
    expect(result.failedFiles).toEqual([A]);
    // NEVER force-applied over content we cannot account for — the foreign content stands.
    expect(fileIO.content(A)).toBe('foreign-content-we-cannot-account-for');
  });

  it('rollback_failed dominates a mixed ledger (one foreign-mutated, one clean)', async () => {
    const fileIO = makeFileIO({ [A]: 'a0', [B]: 'b0' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'a1');
    await tx.fileIO.writeFile(B, 'b1');
    await fileIO.writeFile(B, 'foreign'); // B foreign-mutated

    const result = await tx.rollback();
    expect(result.terminal).toBe('rollback_failed');
    expect(result.hunks[A]).toBe('reverted');
    expect(result.hunks[B]).toBe('revert-failed');
    expect(result.failedFiles).toEqual([B]);
    expect(fileIO.content(A)).toBe('a0'); // the clean file still reverted (no punitive cross-file)
  });
});

describe('WriteTransaction — created-file rollback DELETES, never leaves an empty file (review P1)', () => {
  const NEW = '/project/new.txt';

  it('deletes a file the saga created when rolling back', async () => {
    const fileIO = new MutableFileIO(); // NEW does not exist
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(NEW, 'created-content');
    expect(fileIO.has(NEW)).toBe(true);

    const result = await tx.rollback();
    expect(fileIO.has(NEW)).toBe(false); // deleted, NOT left as an empty file
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [NEW]: 'reverted' });
  });

  it('marks revert-failed when a created file cannot be deleted (FS transport lacks deleteFile)', async () => {
    // A creation-capable FileIO with NO deleteFile — rollback cannot cleanly undo a creation.
    class NoDeleteFileIO extends MutableFileIO {}
    const fileIO = new NoDeleteFileIO();
    // Strip deleteFile so the transport advertises no deletion capability.
    Object.defineProperty(fileIO, 'deleteFile', { value: undefined });

    const tx = makeTx({ fileIO });
    await tx.fileIO.writeFile(NEW, 'created');

    const result = await tx.rollback();
    expect(result.terminal).toBe('rollback_failed');
    expect(result.hunks).toEqual({ [NEW]: 'revert-failed' });
    expect(result.failedFiles).toEqual([NEW]);
  });

  it('treats an already-absent created file as reverted, not revert-failed (review #2)', async () => {
    const fileIO = new MutableFileIO();
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(NEW, 'created');
    await fileIO.deleteFile(NEW); // the created file is already gone before rollback

    const result = await tx.rollback();
    // The desired rollback state (file absent) already holds — a no-op revert, not a failure.
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [NEW]: 'reverted' });
    expect(result.failedFiles).toEqual([]);
  });

  it('does NOT force-delete a created file a foreign process changed (CAS-guarded, review P1)', async () => {
    const fileIO = new MutableFileIO();
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(NEW, 'our-created-content');
    await fileIO.writeFile(NEW, 'foreign-rewrote-this-file'); // external change before rollback

    const result = await tx.rollback();
    // Content we cannot account for is NEVER force-deleted — surfaced, not silently removed.
    expect(result.terminal).toBe('rollback_failed');
    expect(result.hunks).toEqual({ [NEW]: 'revert-failed' });
    expect(result.failedFiles).toEqual([NEW]);
    expect(fileIO.content(NEW)).toBe('foreign-rewrote-this-file'); // preserved
  });
});

describe('WriteTransaction — a non-not-found read error never masquerades as "created" (review #1)', () => {
  it('aborts the write (does not snapshot beforeExisted=false) on a permission/transport read error', async () => {
    // An EXISTING file whose read fails with a permission error must NOT be mistaken for "absent" —
    // that would set beforeExisted=false and make rollback DELETE the user's real file.
    const permissionError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const flaky: FileIO = {
      async readFile() {
        throw permissionError;
      },
      async writeFile() {
        throw new Error('should not be reached — the read error must abort first');
      },
      async access() {},
    };
    const tx = makeTx({ fileIO: flaky });

    // The first write reads current content to snapshot it; a non-not-found read error propagates.
    await expect(tx.fileIO.writeFile(A, 'x')).rejects.toThrow('EACCES');
  });
});

describe('WriteTransaction — a read error mid-rollback fails only THAT hunk (review P1)', () => {
  it('does not abort the whole rollback when one file became unreadable', async () => {
    const fileIO = new MutableFileIO({ [A]: 'a0', [B]: 'b0' });
    const tx = makeTx({ fileIO });

    await tx.fileIO.writeFile(A, 'a1');
    await tx.fileIO.writeFile(B, 'b1');
    // B is externally DELETED before rollback — readFile(B) will throw inside the revert.
    await fileIO.deleteFile(B);

    const result = await tx.rollback();
    // A still reverts cleanly; B is a surfaced failure, not an exception that aborted everything.
    expect(fileIO.content(A)).toBe('a0');
    expect(result.hunks[A]).toBe('reverted');
    expect(result.hunks[B]).toBe('revert-failed');
    expect(result.failedFiles).toEqual([B]);
    expect(result.terminal).toBe('rollback_failed');
  });
});

describe('WriteTransaction — a commit journal-put failure does not corrupt the state machine (review P1)', () => {
  it('propagates the journal-store error from commit (the write stays on disk)', async () => {
    const fileIO = makeFileIO({ [A]: 'original' });
    const flakyStore: JournalStore = {
      async put(record: JournalRecord) {
        if (record.state === 'committed') throw new Error('disk full');
      },
      async get() {
        return undefined;
      },
      async listNonTerminal() {
        return [];
      },
    };
    const tx = makeTx({ fileIO, journalStore: flakyStore });

    await tx.fileIO.writeFile(A, 'new');
    await expect(tx.commit()).rejects.toThrow('disk full');
    expect(fileIO.content(A)).toBe('new'); // the forward write is NOT rolled back by a journal failure
  });
});

describe('WriteTransaction — a throwing write is FAIL-CLOSED: never clobbers unaccountable content (review P1)', () => {
  it('surfaces revert-failed (does not auto-restore) when a write left half-written garbage', async () => {
    // A write that mutates then throws leaves bytes matching NEITHER our before-hash nor intended
    // after-hash. We CANNOT prove those bytes are ours vs a foreign edit, so the safe posture is
    // revert-failed (surface it), never force-restore over content we cannot account for.
    const backing = new MutableFileIO({ [A]: 'pristine' });
    const partialThenThrow: FileIO = {
      readFile: (p) => backing.readFile(p),
      access: (p) => backing.access(p),
      async writeFile(p, content) {
        await backing.writeFile(p, `${content.slice(0, 3)}<<CORRUPT-PARTIAL>>`); // partial bytes land
        throw new Error('write interrupted');
      },
      deleteFile: (p) => backing.deleteFile(p),
    };
    const tx = makeTx({ fileIO: partialThenThrow });

    await expect(tx.fileIO.writeFile(A, 'new-content')).rejects.toThrow('write interrupted');

    const result = await tx.rollback();
    expect(result.hunks).toEqual({ [A]: 'revert-failed' });
    expect(result.terminal).toBe('rollback_failed');
    expect(result.failedFiles).toEqual([A]);
    // The unaccountable bytes are left in place and surfaced — never silently clobbered.
    expect(backing.content(A)).toContain('CORRUPT-PARTIAL');
  });

  it('does NOT clobber a foreign edit when a LATER write throws after an earlier write succeeded', async () => {
    // write1 succeeds → a foreign edit lands → write2 throws BEFORE mutating. The disk holds the foreign
    // edit, which matches neither our before-hash nor our intended after-hash → revert-failed, surfaced.
    const backing = new MutableFileIO({ [A]: 'before' });
    let writeCount = 0;
    const failSecondWrite: FileIO = {
      readFile: (p) => backing.readFile(p),
      access: (p) => backing.access(p),
      async writeFile(p, content) {
        writeCount += 1;
        if (writeCount === 2) throw new Error('second write failed before mutating');
        await backing.writeFile(p, content);
      },
      deleteFile: (p) => backing.deleteFile(p),
    };
    const tx = makeTx({ fileIO: failSecondWrite });

    await tx.fileIO.writeFile(A, 'ours-v1'); // write1 succeeds
    await backing.writeFile(A, 'FOREIGN-EDIT'); // a foreign process edits the file
    await expect(tx.fileIO.writeFile(A, 'ours-v2')).rejects.toThrow('second write failed');

    const result = await tx.rollback();
    expect(backing.content(A)).toBe('FOREIGN-EDIT'); // never clobbered with 'before'
    expect(result.hunks).toEqual({ [A]: 'revert-failed' });
    expect(result.terminal).toBe('rollback_failed');
  });

  it('restores cleanly when a write LANDED (current == after-hash), the normal revert', async () => {
    const backing = new MutableFileIO({ [A]: 'before' });
    const tx = makeTx({ fileIO: backing });

    await tx.fileIO.writeFile(A, 'after'); // clean landed write
    const result = await tx.rollback();
    expect(backing.content(A)).toBe('before'); // restored
    expect(result.hunks).toEqual({ [A]: 'reverted' });
    expect(result.terminal).toBe('rolled_back');
  });
});

describe('WriteTransaction — a journal-store outage never blocks rollback file restoration (review P1)', () => {
  it('reverts files from in-memory snapshots and surfaces journalError when the store is down', async () => {
    const fileIO = new MutableFileIO({ [A]: 'a0', [B]: 'b0' });
    const downStore: JournalStore = {
      async put() {
        throw new Error('journal store unavailable');
      },
      async get() {
        return undefined;
      },
      async listNonTerminal() {
        return [];
      },
    };
    const tx = makeTx({ fileIO, journalStore: downStore });

    await tx.fileIO.writeFile(A, 'a1');
    await tx.fileIO.writeFile(B, 'b1');

    const result = await tx.rollback(); // must NOT throw despite every put() failing
    expect(fileIO.content(A)).toBe('a0'); // files reverted from the in-memory snapshots
    expect(fileIO.content(B)).toBe('b0');
    expect(result.terminal).toBe('rolled_back');
    expect(result.journalError).toBe('journal store unavailable');
  });
});

describe('WriteTransaction — created-file rollback on the REAL NodeFileIO path (review P1)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'b0-tx-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes a file the saga created via NodeFileIO when rolling back (deleteFile is implemented)', async () => {
    const created = join(dir, 'created.css');
    const tx = makeTx({ fileIO: new NodeFileIO() });

    await tx.fileIO.writeFile(created, '.x { color: red }\n');
    expect(await readFile(created, 'utf-8')).toContain('color: red');

    const result = await tx.rollback();
    expect(result.terminal).toBe('rolled_back');
    expect(result.hunks).toEqual({ [created]: 'reverted' });
    await expect(readFile(created, 'utf-8')).rejects.toThrow(); // deleted, not left behind
  });

  it('restores an existing file edited via NodeFileIO byte-for-byte on rollback', async () => {
    const existing = join(dir, 'existing.css');
    await writeFile(existing, '.a { padding: 1px }\n', 'utf-8');
    const tx = makeTx({ fileIO: new NodeFileIO() });

    await tx.fileIO.writeFile(existing, '.a { padding: 999px }\n');
    await tx.rollback();
    expect(await readFile(existing, 'utf-8')).toBe('.a { padding: 1px }\n');
  });
});
