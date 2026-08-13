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
import * as os from 'node:os';
import * as path from 'node:path';
import { invokesBunRuntime, readNxDevCommand } from '@lib/preview-generator/framework-routing';
import type { NxPackageJson } from '@lib/preview-generator/framework-routing';
import { getWriterBackedCssSystemIds } from '@lib/style-adapters/registry';
import type { UiKitLabel } from '@lib/ui-kit';
import type { CssSystem, ProjectInfo, ProjectType, RepoType, UnsupportedProjectError } from '../types';
import { CSS_SYSTEM_TO_ADAPTER_ID } from '../types';

/**
 * The `CssSystemId`s that have a real NATIVE writer registered, computed ONCE from the shared
 * adapter registry (spec §3.3). This is the single source of truth behind the writable gate — the
 * detector never keeps its own list of editable systems.
 */
const WRITER_BACKED_CSS_SYSTEM_IDS = getWriterBackedCssSystemIds();

/**
 * Registry-derived writable predicate (spec §3.3 TO-BE: "a system is writable only when its
 * [adapter] ... exists"). Translates the ext `CssSystem` to its lib `CssSystemId` (the
 * cssFramework/designSystem axis crossing, §5.5) and reports writable iff that id owns a native,
 * non-fallback writer.
 *
 * User impact: this is what stops the inspector from claiming emotion/styled-components are editable
 * when no adapter exists — emotion no longer silently writes a foreign inline `style={{}}` into the
 * user's file, and styled-components no longer dead-ends at the executor's `unsupported()` no-op.
 * Both now show the honest readonly stub until their adapters land (Phase C+).
 */
function isCssSystemWritable(cssSystem: CssSystem): boolean {
  const adapterId = CSS_SYSTEM_TO_ADAPTER_ID[cssSystem];
  return adapterId !== null && WRITER_BACKED_CSS_SYSTEM_IDS.has(adapterId);
}

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

  // Generic workspaces (npm/yarn workspaces field in package.json).
  // Two forms: array ["packages/*"] or object { packages: ["packages/*"] } (Yarn/npm v7+).
  if (pkg) {
    const ws = (pkg as { workspaces?: unknown }).workspaces;
    const isMonorepo =
      Array.isArray(ws) ||
      (typeof ws === 'object' && ws !== null && Array.isArray((ws as { packages?: unknown }).packages));
    if (isMonorepo) return 'mono-generic';
  }

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
 *
 * Exported (additive) so the support-dimension framework render-gate (support-dimensions.ts)
 * can reuse the same "is there React source?" signal for the no-dependency 'none' case,
 * instead of duplicating the scan.
 */
