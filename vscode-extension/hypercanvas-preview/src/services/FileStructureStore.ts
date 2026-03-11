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

export class FileProjectStructureStore implements ProjectStructureStore {
  private _pending = new Map<string, ProjectStructurePaths>();

  async load(projectRoot: string): Promise<ProjectStructurePaths | null> {
    const pending = this._pending.get(projectRoot);
    if (pending) return pending;

    const configPath = path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content) as ProjectStructurePaths;
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
      await fs.writeFile(configPath, JSON.stringify(paths, null, 2), 'utf-8');
    }
    this._pending.clear();
    return true;
  }
}
