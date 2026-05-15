/**
 * @file In-memory FileIO implementation for style-write tests
 *
 * Accessed via: bun tests for shared style-write and VS Code style-write integration
 * Assumptions: test file paths are already normalized by the caller.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import type { FileIO } from '@lib/ast/file-io';

export class InMemoryFileIO implements FileIO {
  private readonly files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [filePath, content] of Object.entries(files)) {
      this.files.set(filePath, content);
    }
  }

  async readFile(absolutePath: string): Promise<string> {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    return content;
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    if (!this.files.has(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    this.files.set(absolutePath, content);
  }

  async access(absolutePath: string): Promise<void> {
    if (!this.files.has(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
  }

  async listFiles(dirPath: string, extensions: string[] = []): Promise<string[]> {
    return [...this.files.keys()].filter((filePath) => {
      if (!filePath.startsWith(dirPath)) return false;
      if (extensions.length === 0) return true;
      return extensions.some((extension) => filePath.endsWith(extension));
    });
  }

  content(absolutePath: string): string {
    const content = this.files.get(absolutePath);
    if (content === undefined) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    return content;
  }
}