export async function hasReactSourceFiles(memberPath: string): Promise<boolean> {
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
 * Disambiguate multiple runnable monorepo targets (resolveRunnableTargets) using a file path
 * the CALLER has already identified as "what the user is looking at" — e.g. the previewed
 * component (preferred) or the active editor. This function itself has no opinion on WHICH
 * file to use; extension.ts's `resolveOpenFilePath` owns that precedence.
 *
 * HYP-1104: when a monorepo root has 2+ equally-runnable sub-projects (e.g. targets/web AND
 * targets/admin both ship their own dev script + React), prepareDevServerTarget in
 * extension.ts used to ALWAYS defer to a blocking `vscode.window.showQuickPick`, even when the
 * caller already knows exactly which target the user means (they have a file open inside one
 * of them). An automated context (E2E/CI) can never answer that modal, so the dev-server start
 * hangs until DevServerControls' 90s poll times out. This resolves the obvious case without
 * guessing: if `openFilePath` sits inside exactly one containment CHAIN of candidate target
 * directories, return the most specific (deepest) one; otherwise return null so the caller
 * falls back to the QuickPick (unchanged behavior — never guess across a real ambiguity).
 *
 * Path containment is prefix-matched on the RESOLVED (absolute, normalized) paths with a
 * trailing separator boundary, so a target directory whose name is a string-prefix of a
 * sibling (`targets/web` vs `targets/web-admin`) can never falsely match the sibling's file.
 * Comparison is case-INSENSITIVE off Linux (matching `path.resolve`'s own platform-native
 * behavior is not enough here — macOS/Windows filesystems are case-preserving but
 * case-insensitive, and VS Code's `uri.fsPath` casing does not always match the casing a
 * directory scan produced) so a casing difference can't silently defeat the match and
 * regress to the exact QuickPick hang this function exists to avoid.
 *
 * Two or more matches can only happen when the candidate target directories NEST (one
 * contains another) — sibling directories can never both contain the same file. In that case
 * the deepest (longest resolved path) match is the unambiguous, most-specific answer, not a
 * real ambiguity.
 */
export function pickRunnableTargetForFile(targets: string[], openFilePath: string | undefined): string | null {
  if (!openFilePath) return null;
  const comparable = (p: string) => (process.platform === 'linux' ? p : p.toLowerCase());
  const normalizedFile = path.resolve(openFilePath);
  const fileKey = comparable(normalizedFile);
  const matches = targets.filter((target) => {
    const targetKey = comparable(path.resolve(target));
    return fileKey === targetKey || fileKey.startsWith(targetKey + path.sep);
  });
  if (matches.length === 0) return null;
  return matches.reduce((deepest, candidate) => (candidate.length > deepest.length ? candidate : deepest));
}

/**
 * Editor URI schemes whose `fsPath` is a real, locally-runnable project file. `file` covers a
 * plain local workspace; `vscode-remote` covers Remote-SSH / Dev Containers / Codespaces, where
 * the dev server still runs on the SAME host the extension host is attached to, so the fsPath is
 * just as usable for containment matching (HYP-1104). Deliberately EXCLUDES `vscode-vfs`
 * (Remote Repositories / GitHub virtual filesystem): there is no local checkout to run a dev
 * server against, so treating its fsPath as a real target would be wrong.
 */
export function isResolvableEditorScheme(scheme: string): boolean {
  return scheme === 'file' || scheme === 'vscode-remote';
}

/**
 * Disambiguate multiple runnable monorepo targets using ALL currently visible editors, not just
 * one. `resolveOpenFilePath` (extension.ts) already prefers StateHub, then the active editor —
 * this is the next fallback: when neither is available (or doesn't resolve to a target), check
 * whether the visible editors that DO fall inside a target all agree on the SAME one. A visible
 * editor that matches no target at all (README.md, a config file, docs — anything outside every
 * candidate directory) casts no vote either way; it is not evidence of ambiguity, since plenty of
 * legitimately-open tabs never live inside any monorepo target. Agreement among the matching
 * tabs is still a strong, non-guessing signal (e.g. two files open side-by-side, both inside
 * `targets/web`, with a third tab open on the repo README). A SPLIT — visible editors
 * implicating 2+ DISTINCT targets (e.g. one tab in `targets/web`, another in `targets/admin`) —
 * IS a real ambiguity: return null so the caller falls back to the QuickPick rather than silently
 * picking whichever target happens to be first in the array.
 */
export function pickRunnableTargetForVisibleEditors(targets: string[], visibleFilePaths: string[]): string | null {
  const comparable = (p: string) => (process.platform === 'linux' ? p : p.toLowerCase());
  const resolvedMatches = new Set<string>();
  for (const filePath of visibleFilePaths) {
    const match = pickRunnableTargetForFile(targets, filePath);
    if (match) resolvedMatches.add(comparable(path.resolve(match)));
  }
  if (resolvedMatches.size !== 1) return null;
  const [onlyMatchKey] = resolvedMatches;
  return targets.find((target) => comparable(path.resolve(target)) === onlyMatchKey) ?? null;
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
  // bun-plugin-* deps or a dev script invoking the bun runtime also count.
  //
  // HYP-904: `devScript` alone misses an nx-monorepo passthrough (`scripts.dev` = "nx run
  // <pkg>:dev --outputStyle=stream"), whose REAL host command lives one level deeper at
  // `nx.targets.dev.options.command` (conloca's cms-spa: `bun --bun --hot dev-server.tsx`).
  // Read both, exactly like framework-routing.ts::detectFramework's own Bun-app signal —
  // shares that file's `invokesBunRuntime` word-boundary check instead of this function's
  // former looser regex (`/\bbun\s+(--hot|--watch|src\/|index\.)/`, which required a
  // specific flag immediately after "bun" and so missed "bun --bun --hot ...").
  const hasBunTypes = Boolean(deps['@types/bun']);
  const hasBunPlugin = Object.keys(deps).some((k) => k.startsWith('bun-plugin-'));
  const scripts = packageJson.scripts as Record<string, string> | undefined;
  const devScript = scripts?.dev ?? scripts?.start ?? '';
  const nxDevCommand = readNxDevCommand(packageJson as NxPackageJson);
  const bunDirectInvocation = invokesBunRuntime(devScript) || invokesBunRuntime(nxDevCommand);
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
): Promise<UiKitLabel> {
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
  // Chakra UI is emotion-based: users list @emotion/react + @emotion/styled
  // DIRECTLY in package.json (peer-dep install pattern — required for v2, common
  // for v3), so `has('@emotion/...')` is true for Chakra projects. Chakra MUST be
  // checked BEFORE the bare emotion fallback below so the project reports the
  // correct system identity (chakra reads/deep-links differently than emotion).
  // Both 'chakra' and 'emotion' now map to writer-less CssSystemIds, so the
  // registry-derived writable gate (computeCapabilities → isCssSystemWritable)
  // reports BOTH readonly → the readonly stub shows until their adapters land
  // (§3.3 / D31). MUI (@mui/material) is also emotion-based and has the same
  // shadowing; it keeps resolving to 'emotion' (also readonly) — do not reorder
  // the @mui branch with this change.
  if (has('@chakra-ui/react')) return 'chakra';
  if (has('@emotion/react') || has('@emotion/styled')) return 'emotion';

  // Component libraries (check after CSS-in-JS since they often bring their own)
  if (has('@mui/material') || has('@mui/system')) return 'mui';
  if (has('antd') || has('@ant-design/icons')) return 'antd';
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
      // NB: no chakra-before-emotion check here, unlike the root path above. This
      // branch runs on the MERGED dep map of EVERY sub-package (readSubPackageDeps
      // unions all members), but detectCssSystem returns ONE cssSystem applied to the
      // WHOLE workspace. A merged-map chakra check (HYP-786 / PR #544, reverted in this
      // commit after a codex P2) forced the whole workspace to 'chakra'/readonly when
      // any single sibling merely depended on @chakra-ui/react — disabling style
      // editing for an unrelated pure-Emotion app in the same monorepo. Correctly
      // scoping chakra precedence needs PER-TARGET detection (the selected member's own
      // deps, not the union), which the current single-result API can't express.
      // Tracked as HYP-787. Until then the monorepo path keeps emotion writable — the
      // regression-free choice (a false-writable chakra monorepo target is the lesser
      // evil vs a false-readonly Emotion app).
      if (hasSub('@emotion/react') || hasSub('@emotion/styled')) return 'emotion';
      if (hasSub('tailwindcss') || hasSub('@astrojs/tailwind') || hasSub('@tailwindcss/vite')) return 'tailwind';
    }
  }

  return 'unknown';
}

