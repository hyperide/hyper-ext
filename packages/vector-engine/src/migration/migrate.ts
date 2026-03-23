/**
 * @file Version migration — upgrade old graph files to current format
 *
 * Accessed via: File open — runs migration pipeline if version < CURRENT_VERSION
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Version Migration
 */

import type { VectorGraphFile } from '../persistence/types';

export const CURRENT_VERSION = 1;

type Migration = (graph: VectorGraphFile) => VectorGraphFile;
const migrations = new Map<number, Migration>();

export function registerMigration(fromVersion: number, fn: Migration): void {
  migrations.set(fromVersion, fn);
}

export function migrateGraph(graph: VectorGraphFile): VectorGraphFile {
  if (graph.version > CURRENT_VERSION) {
    throw new Error(
      `Cannot open graph version ${graph.version} (engine supports up to v${CURRENT_VERSION}). Update your editor.`,
    );
  }
  let current = { ...graph };
  while (current.version < CURRENT_VERSION) {
    const fn = migrations.get(current.version);
    if (!fn) {
      throw new Error(`No migration registered from v${current.version} to v${current.version + 1}`);
    }
    current = fn(current);
  }
  return current;
}

/** Clear all registered migrations (for testing) */
export function clearMigrations(): void {
  migrations.clear();
}
