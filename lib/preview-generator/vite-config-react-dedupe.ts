/**
 * @file Patch a user's vite.config to pin a single React identity (resolve.dedupe) and
 * pre-bundle the React/Remix client set (optimizeDeps.include), via the FileIO abstraction.
 *
 * Accessed via: PreviewFileManager.ensurePreviewFiles() on the Remix path (VS Code extension
 *               runs the user's own `npm run dev`, so the user's vite.config must be patched
 *               ON DISK — same as SaaS does at container startup).
 * Assumptions: best-effort. A missing config, a function-style config we can't statically
 *              analyze, or any parse/IO error returns false and never throws — preview
 *              generation must not break because we couldn't patch a config.
 * Invariant: IDEMPOTENT + UNION-MERGE — re-running makes no change once all entries are
 *            present, and an existing resolve.dedupe / optimizeDeps.include is preserved.
 *
 * Shares all AST transforms with scripts/patch-vite-config.ts (SaaS) via ./vite-config-ast.
 * Only the I/O transport differs: this module uses the async FileIO; the SaaS script uses
 * raw node:fs. The dual-React crash this fixes is documented in vite-config-ast.ts.
 */

import { join } from 'node:path';
import { parse as babelParse } from '@babel/parser';
import type * as t from '@babel/types';
import { parse as recastParse, print as recastPrint } from 'recast';
import type { FileIO } from '../ast/file-io';
import {
  applyReactDedupe,
  extractConfigObject,
  REACT_OPTIMIZE_DEPS_INCLUDE_GATED_CANDIDATES,
  REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS,
  reactSubpathArtifactRelPath,
  VITE_CONFIG_CANDIDATES,
} from './vite-config-ast';

// Babel parser wrapper for recast with TypeScript/JSX support.
const RECAST_BABEL_PARSER = {
  parse(source: string) {
    return babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      tokens: true,
    });
  },
};

/**
 * Is `pkg` resolvable in the project's node_modules? Gate for the bare optimizeDeps.include
 * entries. node_modules presence (not package.json deps) is the authoritative gate: it catches
 * TRANSITIVE deps (react-router / @remix-run/server-runtime live in node_modules but not in a Remix
 * template's package.json) AND guarantees Vite can resolve the include entry — adding an
 * unresolvable bare package to optimizeDeps.include breaks the dep optimizer. Best-effort: any
 * error → not installed (false), never throws. Handles scoped names (@remix-run/node →
 * node_modules/@remix-run/node/package.json) since join() preserves the slash.
 */
async function isInstalledInNodeModules(io: FileIO, projectRoot: string, pkg: string): Promise<boolean> {
  try {
    await io.access(join(projectRoot, 'node_modules', pkg, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Does a version-dependent React subpath (react/jsx-runtime, react-dom/client, …) physically
 * resolve in the project's node_modules? Same node_modules-presence mechanism as
 * {@link isInstalledInNodeModules}, but probing the subpath's real artifact (react ships these as
 * actual files — see {@link reactSubpathArtifactRelPath}). A React 16/17 project lacks the file →
 * false → the entry is skipped, so the patch never writes an unresolvable optimizeDeps.include entry
 * that would break Vite's optimizer. Best-effort: any error → false, never throws.
 */
async function isSubpathResolvable(io: FileIO, projectRoot: string, subpath: string): Promise<boolean> {
  try {
    await io.access(join(projectRoot, 'node_modules', reactSubpathArtifactRelPath(subpath)));
    return true;
  } catch {
    return false;
  }
}

/** Resolve the first existing vite.config under projectRoot, or null. */
async function findViteConfig(io: FileIO, projectRoot: string): Promise<string | null> {
  for (const candidate of VITE_CONFIG_CANDIDATES) {
    const abs = join(projectRoot, candidate);
    try {
      await io.access(abs);
      return abs;
    } catch {
      // not present — try next
    }
  }
  return null;
}

/**
 * Patch the user's vite.config in `projectRoot` to add `resolve.dedupe` + extend
 * `optimizeDeps.include` with the full Remix client graph, fixing the Remix dual-React hydration
 * crash by completing the first dep-optimize pass (no late @remix-run/node discovery → no reload).
 * The gated include entries are admitted by node_modules presence so transitive Remix/router deps
 * are covered. Returns true if the file was changed, false otherwise (no config, already patched,
 * unparseable function-config, or any error). Never throws.
 */
export async function patchViteConfigForReactDedupe(io: FileIO, projectRoot: string): Promise<boolean> {
  const configFile = await findViteConfig(io, projectRoot);
  if (!configFile) return false;

  let source: string;
  try {
    source = await io.readFile(configFile);
  } catch {
    return false;
  }

  let ast: t.File;
  try {
    ast = recastParse(source, { parser: RECAST_BABEL_PARSER }) as t.File;
  } catch {
    // Unparseable config — leave it alone.
    return false;
  }

  const configObject = extractConfigObject(ast);
  if (!configObject) {
    // Function-style config (e.g. `defineConfig(({ mode }) => ({…}))`) we can't statically
    // patch. No-op rather than throw.
    return false;
  }

  // Gate the bare third-party optimizeDeps.include entries to packages RESOLVABLE in node_modules
  // (not just package.json deps) — this catches the transitive Remix client-graph deps
  // (react-router / @remix-run/server-runtime) and guarantees Vite can resolve every include entry.
  // Gate the version-dependent React subpaths (react-dom/client, react/jsx-runtime, …) on physical
  // resolvability so a React 16/17 project (which lacks them) never gets an unresolvable entry.
  const installed = new Set<string>();
  const resolvableSubpaths = new Set<string>();
  await Promise.all([
    ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED_CANDIDATES.map(async (pkg) => {
      if (await isInstalledInNodeModules(io, projectRoot, pkg)) installed.add(pkg);
    }),
    ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS.map(async (sub) => {
      if (await isSubpathResolvable(io, projectRoot, sub)) resolvableSubpaths.add(sub);
    }),
  ]);
  const b = await import('@babel/types');
  const modified = applyReactDedupe(
    configObject,
    b,
    (pkg) => installed.has(pkg),
    (sub) => resolvableSubpaths.has(sub),
  );
  if (!modified) return false;

  let output: string;
  try {
    output = recastPrint(ast).code;
  } catch {
    return false;
  }

  try {
    await io.writeFile(configFile, output);
  } catch {
    // Write failed (read-only FS, permissions) — honor the "never throws" contract.
    return false;
  }
  return true;
}