/**
 * Dependency signals for each CSS system, in detection priority order (most specific
 * first). Single source of truth for the per-member `detectCssSystems` set detector.
 *
 * Deliberately NOT reused by the singular `detectCssSystem` above: that function has a
 * load-bearing chakra-before-emotion ordering, tailwind-design-system precedence, and a
 * monorepo sibling-union fallback whose exact behavior is pinned by HYP-786/HYP-787
 * regression tests. Re-expressing it through this table risks silently shifting one of
 * those results, so the two stay independent (the singular is left byte-for-byte).
 *
 * Each entry: the CssSystem key + the package.json dependency names that prove it.
 * `cssmodules` is absent here — it has no dependency and is detected by scanning source
 * for *.module.css files (hasCssModuleFiles), appended separately.
 */
const CSS_SYSTEM_SIGNALS: ReadonlyArray<{ system: CssSystem; deps: readonly string[] }> = [
  { system: 'shadcn', deps: ['@shadcn/ui', 'class-variance-authority'] },
  { system: 'daisyui', deps: ['daisyui'] },
  { system: 'nextui', deps: ['@nextui-org/react', '@nextui-org/theme'] },
  { system: 'tamagui', deps: ['tamagui', '@tamagui/core'] },
  { system: 'vanilla-extract', deps: ['@vanilla-extract/css'] },
  { system: 'pandacss', deps: ['@pandacss/dev', 'pandacss'] },
  { system: 'unocss', deps: ['unocss', '@unocss/preset-uno'] },
  { system: 'stylex', deps: ['@stylexjs/stylex', 'stylex'] },
  { system: 'styled-components', deps: ['styled-components'] },
  { system: 'chakra', deps: ['@chakra-ui/react'] },
  { system: 'emotion', deps: ['@emotion/react', '@emotion/styled'] },
  { system: 'mui', deps: ['@mui/material', '@mui/system'] },
  { system: 'antd', deps: ['antd', '@ant-design/icons'] },
  { system: 'mantine', deps: ['@mantine/core'] },
  { system: 'fluentui', deps: ['@fluentui/react-components', '@fluentui/react'] },
  { system: 'tailwind', deps: ['tailwindcss', '@astrojs/tailwind', '@tailwindcss/vite'] },
  { system: 'sass', deps: ['sass', 'node-sass', 'sass-embedded'] },
];

