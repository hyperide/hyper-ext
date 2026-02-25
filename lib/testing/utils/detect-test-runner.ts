/**
 * Test Runner Detection
 *
 * Detects which test runner is used in a project by analyzing package.json
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { TestRunner } from '../types';

interface PackageJson {
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/**
 * Find package.json by walking up from a file path
 */
async function findPackageJson(startPath: string): Promise<string | null> {
  let currentDir = path.dirname(startPath);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const packagePath = path.join(currentDir, 'package.json');
    try {
      await fs.access(packagePath);
      return packagePath;
    } catch {
      currentDir = path.dirname(currentDir);
    }
  }

  return null;
}

/**
 * Detect test runner from package.json
 *
 * Priority:
 * 1. vitest - if vitest is in dependencies
 * 2. jest - if jest is in dependencies
 * 3. Check scripts.test for runner hints
 * 4. Fallback: bun if packageManager is bun, otherwise vitest
 *
 * @param componentPath - Path to the component file
 * @param packageManager - Package manager from project settings (npm, yarn, pnpm, bun)
 */
export async function detectTestRunner(
  componentPath: string,
  packageManager?: string,
): Promise<TestRunner> {
  const packageJsonPath = await findPackageJson(componentPath);

  // Fallback based on package manager: bun if packageManager is bun, otherwise vitest
  const defaultRunner: TestRunner = packageManager === 'bun' ? 'bun' : 'vitest';

  if (!packageJsonPath) {
    return defaultRunner;
  }

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg: PackageJson = JSON.parse(content);

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Check for vitest first (it's often preferred over jest in modern projects)
    if (allDeps.vitest) {
      return 'vitest';
    }

    // Check for jest
    if (allDeps.jest || allDeps['@jest/core'] || allDeps['jest-cli']) {
      return 'jest';
    }

    // Check scripts for test runner hints
    const testScript = pkg.scripts?.test || '';
    if (testScript.includes('vitest')) {
      return 'vitest';
    }
    if (testScript.includes('jest')) {
      return 'jest';
    }
    if (testScript.includes('bun test')) {
      return 'bun';
    }

    return defaultRunner;
  } catch {
    return defaultRunner;
  }
}

/**
 * Get test import statement for detected runner
 */
export function getTestImportForRunner(runner: TestRunner): string {
  switch (runner) {
    case 'vitest':
      return `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`;
    case 'jest':
      return `import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';`;
    case 'bun':
      return `import { describe, it, expect, beforeEach, afterEach } from 'bun:test';`;
  }
}
