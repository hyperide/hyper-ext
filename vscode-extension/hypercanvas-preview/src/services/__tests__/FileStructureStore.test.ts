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

  test('load() reads from disk when no pending data', async () => {
    mockFiles['/project/.hyperide/project-structure.json'] = JSON.stringify(PATHS);

    const result = await store.load('/project');
    expect(result).toEqual(PATHS);
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
    expect(mockFiles['/project/.hyperide/project-structure.json']).toBe(JSON.stringify(PATHS, null, 2));
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
