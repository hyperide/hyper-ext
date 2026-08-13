import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { DiagnosticLogEntry } from '../../../../../shared/diagnostic-types';
import { DiagnosticPersistenceService } from '../DiagnosticPersistenceService';

// Mutable state shared between spy implementations and test assertions
const state = {
  fileContent: null as string | null,
  writtenPath: null as string | null,
  writtenContent: null as string | null,
  unlinkCalled: false,
  mkdirCalled: false,
};

function makeEntry(line: string, source = 'server'): DiagnosticLogEntry {
  return {
    line,
    timestamp: Date.now(),
    source: source as DiagnosticLogEntry['source'],
    isError: false,
  };
}

describe('DiagnosticPersistenceService', () => {
  let service: InstanceType<typeof DiagnosticPersistenceService>;
  let readFileSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;
  let unlinkSpy: ReturnType<typeof spyOn>;
  let mkdirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    state.fileContent = null;
    state.writtenPath = null;
    state.writtenContent = null;
    state.unlinkCalled = false;
    state.mkdirCalled = false;

    readFileSpy = spyOn(fs, 'readFile').mockImplementation(async (filePath: unknown) => {
      if (state.fileContent === null) throw new Error(`ENOENT: ${filePath}`);
      return state.fileContent as unknown as Buffer;
    });
    writeFileSpy = spyOn(fs, 'writeFile').mockImplementation(async (filePath: unknown, content: unknown) => {
      state.writtenPath = filePath as string;
      state.writtenContent = content as string;
    });
    unlinkSpy = spyOn(fs, 'unlink').mockImplementation(async () => {
      state.unlinkCalled = true;
    });
    mkdirSpy = spyOn(fs, 'mkdir').mockImplementation(async () => {
      state.mkdirCalled = true;
      return undefined;
    });

    service = new DiagnosticPersistenceService('/fake/global/storage');
  });

  afterEach(() => {
    service.dispose();
    readFileSpy?.mockRestore();
    writeFileSpy?.mockRestore();
    unlinkSpy?.mockRestore();
    mkdirSpy?.mockRestore();
  });

  describe('load', () => {
    it('should return empty array when file does not exist', async () => {
      const result = await service.load();
      expect(result).toEqual([]);
    });

    it('should return parsed entries from file', async () => {
      const entries = [makeEntry('log 1'), makeEntry('log 2')];
      state.fileContent = JSON.stringify(entries);

      const result = await service.load();
      expect(result).toHaveLength(2);
      expect(result[0].line).toBe('log 1');
    });

    it('should return empty array on invalid JSON', async () => {
      state.fileContent = 'not json {{{';
      const result = await service.load();
      expect(result).toEqual([]);
    });

    it('should return empty array when file contains non-array JSON', async () => {
      state.fileContent = '{"not": "an array"}';
      const result = await service.load();
      expect(result).toEqual([]);
    });
  });

  describe('save', () => {
    it('should debounce writes (not write immediately)', () => {
      service.save([makeEntry('test')]);
      expect(state.writtenContent).toBeNull();
    });

    it('should write after debounce period', async () => {
      const entries = [makeEntry('test')];
      service.save(entries);

      await new Promise((resolve) => setTimeout(resolve, 2200));

      expect(state.writtenContent).toBeTruthy();
      // biome-ignore lint/style/noNonNullAssertion: test asserts truthy above
      const written = JSON.parse(state.writtenContent!);
      expect(written).toHaveLength(1);
      expect(written[0].line).toBe('test');
      expect(state.mkdirCalled).toBe(true);
    });
  });

  describe('saveNow (HYP-943)', () => {
    it('writes immediately, superseding a pending debounced save', async () => {
      service.save([makeEntry('debounced')]);
      await service.saveNow([makeEntry('immediate')]);

      expect(state.writtenContent).toBeTruthy();
      // biome-ignore lint/style/noNonNullAssertion: test asserts truthy above
      expect(JSON.parse(state.writtenContent!)[0].line).toBe('immediate');

      // The superseded debounced save never fires later with stale content.
      await new Promise((resolve) => setTimeout(resolve, 2200));
      // biome-ignore lint/style/noNonNullAssertion: still truthy
      expect(JSON.parse(state.writtenContent!)[0].line).toBe('immediate');
    });

    it('serializes writes: a slow in-flight write cannot commit after a newer saveNow', async () => {
      // First write blocks inside fs.writeFile until released — simulating an
      // already-fired debounced write still in flight when saveNow lands.
      let releaseFirst: () => void = () => {};
      const firstBlocked = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let call = 0;
      writeFileSpy.mockImplementation(async (_filePath: unknown, content: unknown) => {
        call += 1;
        if (call === 1) await firstBlocked;
        state.writtenContent = content as string;
      });

      const first = service.saveNow([makeEntry('stale')]);
      const second = service.saveNow([makeEntry('fresh')]);
      releaseFirst();
      await first;
      await second;

      // FIFO chain: stale committed first, fresh committed last — disk ends fresh.
      // biome-ignore lint/style/noNonNullAssertion: both writes completed
      expect(JSON.parse(state.writtenContent!)[0].line).toBe('fresh');
    });
  });

  describe('clear', () => {
    it('should call unlink', async () => {
      await service.clear();
      expect(state.unlinkCalled).toBe(true);
    });

    it('unlinks AFTER a slow in-flight write, so cleared logs cannot resurrect', async () => {
      const ops: string[] = [];
      let releaseWrite: () => void = () => {};
      const writeBlocked = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      writeFileSpy.mockImplementation(async () => {
        await writeBlocked;
        ops.push('write');
      });
      unlinkSpy.mockImplementation(async () => {
        ops.push('unlink');
      });

      const write = service.saveNow([makeEntry('in-flight')]);
      const cleared = service.clear();
      releaseWrite();
      await write;
      await cleared;

      expect(ops).toEqual(['write', 'unlink']);
    });
  });

  describe('dispose', () => {
    it('should cancel pending save timer', async () => {
      service.save([makeEntry('test')]);
      service.dispose();

      await new Promise((resolve) => setTimeout(resolve, 2500));
      expect(state.writtenContent).toBeNull();
    });
  });
});
