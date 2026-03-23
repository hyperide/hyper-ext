/**
 * Node.js implementation of FileIO
 * Uses node:fs/promises for file operations
 */

import * as fs from 'node:fs/promises';
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
}
