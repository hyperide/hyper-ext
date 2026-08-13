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
import type { ProjectInfo, ProjectType, RepoType, UnsupportedProjectError } from '../types';
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
 * Detect monorepo topology for the workspace root.
 * Returns 'simple' for ordinary single-package projects.
 */
export async function detectRepoType(projectPath: string): Promise<RepoType> {
  const pkg = await readPackageJson(projectPath);
  const allDeps = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  };

  // Nx: nx.json config file OR nx package in deps
  if ((await fileExists(path.join(projectPath, 'nx.json'))) || allDeps.nx) return 'mono-nx';

  // Turborepo: turbo.json config file OR turbo in deps
  if ((await fileExists(path.join(projectPath, 'turbo.json'))) || allDeps.turbo) return 'mono-turbo';

  // pnpm workspaces: pnpm-workspace.yaml
  if (await fileExists(path.join(projectPath, 'pnpm-workspace.yaml'))) return 'mono-pnpm';

  // Lerna
  if (await fileExists(path.join(projectPath, 'lerna.json'))) return 'mono-lerna';

  // Generic workspaces (npm/yarn workspaces field in package.json)
  if (pkg && Array.isArray((pkg as { workspaces?: unknown }).workspaces)) return 'mono-generic';

  return 'simple';
}

/**
 * Read merged deps from all sub-packages in a monorepo.
 * Scans apps/ and packages/ directories one level deep.
 */
async function readSubPackageDeps(projectPath: string): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  // Common sub-package directory names across different monorepo conventions
  for (const dir of ['apps', 'packages', 'targets', 'libs', 'services']) {
    try {
      const entries = await fs.readdir(path.join(projectPath, dir));
      for (const entry of entries) {
        const sub = await readPackageJson(path.join(projectPath, dir, entry));
        if (sub) {
          Object.assign(merged, sub.dependencies as Record<string, string> | undefined);
          Object.assign(merged, sub.devDependencies as Record<string, string> | undefined);
        }
      }
    } catch {
      // dir doesn't exist — skip
    }
  }
  return merged;
}

/**
 * Conventional directories that hold monorepo member packages. Mirrors the
 * WORKSPACE_DIRS list the component scanner uses for the SubProjectAccordion and
 * the dirs readSubPackageDeps scans, so dev-server target resolution and the
 * Explorer agree on what counts as a sub-project.
 */
const WORKSPACE_MEMBER_DIRS = ['targets', 'apps', 'packages', 'libs', 'services'] as const;

/**
 * Decide whether a monorepo member package is a renderable React front-end — the only
 * kind we can show in the preview iframe. Mirrors the component scanner's
 * `ComponentScanner.checkSubProjectSupport` (lib/component-scanner/scanner.ts), which is
 * the source of truth for "is this sub-project supported": reject Vue/Svelte/Angular, then
 * accept when react/react-native is declared OR the member ships `.tsx`/`.jsx` source files
 * (React deps hoisted to the workspace root are common in monorepos, so a missing local dep
 * is not proof a package is non-renderable). Kept in sync deliberately rather than imported —
 * that method is a private, sync class method and this module is async + dependency-light.
 */
async function isRenderableReactTarget(memberPath: string, pkg: Record<string, unknown> | null): Promise<boolean> {
  const deps = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
    ...(pkg?.peerDependencies as Record<string, string> | undefined),
  };

  // Non-React frontends the scanner explicitly rejects.
  if (deps.vue || deps['@vue/core'] || deps.svelte || deps['@angular/core']) return false;

  // React (web or native) declared locally → renderable in the preview.
  if (deps.react || deps['react-native']) return true;

  // No local React dep — fall back to scanning for JSX/TSX source, the same signal the
  // scanner uses. Scoped to conventional source dirs (mirrors hasCssModuleFiles) so we
  // never descend into node_modules.
  return hasReactSourceFiles(memberPath);
}

/**
 * Check whether a package directory ships React source (.tsx/.jsx) under its common
 * source directories. Mirrors hasCssModuleFiles' scan shape so it stays compatible with
 * the same fs.readdir behavior and avoids walking node_modules.
 */
