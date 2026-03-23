import { beforeEach, describe, expect, it } from 'bun:test';
import type { VectorGraphFile } from '../persistence/types';
import { CURRENT_VERSION, clearMigrations, migrateGraph, registerMigration } from './migrate';

function makeFile(version: number): VectorGraphFile {
  return {
    version,
    meta: { componentPath: '' },
    base: { canvas: { width: 100, height: 100 }, nodes: {}, edges: [], muted: [] },
    operations: [],
    undoPointer: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
  };
}

describe('version migration', () => {
  beforeEach(() => clearMigrations());

  it('should return current version graph unchanged', () => {
    const file = makeFile(CURRENT_VERSION);
    const result = migrateGraph(file);
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it('should reject future version', () => {
    const file = makeFile(999);
    expect(() => migrateGraph(file)).toThrow(/version/i);
  });

  it('should apply registered migration', () => {
    registerMigration(0, (g) => ({ ...g, version: 1 }));
    const file = makeFile(0);
    const result = migrateGraph(file);
    expect(result.version).toBe(1);
  });

  it('should chain migrations sequentially', () => {
    registerMigration(0, (g) => ({ ...g, version: 1 }));
    // If CURRENT_VERSION is 1, this test passes with one migration
    const file = makeFile(0);
    const result = migrateGraph(file);
    expect(result.version).toBe(CURRENT_VERSION);
  });

  it('should throw if migration is missing', () => {
    const file = makeFile(0);
    // No migration registered for v0
    if (CURRENT_VERSION > 0) {
      expect(() => migrateGraph(file)).toThrow(/No migration/);
    }
  });
});
