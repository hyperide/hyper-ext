/**
 * Project Detector - detects project type and configuration
 *
 * Analyzes package.json and config files to determine
 * the framework (Vite, Next.js, CRA, Remix, Astro) and dev command.
 *
 * Accessed via: extension activation → detectProjectType() → bundler/CSS detection pipeline
 * Past bugs:
 *   HYP-382 — Astro projects mapped to 'unknown' bundler; astro dep + astro.config.* now → 'vite'
 *   HYP-383 — @astrojs/tailwind and @tailwindcss/vite not detected as tailwind CSS system
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ProjectInfo, ProjectType, UnsupportedProjectError } from '../types';
import { WRITABLE_CSS_SYSTEMS } from '../types';

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
  // Astro is Vite-powered — treat as 'vite' for dev server + HMR pipeline
  if (deps.astro) return 'vite';
  if (deps.vite) return 'vite';
  if (deps.webpack || deps['webpack-dev-server'] || deps['webpack-cli']) return 'webpack';

  // Bun as bundler: @types/bun is the clearest signal (Vite/webpack projects don't have it).
  // bun-plugin-* deps or a dev script invoking bun directly (bun --hot / bun src/) also count.
  const hasBunTypes = Boolean(deps['@types/bun']);
  const hasBunPlugin = Object.keys(deps).some((k) => k.startsWith('bun-plugin-'));
  const scripts = packageJson.scripts as Record<string, string> | undefined;
  const devScript = scripts?.dev ?? scripts?.start ?? '';
  const bunDirectInvocation = /\bbun\s+(--hot|--watch|src\/|index\.)/.test(devScript);
  if (hasBunTypes || hasBunPlugin || bunDirectInvocation) return 'bun';

  // Check for config files
  if (await fileExists(path.join(projectPath, 'next.config.js'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'next.config.mjs'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'next.config.ts'))) return 'nextjs';
  if (await fileExists(path.join(projectPath, 'astro.config.ts'))) return 'vite';
  if (await fileExists(path.join(projectPath, 'astro.config.mjs'))) return 'vite';
  if (await fileExists(path.join(projectPath, 'astro.config.js'))) return 'vite';
  if (await fileExists(path.join(projectPath, 'astro.config.cjs'))) return 'vite';
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
    case 'bun':
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
    case 'bun':
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

    // Determine fix label based on project type:
    // - Next.js projects: only install react-native-web (next.config patched at fix-time)
    // - Tamagui One projects: only install react-native-web (already has Vite via one())
    // - Default: install react-native-web + full Vite config
    const hasNext = Boolean(deps.next);
    let isTamaguiOne = false;
    if (!hasNext) {
      try {
        const viteRaw = await fs.readFile(path.join(projectPath, 'vite.config.ts'), 'utf-8');
        isTamaguiOne =
          /\bone\s*\(/.test(viteRaw) || viteRaw.includes("from 'one/vite'") || viteRaw.includes('from "one/vite"');
      } catch {
        // No vite.config.ts — not a One project
      }
    }

    const fixLabel = hasNext || isTamaguiOne ? 'Fix: Add react-native-web' : 'Fix: Add react-native-web + Vite config';

    return {
      type: 'react-native',
      message: `${what} projects need react-native-web and a Vite config to render in a browser. Click "Fix" to set it up automatically.`,
      fixLabel,
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

  // Check for Tailwind — bare dep or Astro integration (@astrojs/tailwind, @tailwindcss/vite)
  if (deps.tailwindcss || deps['@astrojs/tailwind'] || deps['@tailwindcss/vite']) {
    return 'tailwind';
  }

  return 'none';
}

/**
 * Detect the primary CSS system used in the project.
 *
 * Scans package.json dependencies in priority order — the first match wins.
 * Returns the most specific match (e.g. 'shadcn' over 'tailwind' if both
 * shadcn-ui AND tailwindcss are present).
 */
export async function detectCssSystem(
  projectPath: string,
  packageJson?: Record<string, unknown> | null,
): Promise<import('../types').CssSystem> {
  const pkg = packageJson ?? (await readPackageJson(projectPath));
  if (!pkg) return 'unknown';

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  const has = (name: string) => name in deps;

  // Design systems built on Tailwind (check BEFORE bare tailwind)
  if (has('@shadcn/ui') || has('class-variance-authority')) return 'shadcn';
  if (has('daisyui')) return 'daisyui';
  if (has('@nextui-org/react') || has('@nextui-org/theme')) return 'nextui';

  // Tamagui
  if (has('tamagui') || has('@tamagui/core')) return 'tamagui';

  // CSS-in-JS / zero-runtime
  if (has('@vanilla-extract/css')) return 'vanilla-extract';
  if (has('@pandacss/dev') || has('pandacss')) return 'pandacss';
  if (has('unocss') || has('@unocss/preset-uno')) return 'unocss';
  if (has('@stylexjs/stylex') || has('stylex')) return 'stylex';
  if (has('styled-components')) return 'styled-components';
  if (has('@emotion/react') || has('@emotion/styled')) return 'emotion';

  // Component libraries (check after CSS-in-JS since they often bring their own)
  if (has('@mui/material') || has('@mui/system')) return 'mui';
  if (has('antd') || has('@ant-design/icons')) return 'antd';
  if (has('@chakra-ui/react')) return 'chakra';
  if (has('@mantine/core')) return 'mantine';
  if (has('@fluentui/react-components') || has('@fluentui/react')) return 'fluentui';

  // Tailwind (bare — most common, check last so design systems win)
  // @astrojs/tailwind = Astro integration; @tailwindcss/vite = Tailwind v4 in Vite/Astro
  if (has('tailwindcss') || has('@astrojs/tailwind') || has('@tailwindcss/vite')) return 'tailwind';

  // SASS/SCSS — detected by sass/node-sass dep. Extension treats it like
  // plain CSS (className-based, no special AST handling needed).
  if (has('sass') || has('node-sass') || has('sass-embedded')) return 'sass' as import('../types').CssSystem;

  // CSS Modules have no package.json dependency — detect by scanning src/
  // for *.module.css / *.module.scss / *.module.less files.
  if (await hasCssModuleFiles(projectPath)) return 'cssmodules';

  return 'unknown';
}

