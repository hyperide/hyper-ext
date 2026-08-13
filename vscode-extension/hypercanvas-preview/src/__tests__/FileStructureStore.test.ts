/**
 * Tests for FileProjectStructureStore — focusing on the cache schema-version
 * invalidation added in HYP-758. Without this, upgrading the scanner heuristic
 * (e.g. detecting page dirs in src/app/) would be silently masked by a stale
 * .hyperide/project-structure.json that has pagesPaths: [].
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// Dynamic import: the module references `vscode` only at type level, so bun
// won't choke on a missing vscode package when we import the class.
const { FileProjectStructureStore } = await import('../services/FileStructureStore');

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fssync.mkdtempSync(path.join(os.tmpdir(), 'FileStructureStore-test-'));
}

const SAMPLE_PATHS = {
  atomComponentsPaths: ['src/app/ui'],
  compositeComponentsPaths: ['src/app'],
  pagesPaths: ['src/app/auth', 'src/app/account'],
};

// ─── tests ──────────────────────────────────────────────────────────────────

describe('FileProjectStructureStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fssync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no cache file exists', async () => {
    const store = new FileProjectStructureStore();
    const result = await store.load(tmpDir);
    expect(result).toBeNull();
  });

  it('save + flush writes _generated marker and schemaVersion to disk', async () => {
    const store = new FileProjectStructureStore();
    await store.save(tmpDir, SAMPLE_PATHS);
    await store.flush();

    const raw = await fs.readFile(path.join(tmpDir, '.hyperide', 'project-structure.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { schemaVersion?: number; _generated?: boolean };
    expect(parsed._generated).toBe(true);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('load round-trips after save + flush', async () => {
    const store = new FileProjectStructureStore();
    await store.save(tmpDir, SAMPLE_PATHS);
    await store.flush();

    const store2 = new FileProjectStructureStore();
    const result = await store2.load(tmpDir);
    expect(result).not.toBeNull();
    expect(result?.pagesPaths).toEqual(SAMPLE_PATHS.pagesPaths);
    expect(result?.atomComponentsPaths).toEqual(SAMPLE_PATHS.atomComponentsPaths);
    expect(result?.compositeComponentsPaths).toEqual(SAMPLE_PATHS.compositeComponentsPaths);
  });

  it('trusts a user-authored config without _generated (no schemaVersion)', async () => {
    // hypercanvas.openProjectStructure creates a config with no _generated flag.
    // load() must always trust it, even when schemaVersion is absent (HYP-758 fix).
    const dir = path.join(tmpDir, '.hyperide');
    fssync.mkdirSync(dir, { recursive: true });
    const userPayload = {
      atomComponentsPaths: ['src/components/atoms'],
      compositeComponentsPaths: ['src/components/composites'],
      pagesPaths: ['src/pages'],
      // no _generated, no schemaVersion — user-authored
    };
    await fs.writeFile(path.join(dir, 'project-structure.json'), JSON.stringify(userPayload), 'utf-8');

    const store = new FileProjectStructureStore();
    const result = await store.load(tmpDir);
    // User config must be respected, not discarded
    expect(result).not.toBeNull();
    expect(result?.pagesPaths).toEqual(['src/pages']);
  });

  it('discards an auto-generated cache with a mismatched schemaVersion (_generated: true)', async () => {
    // Auto-generated caches carry _generated: true — these are version-checked (HYP-758).
    const dir = path.join(tmpDir, '.hyperide');
    fssync.mkdirSync(dir, { recursive: true });
    const stalePayload = {
      _generated: true,
      schemaVersion: 0, // stale — pages weren't detected before schemaVersion 1
      atomComponentsPaths: ['src/app/ui'],
      compositeComponentsPaths: ['src/app'],
      pagesPaths: [],
    };
    await fs.writeFile(path.join(dir, 'project-structure.json'), JSON.stringify(stalePayload), 'utf-8');

    const store = new FileProjectStructureStore();
    const result = await store.load(tmpDir);
    // Must return null so the scanner re-analyzes and produces correct pagesPaths
    expect(result).toBeNull();
  });

  it('discards an auto-generated cache with an unknown future schemaVersion', async () => {
    const dir = path.join(tmpDir, '.hyperide');
    fssync.mkdirSync(dir, { recursive: true });
    const futurePayload = {
      _generated: true,
      schemaVersion: 999,
      atomComponentsPaths: ['src/app/ui'],
      compositeComponentsPaths: ['src/app'],
      pagesPaths: ['src/app/future-feature'],
    };
    await fs.writeFile(path.join(dir, 'project-structure.json'), JSON.stringify(futurePayload), 'utf-8');

    const store = new FileProjectStructureStore();
    const result = await store.load(tmpDir);
    // Unknown future version → discard; scanner must re-analyze
    expect(result).toBeNull();
  });

  it('in-memory pending paths are returned by load() before flush', async () => {
    const store = new FileProjectStructureStore();
    await store.save(tmpDir, SAMPLE_PATHS);

    // flush() has NOT been called — paths live only in _pending
    const result = await store.load(tmpDir);
    expect(result).not.toBeNull();
    expect(result?.pagesPaths).toEqual(SAMPLE_PATHS.pagesPaths);
  });

  it('flush() returns true when pending and false when nothing pending', async () => {
    const store = new FileProjectStructureStore();
    expect(await store.flush()).toBe(false);
    await store.save(tmpDir, SAMPLE_PATHS);
    expect(await store.flush()).toBe(true);
    expect(await store.flush()).toBe(false);
  });
});
