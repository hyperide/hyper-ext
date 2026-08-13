import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { DiagnosticLogEntry } from '../../../../../shared/diagnostic-types';

// Shared state via object ref — mock.module captures the ref, not the value
const state = {
  fileContent: null as string | null,
  writtenPath: null as string | null,
  writtenContent: null as string | null,
  unlinkCalled: false,
  mkdirCalled: false,
};

mock.module('node:fs/promises', () => ({
  readFile: async (filePath: string) => {
    if (state.fileContent === null) throw new Error(`ENOENT: ${filePath}`);
    return state.fileContent;
  },
  writeFile: async (filePath: string, content: string) => {
    state.writtenPath = filePath;
    state.writtenContent = content;
  },
  unlink: async () => {
    state.unlinkCalled = true;
  },
  mkdir: async () => {
    state.mkdirCalled = true;
  },
}));

const { DiagnosticPersistenceService } = await import('../DiagnosticPersistenceService');

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

  beforeEach(() => {
    state.fileContent = null;
    state.writtenPath = null;
    state.writtenContent = null;
    state.unlinkCalled = false;
    state.mkdirCalled = false;
    service = new DiagnosticPersistenceService('/fake/global/storage');
  });

  afterEach(() => {
    service.dispose();
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

  describe('clear', () => {
    it('should call unlink', async () => {
      await service.clear();
      expect(state.unlinkCalled).toBe(true);
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
