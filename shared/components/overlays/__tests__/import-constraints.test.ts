/**
 * Ensures shared overlay components never import from platform-specific code.
 * Forbidden: client/, vscode-extension/, @/ (SaaS alias)
 *
 * Uses sync fs APIs on purpose: other test files in the suite do
 * `mock.module('node:fs/promises', …)` globally, which would make our
 * directory scan see mocked/fake files instead of the real overlays dir.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OVERLAY_DIR = join(import.meta.dir, '..');
const FORBIDDEN_PATTERNS = [
  /from\s+['"](?:@\/|client\/|vscode-extension\/)/,
  /import\s+.*['"](?:@\/|client\/|vscode-extension\/)/,
];

function getSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
      files.push(...getSourceFiles(path));
    } else if (
      /\.(tsx?|jsx?)$/.test(entry.name) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(path);
    }
  }
  return files;
}

describe('import constraints', () => {
  it('shared overlay components do not import from client/ or vscode-extension/', () => {
    const files = getSourceFiles(OVERLAY_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: matches ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