async function hasReactSourceFiles(memberPath: string): Promise<boolean> {
  const SOURCE_DIRS = ['src', 'app', 'pages', 'components'];
  for (const dir of SOURCE_DIRS) {
    try {
      const entries = await fs.readdir(path.join(memberPath, dir), { recursive: true });
      if (entries.some((e) => typeof e === 'string' && /\.(tsx|jsx)$/.test(e))) return true;
    } catch {
      // Directory doesn't exist — skip
    }
  }
  return false;
}

/**
 * Resolve monorepo member packages that can run a dev server AND render in the preview —
 * i.e. have their own `dev`/`start` script and are a React front-end. Scans the
 * conventional workspace dirs one level deep.
 *
 * Used by the dev-server start path (HYP-431) when a monorepo is opened at the repo
 * ROOT and the server is started (or autostart fires) BEFORE any component is
 * selected. The root often has no runnable dev/start script — only a target does —
 * so start() would fail with "No dev or start script". This finds the runnable
 * target(s) so the caller can re-root the preview/dev axis to the right sub-project
 * (one target → start it; many → defer with an actionable message; none → let the
 * existing error stand).
 *
 * The renderable filter (HYP-434 P2): a backend package (e.g. services/api with a `dev`
 * script but no React — Express/Hono) is NOT a valid preview target. Auto-starting it
 * would point the preview URL at an API server that never renders. So such packages are
 * excluded here; if they are the only runnable members the result is empty → caller
 * defers (same as the no-runnable-target path) instead of autostarting a non-renderable
 * backend.
 *
 * Returns absolute paths of runnable, renderable member packages. Empty when none qualify
 * (a monorepo of pure libraries, only non-renderable backends, or a single-package project).
 */
export async function resolveRunnableTargets(projectPath: string): Promise<string[]> {
  const runnable: string[] = [];

  for (const dir of WORKSPACE_MEMBER_DIRS) {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(projectPath, dir));
    } catch {
      continue; // dir doesn't exist — skip
    }

    for (const entry of entries) {
      const memberPath = path.join(projectPath, dir, entry);
      // Read package.json once and derive both the scripts and the renderable check.
      const pkg = await readPackageJson(memberPath);
      const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
      if ((scripts.dev || scripts.start) && (await isRenderableReactTarget(memberPath, pkg))) {
        runnable.push(memberPath);
      }
    }
  }

  return runnable;
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

  // Monorepo fallback: root package.json had no framework dep, but a sub-package might
  const repoType = await detectRepoType(projectPath);
  if (repoType !== 'simple') {
    const subDeps = await readSubPackageDeps(projectPath);
    if (subDeps.next) return 'nextjs';
    if (subDeps['react-scripts']) return 'cra';
    if (subDeps['@remix-run/react']) return 'remix';
    if (subDeps.astro) return 'vite';
    if (subDeps.vite) return 'vite';
    if (subDeps.webpack || subDeps['webpack-dev-server']) return 'webpack';
  }

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

  // Monorepo fallback: root package.json had no CSS dep, check sub-packages.
  // Runs regardless of whether packageJson was pre-resolved — by the time we reach
  // here, we know root has nothing. Skipping it when pkg is pre-passed (the production
  // path from extension.ts) would leave Conloca targets/ tailwindcss invisible.
  {
    const repoType = await detectRepoType(projectPath);
    if (repoType !== 'simple') {
      const subDeps = await readSubPackageDeps(projectPath);
      const hasSub = (name: string) => name in subDeps;
      if (hasSub('@shadcn/ui') || hasSub('class-variance-authority')) return 'shadcn';
      if (hasSub('daisyui')) return 'daisyui';
      if (hasSub('tamagui') || hasSub('@tamagui/core')) return 'tamagui';
      if (hasSub('styled-components')) return 'styled-components';
      if (hasSub('@emotion/react') || hasSub('@emotion/styled')) return 'emotion';
      if (hasSub('tailwindcss') || hasSub('@astrojs/tailwind') || hasSub('@tailwindcss/vite')) return 'tailwind';
    }
  }

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
  repoType?: RepoType,
): import('../types').ProjectCapabilities {
  const cssWritable = WRITABLE_CSS_SYSTEMS.includes(cssSystem);
  const bundlerFullEdit = projectType ? FULL_EDIT_BUNDLERS.includes(projectType) : false;
  const canWriteStyles = cssWritable && bundlerFullEdit;
  const canRender = projectError === null;
  return {
    cssSystem,
    uiKit,
    projectType,
    repoType,
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
