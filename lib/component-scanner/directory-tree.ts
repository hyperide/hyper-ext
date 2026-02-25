/**
 * Directory tree scanning utilities.
 * Extracted from server/services/project-analyzer.ts
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const IGNORED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '.cache',
  'coverage',
  '.vscode',
  '.idea',
  'tmp',
  'temp',
  'logs',
  '.turbo',
  '.vercel',
  '.parcel-cache',
];

const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/**
 * Recursively build a text representation of a project's directory tree.
 * Only includes directories and code files (.tsx, .ts, .jsx, .js).
 */
export async function getDirectoryTree(
  dirPath: string,
  maxDepth: number = 15,
  currentDepth: number = 0,
): Promise<string> {
  if (currentDepth >= maxDepth) return '';

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let tree = '';
    let fileCount = 0;
    let dirCount = 0;

    for (const entry of entries) {
      if (IGNORED_DIRS.includes(entry.name)) continue;

      const indent = '  '.repeat(currentDepth);

      if (entry.isDirectory()) {
        dirCount++;
        tree += `${indent}\u{1F4C1} ${entry.name}/\n`;
        const subTree = await getDirectoryTree(join(dirPath, entry.name), maxDepth, currentDepth + 1);
        tree += subTree;
      } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        fileCount++;
        tree += `${indent}\u{1F4C4} ${entry.name}\n`;
      }
    }

    if (currentDepth === 0) {
      console.log(
        `[ComponentScanner] Scanned ${dirPath}: found ${dirCount} directories and ${fileCount} files at root level`,
      ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    }

    return tree;
  } catch (error) {
    console.error(`[ComponentScanner] Error reading directory ${dirPath}:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    return '';
  }
}

/**
 * Filter out child paths — if both "a/b" and "a/b/c" exist, keep only "a/b".
 */
export function filterChildPaths(paths: string[]): string[] {
  return paths.filter((p) => {
    return !paths.some((otherPath) => otherPath !== p && p.startsWith(`${otherPath}/`));
  });
}
