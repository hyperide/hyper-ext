/**
 * File-based project structure store for VS Code extension.
 * Stores component paths in .hyperide/project-structure.json
 *
 * Writes are deferred to an in-memory buffer until flush() is called.
 * This prevents .hyperide/ from being created before the user actually
 * opens a component in Hyper Canvas.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectStructurePaths, ProjectStructureStore } from '../../../../lib/component-scanner/types';

const CONFIG_DIR = '.hyperide';
const CONFIG_FILE = 'project-structure.json';

/**
 * Bump this when the heuristic changes in a way that might produce a different
 * set of paths for an existing project (e.g. newly detected page dirs). Any
 * auto-generated cache (_generated: true) whose version doesn't match is
 * discarded and re-analyzed. User-authored configs (no _generated flag) are
 * always trusted regardless of schemaVersion.
 * Current version — 1: HYP-758 page-subdir detection in src/app/.
 */
const CACHE_SCHEMA_VERSION = 1;

type CachePayload = ProjectStructurePaths & { schemaVersion?: number; _generated?: true };

export class FileProjectStructureStore implements ProjectStructureStore {
  private _pending = new Map<string, ProjectStructurePaths>();

  async load(projectRoot: string): Promise<ProjectStructurePaths | null> {
    const pending = this._pending.get(projectRoot);
    if (pending) return pending;

    const configPath = path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content) as CachePayload;
      // Only version-check auto-generated caches (_generated: true).
      // User-authored configs (created via hypercanvas.openProjectStructure) have
      // no _generated flag and must always be trusted as-is.
      if (parsed._generated && parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
      return {
        atomComponentsPaths: parsed.atomComponentsPaths ?? [],
        compositeComponentsPaths: parsed.compositeComponentsPaths ?? [],
        pagesPaths: parsed.pagesPaths ?? [],
      };
    } catch {
      return null;
    }
  }

  async save(projectRoot: string, paths: ProjectStructurePaths): Promise<void> {
    this._pending.set(projectRoot, paths);
  }

  /** Write all pending data to disk. Returns true if anything was written. */
  async flush(): Promise<boolean> {
    if (this._pending.size === 0) return false;

    for (const [projectRoot, paths] of this._pending) {
      const dir = path.join(projectRoot, CONFIG_DIR);
      await fs.mkdir(dir, { recursive: true });
      const configPath = path.join(dir, CONFIG_FILE);
      const payload: CachePayload = { _generated: true, schemaVersion: CACHE_SCHEMA_VERSION, ...paths };
      await fs.writeFile(configPath, JSON.stringify(payload, null, 2), 'utf-8');
    }
    this._pending.clear();
    return true;
  }
}
