import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProjectStructurePaths } from '../../../../../lib/component-scanner/types';

let mockFiles: Record<string, string> = {};
let mkdirCalls: string[] = [];

mock.module('node:fs/promises', () => ({
  readFile: async (filePath: string) => {
    const content = mockFiles[filePath];
    if (content !== undefined) return content;
    throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
  },
  mkdir: async (dir: string) => {
    mkdirCalls.push(dir);
  },
  writeFile: async (filePath: string, content: string) => {
    mockFiles[filePath] = content;
  },
}));

const { FileProjectStructureStore } = await import('../FileStructureStore');

const PATHS: ProjectStructurePaths = {
  atomComponentsPaths: ['/project/src/atoms'],
  compositeComponentsPaths: ['/project/src/composites'],
  pagesPaths: [],
};

describe('FileProjectStructureStore', () => {
  let store: InstanceType<typeof FileProjectStructureStore>;

  beforeEach(() => {
    store = new FileProjectStructureStore();
    mockFiles = {};
    mkdirCalls = [];
  });

  test('save() does not write to disk', async () => {
    await store.save('/project', PATHS);

    expect(mkdirCalls).toHaveLength(0);
    expect(Object.keys(mockFiles)).toHaveLength(0);
  });

  test('load() returns pending data after save()', async () => {
    await store.save('/project', PATHS);

    const result = await store.load('/project');
    expect(result).toEqual(PATHS);
  });

  test('load() reads from disk when no pending data (auto-generated cache)', async () => {
    // Auto-generated caches carry _generated + schemaVersion — load() verifies the version.
    const payload = { _generated: true as const, schemaVersion: 1, ...PATHS };
    mockFiles['/project/.hyperide/project-structure.json'] = JSON.stringify(payload);

    const result = await store.load('/project');
    expect(result).toEqual(PATHS);
  });

  test('load() trusts a user-authored config (no _generated flag) even without schemaVersion', async () => {
    // Configs created via hypercanvas.openProjectStructure have no _generated marker.
    // They must never be rejected regardless of schemaVersion absence (HYP-758 fix).
    mockFiles['/project/.hyperide/project-structure.json'] = JSON.stringify(PATHS);

    const result = await store.load('/project');
    expect(result).toEqual(PATHS);
  });

  test('load() discards an auto-generated cache with a mismatched schemaVersion', async () => {
    // Only _generated caches are version-checked; a stale version causes re-analysis.
    const stalePayload = { _generated: true as const, schemaVersion: 0, ...PATHS };
    mockFiles['/project/.hyperide/project-structure.json'] = JSON.stringify(stalePayload);

    const result = await store.load('/project');
    expect(result).toBeNull();
  });

  test('load() returns null when no pending data and no file', async () => {
    const result = await store.load('/project');
    expect(result).toBeNull();
  });

  test('flush() writes pending data to disk and returns true', async () => {
    await store.save('/project', PATHS);
    const result = await store.flush();

    expect(result).toBe(true);
    expect(mkdirCalls).toContain('/project/.hyperide');
    // flush() writes _generated + schemaVersion so future load() can version-check
    // auto-generated caches without touching user-authored configs (HYP-758).
    const expected = JSON.stringify({ _generated: true, schemaVersion: 1, ...PATHS }, null, 2);
    expect(mockFiles['/project/.hyperide/project-structure.json']).toBe(expected);
  });

  test('flush() clears pending data after write', async () => {
    await store.save('/project', PATHS);
    await store.flush();

    mkdirCalls = [];

    const result = await store.flush();
    expect(result).toBe(false);
    expect(mkdirCalls).toHaveLength(0);
  });

  test('load() reads flushed data from disk after pending is cleared', async () => {
    await store.save('/project', PATHS);
    await store.flush();

    // flush() adds _generated + schemaVersion; load() must still return the paths
    const result = await store.load('/project');
    expect(result).toEqual(PATHS);
  });

  test('flush() returns false when nothing pending', async () => {
    const result = await store.flush();
    expect(result).toBe(false);
    expect(mkdirCalls).toHaveLength(0);
    expect(Object.keys(mockFiles)).toHaveLength(0);
  });
});