/**
 * Check if the project uses CSS Modules by looking for .module.css/.scss/.less
 * files in common source directories.
 */
async function hasCssModuleFiles(projectPath: string): Promise<boolean> {
  const SOURCE_DIRS = ['src', 'app', 'pages', 'components'];
  for (const dir of SOURCE_DIRS) {
    try {
      const fullDir = path.join(projectPath, dir);
      const entries = await fs.readdir(fullDir, { recursive: true });
      const hasModule = entries.some((e) => typeof e === 'string' && /\.module\.(css|scss|less)$/.test(e));
      if (hasModule) return true;
    } catch {
      // Directory doesn't exist
    }
  }
  return false;
}

/**
 * Bundlers where the extension's full editing pipeline works:
 * - Dev server management (start/stop/port detection)
 * - HMR round-trip (AST write → file save → HMR → preview update)
 * - File watching (vite.config or webpack.config presence)
 *
 * Next.js was historically in READONLY_BUNDLERS due to server components +
 * SSR re-renders on file change. In practice the AST writes still persist
 * to disk and Next's Fast Refresh reloads the iframe, so the editing loop
 * works for the common client-component case. Promoted to full-edit; the
 * readonly badge stays available for genuine non-writable systems.
 */
const FULL_EDIT_BUNDLERS: import('../types').ProjectType[] = ['vite', 'cra', 'webpack', 'nextjs', 'bun'];

// 'unknown' → unsupported (no dev server management)

/**
 * Compute project capabilities based on three axes:
 * 1. CSS system (can we read/write styles?)
 * 2. Bundler (can we manage dev server + HMR round-trip?)
 * 3. Project error (can it render at all?)
 *
 * Full editing = CSS writable + bundler supports full editing
 * Readonly = preview renders but either CSS or bundler is limited
 */
export function computeCapabilities(
  cssSystem: import('../types').CssSystem,
  uiKit: 'tailwind' | 'tamagui' | 'none',
  projectError: import('../types').UnsupportedProjectError | null,
  projectType?: import('../types').ProjectType,
): import('../types').ProjectCapabilities {
  const cssWritable = WRITABLE_CSS_SYSTEMS.includes(cssSystem);
  const bundlerFullEdit = projectType ? FULL_EDIT_BUNDLERS.includes(projectType) : false;
  const canWriteStyles = cssWritable && bundlerFullEdit;
  const canRender = projectError === null;
  return {
    cssSystem,
    uiKit,
    projectType,
    canWriteStyles,
    canRender,
    readonly: canRender && !canWriteStyles,
  };
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
 * Detect package manager used in project.
 *
 * Priority: lock files → `packageManager` field in package.json → npm.
 *
 * The `packageManager` field is checked AFTER lock files because a lock file is
 * authoritative evidence of what was actually used to install. The field alone
 * (without a lock) is the case for projects that bake the manager into
 * package.json but ship without a committed lockfile (e.g. fresh templates,
 * monorepo subpackages). Skipping it here used to fall back to `npm`, which then
 * tried to forward to corepack and failed with `<manager>: not found` if the
 * shim wasn't enabled — observed on bulka-the-dog (`packageManager: pnpm@10.14.0`,
 * no lockfile) blocking dev-server bring-up.
 */
export async function detectPackageManager(projectPath: string): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
  // Check for lock files first — these are the strongest signal.
  if (await fileExists(path.join(projectPath, 'bun.lockb'))) return 'bun';
  if (await fileExists(path.join(projectPath, 'bun.lock'))) return 'bun';
  if (await fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(path.join(projectPath, 'yarn.lock'))) return 'yarn';

  // Fall back to the `packageManager` field — corepack-style declaration
  // common in projects that don't commit lock files but pin a manager.
  try {
    const pkgRaw = await fs.readFile(path.join(projectPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { packageManager?: unknown };
    if (typeof pkg.packageManager === 'string') {
      // Format is "<name>@<version>[+<integrity>]". We only need the name.
      const name = pkg.packageManager.split('@', 1)[0]?.trim().toLowerCase();
      if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') {
        return name;
      }
    }
  } catch {
    // No package.json or parse error — fall through to npm default.
  }

  return 'npm';
}
