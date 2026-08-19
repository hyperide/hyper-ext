/**
 * @file Shared resolver: is a JSX tag's import a LOCAL monorepo workspace package (a `node_modules`
 * symlink whose `package.json` `exports`/`main`/`module` entry is real `.ts(x)`/`.jsx` SOURCE, not a
 * built external dependency)? `resolveMasterComponent` alone reports a bare package specifier as
 * `external` and gives up — for a real npm dependency that's correct (nothing to inspect), but for a
 * workspace package it's wrong: the "conloca" bug (HYP-995) — a component imported from
 * `@acme/ui` that doesn't forward `style`/`className` was silently treated as `unknown` (never
 * refused) because its declaration was never actually located.
 *
 * HYP-1235 — moved here (was two independent copies: `lib/style-write/component-forwarding.ts`'s
 * `resolveWorkspaceEntryBase` and NOTHING in `lib/style-read/forward-detect-locate.ts`, which meant
 * the ext's write-path pre-check silently lost this resolution the moment it was rewired onto the A1
 * detector — 3-model `review diff` round on HYP-1235 caught it independently across Opus/Fable/k3).
 * Both `component-forwarding.ts`'s `resolveComponentForwarding` and `forward-detect-locate.ts`'s
 * `locateComponentDeclaration` now call THIS module and retry their own resolution with a synthetic
 * alias (`{[specifier]: entryBase}`) so the existing barrel-following machinery finds the component.
 *
 * Security-hardened (traversal-guarded) — see `isSafePackageSpecifier`/`isPathWithin`'s own doc
 * comments. Do not loosen either guard without re-running this module's own traversal-specifier /
 * entry-escape security tests (`workspace-package-entry.test.ts`) and the callers' own end-to-end
 * coverage (`component-forwarding.test.ts`'s "conloca case", `forward-detect.test.ts`'s workspace-
 * package cases).
 */
import path from 'node:path';
import { findImportForName } from './jsx-deps';
import type { FileIO } from './file-io';
import type * as t from '@babel/types';

export interface WorkspacePackageEntryInput {
  /** Parsed AST of the file containing the JSX usage — used to find the tag's import declaration. */
  ast: t.File;
  /** Absolute path of the file containing the JSX usage (the search for `node_modules` starts here). */
  filePath: string;
  fileIO: FileIO;
}

/** Source extensions that mark a package entry as inspectable WORKSPACE source (vs a built `.js`
 *  external package we can't meaningfully read). `.js`/`.mjs`/`.cjs` are deliberately excluded so a
 *  real node_modules dependency (built JS + `.d.ts`) stays `unknown` and is never refused. The
 *  negative lookbehind excludes `.d.ts`/`.d.tsx` declaration files specifically — a bare `\.tsx?$`
 *  also matches the `.ts` tail of `foo.d.ts`, which has no function bodies to inspect. */
const WORKSPACE_ENTRY_SOURCE = /(?<!\.d)\.(tsx?|jsx)$/;

/**
 * When `tagName`'s import in `input.ast` is a BARE specifier that resolves to a LOCAL monorepo
 * workspace package (a `node_modules/<pkg>` — usually a symlink into the repo — whose `package.json`
 * entry is a `.ts(x)`/`.jsx` SOURCE file), return the specifier + the entry's base path (extension
 * stripped) so the caller can resolve the component through its own normal alias/barrel machinery
 * (`aliasMap: {...aliasMap, [specifier]: entryBase}`). Returns null for a relative import, a real
 * built external package (entry is `.js`/`.d.ts`), or anything unreadable — those stay `unknown`
 * (fail-open; never refuse a write on a guess).
 */
export async function resolveWorkspacePackageEntry(
  input: WorkspacePackageEntryInput,
  tagName: string,
): Promise<{ specifier: string; entryBase: string } | null> {
  const specifier = findImportForName(input.ast, tagName)?.declaration.source.value;
  // Only a well-formed BARE package specifier. Reject relative/absolute AND any `.`/`..`/empty segment
  // or backslash — a crafted specifier like `foo/../../../etc` must never let the node_modules path
  // interpolation escape the package dir (review P1 security / path traversal).
  if (!specifier || !isSafePackageSpecifier(specifier)) return null;

  const pkgJsonPath = await findNodeModulesPackageJson(input.filePath, specifier, input.fileIO);
  if (!pkgJsonPath) return null;
  const packageDir = path.dirname(pkgJsonPath);
  const entryRel = await readPackageEntry(pkgJsonPath, input.fileIO);
  if (!entryRel) return null;

  const entryAbs = path.resolve(packageDir, entryRel);
  // The package.json `entry` field is also untrusted input — a `../../..` entry must not point the
  // reader outside the package directory (review P1 security).
  if (!isPathWithin(packageDir, entryAbs)) return null;
  if (!WORKSPACE_ENTRY_SOURCE.test(entryAbs)) return null; // built/external — leave as unknown
  return { specifier, entryBase: entryAbs.replace(WORKSPACE_ENTRY_SOURCE, '') };
}

/** A bare package specifier safe to interpolate into a `node_modules/<spec>` path: not relative or
 *  absolute, and with no `.`/`..`/empty segment or backslash that could traverse out. Accepts an
 *  optional `@scope/` and subpath (e.g. `@acme/ui`, `lib/sub`). */
function isSafePackageSpecifier(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes('\\')) return false;
  return specifier.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** True when `target` is `base` itself or nested inside it (no `..` escape, not an absolute sibling). */
function isPathWithin(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Walk up from the importer's directory looking for `node_modules/<specifier>/package.json`. Returns
 *  the first that exists (and stays inside that `node_modules`), or null. Bounded against spinning. */
async function findNodeModulesPackageJson(
  importerFilePath: string,
  specifier: string,
  fileIO: FileIO,
): Promise<string | null> {
  let dir = path.dirname(importerFilePath);
  for (let i = 0; i < 40; i++) {
    const nodeModules = path.join(dir, 'node_modules');
    const candidate = path.join(nodeModules, specifier, 'package.json');
    // Defense in depth (the specifier is already validated): never accept a path that resolved out of
    // this `node_modules` directory.
    if (isPathWithin(nodeModules, candidate)) {
      try {
        await fileIO.access(candidate);
        return candidate;
      } catch {
        // not here — keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return null;
}

/** Read a package.json's entry, preferring `exports['.']` (string or common conditions), then
 *  `module`/`main`/`types`. Returns the entry path (relative to the package) or null. */
async function readPackageEntry(pkgJsonPath: string, fileIO: FileIO): Promise<string | null> {
  let pkg: {
    exports?: unknown;
    module?: string;
    main?: string;
    types?: string;
  };
  try {
    pkg = JSON.parse(await fileIO.readFile(pkgJsonPath));
  } catch {
    return null;
  }
  return entryFromExports(pkg.exports) ?? pkg.module ?? pkg.main ?? pkg.types ?? null;
}

/** Pull a usable entry path from a package.json `exports` field: a bare string, or the `.` subpath as a
 *  string or a conditions object (preferring source-ish conditions before `default`/`import`). */
function entryFromExports(exports: unknown): string | null {
  if (typeof exports === 'string') return exports;
  if (!exports || typeof exports !== 'object') return null;
  const dot = (exports as Record<string, unknown>)['.'];
  if (typeof dot === 'string') return dot;
  if (dot && typeof dot === 'object') {
    for (const condition of ['source', 'development', 'import', 'default', 'require']) {
      const value = (dot as Record<string, unknown>)[condition];
      if (typeof value === 'string') return value;
    }
  }
  return null;
}
