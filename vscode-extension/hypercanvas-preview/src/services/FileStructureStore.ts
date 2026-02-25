/**
 * File-based project structure store for VS Code extension.
 * Stores component paths in .hyperide/project-structure.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectStructurePaths, ProjectStructureStore } from '../../../../lib/component-scanner/types';

const CONFIG_DIR = '.hyperide';
const CONFIG_FILE = 'project-structure.json';

export class FileProjectStructureStore implements ProjectStructureStore {
  async load(projectRoot: string): Promise<ProjectStructurePaths | null> {
    const configPath = path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content) as ProjectStructurePaths;
    } catch {
      return null;
    }
  }

  async save(projectRoot: string, paths: ProjectStructurePaths): Promise<void> {
    const dir = path.join(projectRoot, CONFIG_DIR);
    await fs.mkdir(dir, { recursive: true });
    const configPath = path.join(dir, CONFIG_FILE);
    await fs.writeFile(configPath, JSON.stringify(paths, null, 2), 'utf-8');
  }
}
