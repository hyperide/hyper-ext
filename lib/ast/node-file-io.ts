/**
 * Node.js implementation of FileIO
 * Uses node:fs/promises for file operations
 */

import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { SCAN_EXCLUDE_DIRS } from '../../shared/fs/scan-excludes';
import type { FileIO } from './file-io';

export class NodeFileIO implements FileIO {
  async readFile(absolutePath: string): Promise<string> {
    return fs.readFile(absolutePath, 'utf-8');
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    await fs.writeFile(absolutePath, content, 'utf-8');
  }

  async access(absolutePath: string): Promise<void> {
    await fs.access(absolutePath);
  }

  // Used by the B0 write-transaction rollback to undo a CREATED file (delete it rather than leave an
  // empty stub). `force: true` makes deleting an already-absent file a no-op, which matches the
  // transaction's "already gone → reverted" path. (HYP-722 T1a.)
  async deleteFile(absolutePath: string): Promise<void> {
    await fs.rm(absolutePath, { force: true });
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async listFiles(dirPath: string, extensions?: string[]): Promise<string[]> {
    const results: string[] = [];
    await this._collectFiles(dirPath, extensions, results);
    return results;
  }

  private async _collectFiles(dir: string, extensions: string[] | undefined, results: string[]): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }

    for (const name of names) {
      const fullPath = join(dir, name);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // Skip build/tooling/VCS dirs (node_modules, .git, dist, …) — a recursive
        // scan that descended into node_modules would read the entire dependency
        // tree. Shared with VSCodeFileIO via SCAN_EXCLUDE_DIRS (single source of truth).
        if (SCAN_EXCLUDE_DIRS.has(name)) continue;
        await this._collectFiles(fullPath, extensions, results);
      } else if (stat.isFile()) {
        if (!extensions || extensions.some((ext) => name.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    }
  }
}