/**
 * Detect the COMPLETE SET of CSS systems present for a single project/member root —
 * every matching dependency in that member's OWN package.json, not the single
 * priority-winner and NOT a union across sibling packages.
 *
 * This is the root-cause fix for HYP-787 (master-spec §5.6 — "the complete set of css
 * systems per project, not a single winner"). The singular `detectCssSystem` collapses
 * to one system for the whole workspace and its monorepo fallback UNIONS all sub-package
 * deps, so one Chakra sibling poisons the whole workspace into readonly. Callers that
 * resolve the active sub-project root (resolveActiveProjectRoot) and pass it here get a
 * per-member set: a tailwind+emotion app stays writable even when a chakra sibling exists.
 *
 * Additive — the singular detector is unchanged. Pass the MEMBER root (never the
 * monorepo root) so the set reflects exactly that member.
 *
 * Returns systems in priority order (CSS_SYSTEM_SIGNALS order, then cssmodules). Empty
 * when the member declares no recognizable CSS system.
 */
export async function detectCssSystems(
  projectPath: string,
  packageJson?: Record<string, unknown> | null,
): Promise<CssSystem[]> {
  const pkg = packageJson ?? (await readPackageJson(projectPath));
  const found: CssSystem[] = [];

  if (pkg) {
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    for (const { system, deps: signals } of CSS_SYSTEM_SIGNALS) {
      if (signals.some((name) => name in deps)) found.push(system);
    }
  }

  // CSS Modules have no dependency — detect by scanning the member's own source.
  if (await hasCssModuleFiles(projectPath)) found.push('cssmodules');

  return found;
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
  uiKit: UiKitLabel,
  projectError: import('../types').UnsupportedProjectError | null,
  projectType?: import('../types').ProjectType,
  repoType?: RepoType,
): import('../types').ProjectCapabilities {
  const cssWritable = isCssSystemWritable(cssSystem);
  const bundlerFullEdit = projectType ? FULL_EDIT_BUNDLERS.includes(projectType) : false;
  const canWriteStyles = cssWritable && bundlerFullEdit;
  const canRender = projectError === null;
  const readonly = canRender && !canWriteStyles;
  const readonlyReason: import('../types').ProjectCapabilities['readonlyReason'] = !readonly
    ? undefined
    : cssWritable
      ? 'bundler'
      : bundlerFullEdit
        ? 'css'
        : 'both';
  return {
    cssSystem,
    uiKit,
    projectType,
    repoType,
    canWriteStyles,
    canRender,
    readonly,
    readonlyReason,
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
 * Lock files that identify a package manager, strongest first within one
 * directory. `package-lock.json` is LAST so a stale npm lock inside a
 * bun/pnpm/yarn-managed directory never flips detection — but a nested
 * npm-managed project (its own package-lock.json, ancestor bun.lock) still
 * stops the walk-up at its own lock instead of inheriting the ancestor
 * manager (PR #692 review).
 */
const PACKAGE_MANAGER_LOCKFILES: ReadonlyArray<readonly [string, 'npm' | 'yarn' | 'pnpm' | 'bun']> = [
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/** Lock file directly inside `dir` and the package manager it names, or null. */
async function lockfileInDir(dir: string): Promise<{ path: string; manager: 'npm' | 'yarn' | 'pnpm' | 'bun' } | null> {
  for (const [file, manager] of PACKAGE_MANAGER_LOCKFILES) {
    const candidate = path.join(dir, file);
    if (await fileExists(candidate)) return { path: candidate, manager };
  }
  return null;
}

/** Case-insensitive-off-Linux directory comparison (macOS/Windows filesystems are case-insensitive). */
function sameDirectory(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === 'linux' ? ra === rb : ra.toLowerCase() === rb.toLowerCase();
}

/**
 * Shared ancestor-walk primitive behind the lockfile / workspace-root walks
 * (PR #692 review: three hand-rolled copies had drifted apart). Yields
 * `startDir` and each ancestor in turn, bounded by the user's home directory:
 * `$HOME` itself is yielded only when it IS `startDir` (a project living
 * directly in the home dir still gets its own files checked), and the walk
 * NEVER ascends into it from below or above it. Without this bound a project
 * with no `.git` anywhere above it walked to the filesystem root and could
 * inherit a stray `~/bun.lock` / `~/nx.json` — files in `$HOME` are not
 * project evidence. Consumers layer their own stop conditions (e.g. the VCS
 * root) on top.
 */
function* ancestorDirs(startDir: string, homeDir: string = os.homedir()): Generator<string> {
  let dir = startDir;
  for (;;) {
    const atHome = sameDirectory(dir, homeDir);
    if (atHome && !sameDirectory(dir, startDir)) return; // reached $HOME from below — do not enter
    yield dir;
    if (atHome) return; // $HOME as startDir: check it, never ascend above
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Filesystem markers that identify a workspace/install root while walking up
 * from a monorepo subpackage: any package-manager lock file, a task-runner
 * config (nx/turbo), a pnpm workspace manifest, or the VCS root (`.git`).
 */
const WORKSPACE_ROOT_MARKERS: readonly string[] = [
  ...PACKAGE_MANAGER_LOCKFILES.map(([file]) => file),
  'nx.json',
  'turbo.json',
  'pnpm-workspace.yaml',
  '.git',
];

/**
 * Nearest ancestor of `startDir` (inclusive) that looks like the workspace /
 * install root — the directory monorepo task-runner commands (nx, turbo) must
 * be spawned from (HYP-1160: the Nx project graph fails to resolve when `nx
 * run …` executes with cwd inside a subpackage). Returns `startDir` when no
 * marker exists anywhere above. The walk never ascends into or above `$HOME`
 * (PR #692 review) — a stray `~/nx.json` must not make the home directory the
 * spawn cwd.
 */
export async function findWorkspaceRoot(startDir: string, homeDir: string = os.homedir()): Promise<string> {
  for (const dir of ancestorDirs(startDir, homeDir)) {
    for (const marker of WORKSPACE_ROOT_MARKERS) {
      if (await fileExists(path.join(dir, marker))) return dir;
    }
  }
  return startDir;
}

/**
 * Detect package manager used in project.
 *
 * Priority: lock files (nearest ancestor first) → `packageManager` field in
 * package.json → npm.
 *
 * Monorepo subpackages don't carry their own lock file — the lock lives at the
 * install root — so the lock-file check walks UP from `projectPath` to the
 * workspace root (HYP-1160: conloca's targets/conloca-app has no lockfile, the
 * repo root has bun.lock; detecting from the app dir used to fall through to
 * npm). The walk is bounded by the VCS root (the first ancestor containing
 * `.git`, inclusive) so a stray lockfile above the repository never leaks in,
 * and by `$HOME` (exclusive) so a stray `~/bun.lock` is not inherited either
 * when no `.git` exists anywhere above (PR #692 review).
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
export async function detectPackageManager(
  projectPath: string,
  homeDir: string = os.homedir(),
): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
  // Check for lock files first — these are the strongest signal. The walk-up
  // (workspace root, bounded by the VCS root AND $HOME) is shared with
  // detectPackageManagerLockfile so the two can never disagree (PR #692 review).
  const lockfile = await detectPackageManagerLockfile(projectPath, homeDir);
  if (lockfile) return lockfile.manager;

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

/**
 * The lock file that would determine {@link detectPackageManager}, and the
 * package manager it names — the package-manager EVIDENCE for a project, used
 * to invalidate a persisted dev-server spawn plan when the evidence
 * CONFIDENTLY contradicts it (a lock file naming a different package manager means a
 * package-manager migration). Walks up from `projectPath` bounded by the VCS
 * root AND `$HOME` (PR #692 review), exactly like detectPackageManager — the
 * two share the walk so they can never disagree. Returns null when no lock file is
 * present (pm came from the package.json field or the npm fallback) — absent
 * evidence must never invalidate a plan.
 */
export async function detectPackageManagerLockfile(
  projectPath: string,
  homeDir: string = os.homedir(),
): Promise<{ path: string; manager: 'npm' | 'yarn' | 'pnpm' | 'bun' } | null> {
  for (const dir of ancestorDirs(projectPath, homeDir)) {
    const lockfile = await lockfileInDir(dir);
    if (lockfile) return lockfile;
    if (await fileExists(path.join(dir, '.git'))) break; // VCS root — stop
  }
  return null;
}
