/**
 * @file runStyleWriteTransaction integration tests — the B0 transaction wrapping the real executor
 *
 * Accessed via: bun test lib/style-write/transaction/run-style-write-transaction.test.ts
 * Assumptions: the executor is UNCHANGED; the transaction snapshots through the injected FileIO and
 *   rolls back on failure. Proves the one working flow (single-element Tailwind write) still works
 *   wrapped, that writeId propagates, and that a failure restores the file byte-for-byte (spec §9.1).
 */
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import { createFileParser } from '@lib/ast/parser.node';
import { findElementByPosition } from '@lib/ast/position-finder';
import type { ExecuteStyleWriteRequestInput } from '../style-write-executor';
import { executeStyleWriteRequest } from '../style-write-executor';
import type { StyleWriteResult } from '../types';
import { InMemoryFileIO } from '../testing/in-memory-file-io';
import { InMemoryJournalStore } from './in-memory-journal-store';
import { runStyleWriteTransaction } from './run-style-write-transaction';
import { TERMINAL_SAGA_STATES } from './types';
import type { JournalRecord, JournalStore, WriteId } from './types';

const APP = '/project/src/App.tsx';

const SOURCE = `export function App() {
  return (
    <div className="pl-2 text-red-500">Hi</div>
  );
}
`;

async function parseElement(fileIO: FileIO, filePath: string, line: number, column: number) {
  const parser = createFileParser(fileIO);
  const { ast } = await parser.readAndParseFile(filePath);
  const result = findElementByPosition(ast, line, column);
  if (!result) throw new Error(`Element not found at ${line}:${column}`);
  return { ast, element: result.element };
}

async function makeRequest(fileIO: FileIO): Promise<Omit<ExecuteStyleWriteRequestInput, 'fileIO'>> {
  const { ast, element } = await parseElement(fileIO, APP, 3, 4);
  return {
    ast,
    sourceFilePath: APP,
    element,
    styles: { paddingLeft: '16' },
    runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'test-fixture' },
    projectRoot: '/project',
  };
}

describe('runStyleWriteTransaction — success path (the one working flow stays working, wrapped)', () => {
  it('commits a single-element Tailwind write and propagates the writeId', async () => {
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const journalStore = new InMemoryJournalStore();
    const request = await makeRequest(fileIO);

    const result = await runStyleWriteTransaction({
      request,
      execute: executeStyleWriteRequest,
      baseFileIO: fileIO,
      journalStore,
    });

    expect(result.success).toBe(true);
    expect(result.writeId).toBeTruthy();
    expect(fileIO.content(APP)).toContain("className='text-red-500 pl-[16px]'");

    const record = await journalStore.get(result.writeId);
    expect(record?.state).toBe('committed');
    expect(record?.hunks[APP]).toBe('committed');
  });

  it('journals the before-content so the committed write is one-undo reversible', async () => {
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const journalStore = new InMemoryJournalStore();
    const request = await makeRequest(fileIO);

    const result = await runStyleWriteTransaction({
      request,
      execute: executeStyleWriteRequest,
      baseFileIO: fileIO,
      journalStore,
    });

    const record = await journalStore.get(result.writeId);
    const patch = record?.inversePatches.find((p) => p.filePath === APP);
    expect(patch?.beforeContent).toBe(SOURCE);
  });
});

