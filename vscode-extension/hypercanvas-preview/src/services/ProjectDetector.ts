/**
 * Project Detector - detects project type and configuration
 *
 * Analyzes package.json and config files to determine
 * the framework (Vite, Next.js, CRA, Remix) and dev command.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectInfo, ProjectType, UnsupportedProjectError } from '../types';

/**
 * Read and parse package.json from project directory.
 * Exported so callers on the activation path can read once and pass to multiple detectors.
 */
export async function readPackageJson(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect project type from package.json dependencies and config files
 */
export async function detectProjectType(projectPath: string): Promise<ProjectType> {
  const packageJson = await readPackageJson(projectPath);

  if (!packageJson) {
    return 'unknown';
  }

  const deps = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  // Check dependencies — order matters: framework-specific deps first, then bundlers
  if (deps.next) return 'nextjs';
  if (deps['react-scripts']) return 'cra';
  if (deps['@remix-run/react']) return 'remix';
  if (deps.vite) return 'vite';
  if (deps.webpack || deps['webpack-dev-server'] || deps['webpack-cli']) return 'webpack';

  // Check for config files
  if (await fileExists(path.join(projectPath, 'next.config.js'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'next.config.mjs'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'next.config.ts'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'vite.config.ts'))) return 'vite';
  if (await fileExists(path.join(projectPath, 'vite.config.js'))) return 'vite';
  if (await fileExists(path.join(projectPath, 'webpack.config.js'))) return 'webpack';
  if (await fileExists(path.join(projectPath, 'webpack.config.ts'))) return 'webpack';

  return 'unknown';
}

/**
 * Get dev command for project type
 */
export function getDevCommand(type: ProjectType): string {
  switch (type) {
    case 'nextjs':
      return 'dev';
    case 'vite':
      return 'dev';
    case 'cra':
      return 'start';
    case 'remix':
      return 'dev';
    case 'webpack':
      return 'dev';
    default:
      return 'dev';
  }
}

/**
 * Get default port for project type
 */
export function getDefaultPort(type: ProjectType): number {
  switch (type) {
    case 'nextjs':
      return 3000;
    case 'vite':
      return 5173;
    case 'cra':
      return 3000;
    case 'remix':
      // Remix v2 uses Vite under the hood — default Vite port
      return 5173;
    case 'webpack':
      return 3000;
    default:
      return 3000;
  }
}

/**
 * Check if project uses TypeScript
 */
async function hasTypeScript(projectPath: string): Promise<boolean> {
  const packageJson = await readPackageJson(projectPath);

  if (!packageJson) {
    return false;
  }

  const deps = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  if (deps.typescript) return true;

  // Check for tsconfig
  if (await fileExists(path.join(projectPath, 'tsconfig.json'))) return true;

  return false;
}

/**
 * Get complete project info
 */
export async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
  const type = await detectProjectType(projectPath);

  return {
    type,
    devCommand: getDevCommand(type),
    defaultPort: getDefaultPort(type),
    hasTypeScript: await hasTypeScript(projectPath),
  };
}

/**
 * Detect if project is React Native / Tamagui (not renderable in browser without react-native-web)
 *
 * Returns null if project is browser-compatible, or an error object if unsupported.
 * @param packageJson - pre-parsed package.json to avoid redundant reads on the activation path
 */
export async function detectUnsupportedProject(
  projectPath: string,
  packageJson?: Record<string, unknown> | null,
): Promise<UnsupportedProjectError | null> {
  const pkg = packageJson ?? (await readPackageJson(projectPath));

  if (!pkg) {
    return null;
  }

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const hasReactNative = Boolean(deps['react-native']);
  // @tamagui/cli is a build-time codegen tool — not a runtime indicator of RN usage
  const hasTamagui = Boolean(deps.tamagui || deps['@tamagui/core']);

  if (hasReactNative || hasTamagui) {
    const what = hasTamagui ? 'Tamagui (React Native)' : 'React Native';
    const hasRNWeb = Boolean(deps['react-native-web']);
    if (hasRNWeb) {
      // react-native-web already installed — project may work, don't block
      return null;
    }
    return {
      type: 'react-native',
      message: `${what} projects don't render in a browser without react-native-web. Click "Fix" to install it.`,
      fixLabel: 'Fix: Add react-native-web',
    };
  }

  return null;
}

/**
 * Detect UI kit used in project (tailwind, tamagui, or none)
 * @param packageJson - pre-parsed package.json to avoid redundant reads on the activation path
 */
export async function detectUIKit(
  projectPath: string,
  packageJson?: Record<string, unknown> | null,
): Promise<'tailwind' | 'tamagui' | 'none'> {
  const pkg = packageJson ?? (await readPackageJson(projectPath));

  if (!pkg) {
    return 'none';
  }

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  // Check for Tamagui
  if (deps.tamagui || deps['@tamagui/core'] || deps['@tamagui/cli']) {
    return 'tamagui';
  }

  // Check for Tailwind
  if (deps.tailwindcss) {
    return 'tailwind';
  }

  return 'none';
}

/**
 * Get scripts from package.json
 */
export async function getPackageScripts(projectPath: string): Promise<Record<string, string>> {
  const packageJson = await readPackageJson(projectPath);

  if (!packageJson) {
    return {};
  }

  return (packageJson.scripts as Record<string, string>) || {};
}

/**
 * Detect package manager used in project
 */
export async function detectPackageManager(projectPath: string): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
  // Check for lock files
  if (await fileExists(path.join(projectPath, 'bun.lockb'))) return 'bun';
  if (await fileExists(path.join(projectPath, 'bun.lock'))) return 'bun';
  if (await fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(path.join(projectPath, 'yarn.lock'))) return 'yarn';

  return 'npm';
}