describe('runStyleWriteTransaction — failure rolls back every touched file byte-for-byte', () => {
  it('restores the file when the executor returns a failure result', async () => {
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const journalStore = new InMemoryJournalStore();
    const request = await makeRequest(fileIO);

    // An executor that mutates the file THROUGH the transaction's fileIO, then reports failure — the
    // B0 contract must roll the half-written file back to its snapshot.
    const failingExecute = async (input: ExecuteStyleWriteRequestInput): Promise<StyleWriteResult> => {
      await input.fileIO!.writeFile(APP, '// clobbered by a doomed write\n');
      return { success: false, error: 'planner rejected the write' };
    };

    const result = await runStyleWriteTransaction({
      request,
      execute: failingExecute as typeof executeStyleWriteRequest,
      baseFileIO: fileIO,
      journalStore,
    });

    expect(result.success).toBe(false);
    expect(fileIO.content(APP)).toBe(SOURCE); // restored byte-for-byte
    expect(result.rollback?.terminal).toBe('rolled_back');
    expect(result.rollback?.failedFiles).toEqual([]);

    const record = await journalStore.get(result.writeId);
    expect(record?.state).toBe('rolled_back');
  });

  it('restores the file and surfaces the error when the executor THROWS mid-write', async () => {
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const request = await makeRequest(fileIO);

    const throwingExecute = async (input: ExecuteStyleWriteRequestInput): Promise<StyleWriteResult> => {
      await input.fileIO!.writeFile(APP, '// half-applied before the crash\n');
      throw new Error('boom mid-dispatch');
    };

    const result = await runStyleWriteTransaction({
      request,
      execute: throwingExecute as typeof executeStyleWriteRequest,
      baseFileIO: fileIO,
    });

    expect(result.success).toBe(false);
    if (result.success === false) expect(result.error).toBe('boom mid-dispatch');
    expect(fileIO.content(APP)).toBe(SOURCE); // restored despite the throw
    expect(result.rollback?.terminal).toBe('rolled_back');
  });

  it('rolls back ALL files of a multi-file write together on failure', async () => {
    const OTHER = '/project/src/Other.tsx';
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE, [OTHER]: '// other-original\n' });
    const request = await makeRequest(fileIO);

    const multiFileFailing = async (input: ExecuteStyleWriteRequestInput): Promise<StyleWriteResult> => {
      await input.fileIO!.writeFile(APP, '// app-mutated\n');
      await input.fileIO!.writeFile(OTHER, '// other-mutated\n');
      return { success: false, error: 'second file failed' };
    };

    await runStyleWriteTransaction({
      request,
      execute: multiFileFailing as typeof executeStyleWriteRequest,
      baseFileIO: fileIO,
    });

    expect(fileIO.content(APP)).toBe(SOURCE);
    expect(fileIO.content(OTHER)).toBe('// other-original\n');
  });
});

describe('runStyleWriteTransaction — a commit journal failure keeps the write and surfaces it (review P1)', () => {
  it('returns success with a journalError when the commit record cannot be persisted', async () => {
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const request = await makeRequest(fileIO);
    const flakyStore: JournalStore = {
      async put(record: JournalRecord) {
        if (record.state === 'committed') throw new Error('journal disk full');
      },
      async get() {
        return undefined;
      },
      async listNonTerminal() {
        return [];
      },
    };

    const result = await runStyleWriteTransaction({
      request,
      execute: executeStyleWriteRequest,
      baseFileIO: fileIO,
      journalStore: flakyStore,
    });

    // The edit is KEPT (a bookkeeping failure must not discard a wanted write) and the degradation is
    // surfaced rather than swallowed.
    expect(result.success).toBe(true);
    expect(result.journalError).toBe('journal disk full');
    expect(fileIO.content(APP)).toContain("className='text-red-500 pl-[16px]'");
  });

  it('leaves NO recoverable non-terminal record when the committed put fails (orphan-record guard, review #2)', async () => {
    // A STATEFUL store: it persists what it accepts and rejects the committed put. commit() must NOT
    // have pre-persisted a `forward_in_progress` record, so a future recovery scan finds nothing to
    // roll back for an edit the caller already saw succeed.
    const records = new Map<WriteId, JournalRecord>();
    const statefulFlaky: JournalStore = {
      async put(record: JournalRecord) {
        if (record.state === 'committed') throw new Error('committed put rejected');
        records.set(record.writeId, record);
      },
      async get(writeId: WriteId) {
        return records.get(writeId);
      },
      async listNonTerminal() {
        return [...records.values()].filter((r) => !TERMINAL_SAGA_STATES.has(r.state));
      },
    };
    const fileIO = new InMemoryFileIO({ [APP]: SOURCE });
    const request = await makeRequest(fileIO);

    const result = await runStyleWriteTransaction({
      request,
      execute: executeStyleWriteRequest,
      baseFileIO: fileIO,
      journalStore: statefulFlaky,
    });

    expect(result.success).toBe(true);
    expect(result.journalError).toBe('committed put rejected');
    // No orphan `forward_in_progress` record a recovery scan could roll back.
    expect(await statefulFlaky.listNonTerminal()).toEqual([]);
  });
});
