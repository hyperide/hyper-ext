/**
 * @file Resolve a selected element's component reference to its master
 * component DEFINITION location.
 *
 * Powers the inspector "Go to main component" button (HYP-563) — the Figma-style
 * affordance that jumps from a selected instance (`<Button>` call-site) to the
 * component source (`Button.tsx`, where it is defined).
 *
 * Accessed via: VS Code extension PreviewPanel (`master:goToComponent` RPC). The
 * pure resolver here is platform-agnostic; file reads go through the `FileIO`
 * abstraction, so a SaaS server route can reuse it unchanged.
 *
 * Assumptions:
 * - `componentName` is the LEFTMOST JSX identifier of the tag (caller flattens
 *   `<Foo.Bar>` to `Foo` — the imported binding).
 * - `aliasMap` maps a tsconfig path-alias PREFIX to an absolute directory prefix,
 *   e.g. `{ '@/': '/abs/src/' }`. Provided by the call site from the project
 *   tsconfig; relative imports never need it.
 *
 * Scope (intentional): relative + alias + extension/index resolution + ONE level
 * of barrel re-export. Anything beyond (deep barrel chains, wildcard re-exports,
 * webpack/vite-only aliases) falls through to `not-found`; the VS Code call site
 * can fall back to the language server's definition provider for those.
 */

import * as path from 'node:path';
import * as t from '@babel/types';
import type { FileIO } from './file-io';
import { findImportForName } from './jsx-deps';
import { parseCode } from './parser';

/** Candidate extensions, in resolution priority order. */
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

export type MasterComponentResolution =
  /**
   * Resolved to a local component definition file. `pinpointed` is true when the
   * symbol's own declaration was located; false when resolution only reached the
   * file (e.g. a barrel `index.ts` the symbol is re-exported through) — callers
   * may then prefer a language-server backstop for a more precise target.
   */
  | { kind: 'local'; filePath: string; line: number; column: number; componentName: string; pinpointed: boolean }
  /** Tag is a lowercase DOM/host element (`div`, `span`) — no master component. */
  | { kind: 'host' }
  /** Component is defined inline in the same file — no navigation target distinct from the element. */
  | { kind: 'inline' }
  /** Component is imported from an external package (node_modules / bare specifier). */
  | { kind: 'external'; packageName: string }
  /** Import found but its target file could not be located on disk. */
  | { kind: 'not-found' };

export interface ResolveMasterComponentOptions {
  /** Absolute path of the file containing the JSX usage (the importer). */
  importerFilePath: string;
  /** Source code of the importer file. */
  importerSource: string;
  /** Leftmost JSX identifier of the selected tag, e.g. `Button`. */
  componentName: string;
  /** File reader abstraction (Node fs / VS Code workspace / server). */
  fileIO: FileIO;
  /** tsconfig path-alias prefixes → absolute directory prefixes. */
  aliasMap?: Record<string, string>;
}

/** A JSX tag is a host element when its name starts with a lowercase letter. */
function isHostTag(name: string): boolean {
  const first = name.charCodeAt(0);
  return first >= 97 && first <= 122; // a-z
}

/** Bare specifiers (no `.` / `/` leading, not an alias) resolve into node_modules. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/');
}

/** Extract the npm package name from a bare specifier (`@scope/pkg/sub` → `@scope/pkg`). */
function packageNameFromSpecifier(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? specifier;
}

/**
 * Apply a tsconfig path-alias map to a specifier. Returns the rewritten
 * (absolute) base path without extension, or null when no alias matches.
 *
 * Exported for reuse by the HYP-880 static preview-wrapper scaffold, which needs
 * the exact same alias resolution when following `import App from '@/App'`-style
 * entry imports (previously relative-only — a common Vite/Next `@/*` alias would
 * silently stop the provider-chain walk and degrade to the bare fallback).
 */
export function applyAlias(specifier: string, aliasMap: Record<string, string> | undefined): string | null {
  if (!aliasMap) return null;

  // TypeScript resolves the MOST specific (longest) matching pattern, not the
  // first declared. Sort prefixes longest-first so `@/ui/*` wins over `@/*`.
  const prefixes = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const target = aliasMap[prefix];
    if (specifier === prefix.replace(/\/$/, '')) {
      // Bare alias root (e.g. '@' → its target dir, resolved via index below).
      return target.replace(/\/$/, '');
    }
    if (specifier.startsWith(prefix)) {
      return path.join(target, specifier.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Resolve a base path to an existing file: first the path itself (covers
 * specifiers / alias targets that already include a `.ts`/`.tsx` extension),
 * then `<base>.<ext>`, then `<base>/index.<ext>`. Returns the absolute path or null.
 */
async function resolveToFile(basePath: string, fileIO: FileIO): Promise<string | null> {
  // Specifier already carries a source extension (e.g. `./Button.tsx`).
  if (SOURCE_EXTENSIONS.some((ext) => basePath.endsWith(ext)) && (await fileExists(basePath, fileIO))) {
    return basePath;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${basePath}${ext}`;
    if (await fileExists(candidate, fileIO)) return candidate;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = path.join(basePath, `index${ext}`);
    if (await fileExists(candidate, fileIO)) return candidate;
  }
  return null;
}

async function fileExists(absolutePath: string, fileIO: FileIO): Promise<boolean> {
  try {
    await fileIO.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/** Resolve an import specifier (already alias-applied) to an absolute base path. */
function specifierToBasePath(
  specifier: string,
  importerFilePath: string,
  aliasMap: Record<string, string> | undefined,
): string | null {
  const aliased = applyAlias(specifier, aliasMap);
  if (aliased !== null) return aliased;

  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(importerFilePath), specifier);
  }
  if (specifier.startsWith('/')) return specifier;

  // Bare specifier — external package, no local base path.
  return null;
}

interface ExportLocation {
  line: number;
  column: number;
}
type LocateExportResult =
  | ExportLocation
  | { reExportFrom: string }
  /** No direct/named-barrel match; these `export * from '...'` sources may carry it. */
  | { exportAllSources: string[] }
  | null;

/**
 * Find the 1-based line/column where `name` is defined (declaration) or
 * re-exported in `ast`. For named barrel re-exports returns the specifier to
 * follow; for `export *` barrels returns the candidate sources to search.
 *
 * `namedOnly` (set while following `export *` for a NAMED import) suppresses the
 * default-export and non-exported-declaration fallbacks: `export *` re-exports
 * only the module's NAMED exports, never its default. Without this, an unrelated
 * file whose sole export is `export default Foo` would falsely match any named
 * symbol and pinpoint the wrong component.
 */
function locateExport(ast: t.File, name: string, namedOnly = false): LocateExportResult {
  let fallback: ExportLocation | null = null;
  const exportAllSources: string[] = [];

  for (const node of ast.program.body) {
    // Barrel: `export { Name } from './X'` — follow one level.
    if (t.isExportNamedDeclaration(node) && node.source) {
      const matches = node.specifiers.some(
        (s) => t.isExportSpecifier(s) && t.isIdentifier(s.exported) && s.exported.name === name,
      );
      if (matches) return { reExportFrom: node.source.value };
    }

    // Wildcard barrel: `export * from './X'` — collect as a candidate to search
    // if no more specific match is found.
    if (t.isExportAllDeclaration(node) && node.source) {
      exportAllSources.push(node.source.value);
    }

    // `export function Name() {}` / `export class Name {}`
    // recast does not always populate `loc` on the inner declaration node, so
    // fall back to the `export` statement's own `loc` (same line in practice).
    if (t.isExportNamedDeclaration(node) && node.declaration) {
      const decl = node.declaration;
      const declLoc = decl.loc ?? node.loc;
      if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.id?.name === name && declLoc) {
        return { line: declLoc.start.line, column: declLoc.start.column };
      }
      if (t.isVariableDeclaration(decl)) {
        for (const d of decl.declarations) {
          const dLoc = d.loc ?? node.loc;
          if (t.isIdentifier(d.id) && d.id.name === name && dLoc) {
            return { line: dLoc.start.line, column: dLoc.start.column };
          }
        }
      }
    }

    // Fallbacks below are NOT valid `export *` re-exports — skip them in namedOnly mode.
    if (namedOnly) continue;

    // `export default function Name() {}` / `export default Name`
    if (t.isExportDefaultDeclaration(node)) {
      const decl = node.declaration;
      const declLoc = decl.loc ?? node.loc;
      if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && declLoc) {
        if (!fallback) fallback = { line: declLoc.start.line, column: declLoc.start.column };
      } else if (node.loc && !fallback) {
        fallback = { line: node.loc.start.line, column: node.loc.start.column };
      }
    }

    // Plain top-level declaration (later re-exported, or matched as a default-import target).
    if (t.isFunctionDeclaration(node) && node.id?.name === name && node.loc && !fallback) {
      fallback = { line: node.loc.start.line, column: node.loc.start.column };
    }
    if (t.isVariableDeclaration(node)) {
      for (const d of node.declarations) {
        if (t.isIdentifier(d.id) && d.id.name === name && d.loc && !fallback) {
          fallback = { line: d.loc.start.line, column: d.loc.start.column };
        }
      }
    }
  }

  if (fallback) return fallback;
  if (exportAllSources.length > 0) return { exportAllSources };
  return null;
}

/** Imported (module-side) name for a specifier — what the definition file exports. */
function importedName(
  specifier: t.ImportSpecifier | t.ImportDefaultSpecifier | t.ImportNamespaceSpecifier,
): { kind: 'named'; name: string } | { kind: 'default' } | { kind: 'namespace' } {
  if (t.isImportDefaultSpecifier(specifier)) return { kind: 'default' };
  if (t.isImportNamespaceSpecifier(specifier)) return { kind: 'namespace' };
  // Named: use the imported (module-side) name, not the local alias.
  const imported = specifier.imported;
  return { kind: 'named', name: t.isIdentifier(imported) ? imported.name : imported.value };
}

/**
 * Resolve a component reference to its master definition location.
 */
export async function resolveMasterComponent(opts: ResolveMasterComponentOptions): Promise<MasterComponentResolution> {
  const { importerFilePath, importerSource, componentName, fileIO, aliasMap } = opts;

  if (isHostTag(componentName)) return { kind: 'host' };

  let ast: t.File;
  try {
    ast = parseCode(importerSource);
  } catch {
    return { kind: 'not-found' };
  }

  const importInfo = findImportForName(ast, componentName);
  if (!importInfo) {
    // No import for this name — either defined inline in this file, or unknown.
    return { kind: 'inline' };
  }

  const specifier = importInfo.declaration.source.value;
  if (isBareSpecifier(specifier) && applyAlias(specifier, aliasMap) === null) {
    return { kind: 'external', packageName: packageNameFromSpecifier(specifier) };
  }

  const targetName = importedName(importInfo.specifier);
  const { resolution } = await resolveInModule(specifier, targetName, importerFilePath, fileIO, aliasMap, 0);
  return resolution;
}

const MAX_BARREL_DEPTH = 2;

/**
 * Internal resolution result. `pinpointed` is true when the named export's own
 * declaration was located (vs. a best-effort "navigate to the file" fallback).
 * Used so `export *` barrel-following can prefer a candidate that actually
 * defines the symbol over the barrel file itself.
 */
interface InternalResolution {
  resolution: MasterComponentResolution;
  pinpointed: boolean;
}

async function resolveInModule(
  specifier: string,
  targetName: { kind: 'named'; name: string } | { kind: 'default' } | { kind: 'namespace' },
  importerFilePath: string,
  fileIO: FileIO,
  aliasMap: Record<string, string> | undefined,
  depth: number,
  /** True when reached by following an `export *` — only NAMED exports may match. */
  viaExportStar = false,
): Promise<InternalResolution> {
  const basePath = specifierToBasePath(specifier, importerFilePath, aliasMap);
  if (basePath === null) {
    return { resolution: { kind: 'external', packageName: packageNameFromSpecifier(specifier) }, pinpointed: false };
  }

  const resolvedFile = await resolveToFile(basePath, fileIO);
  if (resolvedFile === null) return { resolution: { kind: 'not-found' }, pinpointed: false };

  // Namespace / default imports: jump to the file; pinpoint best-effort.
  if (targetName.kind === 'namespace' || targetName.kind === 'default') {
    const source = await readFileSafe(resolvedFile, fileIO);
    if (source === null) {
      return {
        resolution: { kind: 'local', filePath: resolvedFile, line: 1, column: 0, componentName: '', pinpointed: false },
        pinpointed: false,
      };
    }
    const located = locateExportSafe(source, targetName.kind === 'default' ? '__default__' : '');
    return {
      resolution: {
        kind: 'local',
        filePath: resolvedFile,
        line: located?.line ?? 1,
        column: located?.column ?? 0,
        componentName: '',
        pinpointed: located !== null,
      },
      pinpointed: located !== null,
    };
  }

  const source = await readFileSafe(resolvedFile, fileIO);
  if (source === null) return { resolution: { kind: 'not-found' }, pinpointed: false };

  let ast: t.File;
  try {
    ast = parseCode(source);
  } catch {
    return {
      resolution: {
        kind: 'local',
        filePath: resolvedFile,
        line: 1,
        column: 0,
        componentName: targetName.name,
        pinpointed: false,
      },
      pinpointed: false,
    };
  }

  const located = locateExport(ast, targetName.name, viaExportStar);

  if (located && 'reExportFrom' in located) {
    if (depth >= MAX_BARREL_DEPTH) return { resolution: { kind: 'not-found' }, pinpointed: false };
    return resolveInModule(located.reExportFrom, targetName, resolvedFile, fileIO, aliasMap, depth + 1, viaExportStar);
  }

  // Wildcard barrel: `export * from './X'`. Follow each candidate source; the
  // first that actually DEFINES the symbol as a NAMED export (pinpointed) wins.
  if (located && 'exportAllSources' in located) {
    if (depth < MAX_BARREL_DEPTH) {
      for (const src of located.exportAllSources) {
        const candidate = await resolveInModule(src, targetName, resolvedFile, fileIO, aliasMap, depth + 1, true);
        if (candidate.resolution.kind === 'local' && candidate.pinpointed) return candidate;
      }
    }
    // No `export *` source pinpointed the symbol — land on the barrel itself.
    return {
      resolution: {
        kind: 'local',
        filePath: resolvedFile,
        line: 1,
        column: 0,
        componentName: targetName.name,
        pinpointed: false,
      },
      pinpointed: false,
    };
  }

  if (located) {
    return {
      resolution: {
        kind: 'local',
        filePath: resolvedFile,
        line: located.line,
        column: located.column,
        componentName: targetName.name,
        pinpointed: true,
      },
      pinpointed: true,
    };
  }

  // File resolved but the named export was not found in it — still navigate there.
  return {
    resolution: {
      kind: 'local',
      filePath: resolvedFile,
      line: 1,
      column: 0,
      componentName: targetName.name,
      pinpointed: false,
    },
    pinpointed: false,
  };
}

async function readFileSafe(absolutePath: string, fileIO: FileIO): Promise<string | null> {
  try {
    return await fileIO.readFile(absolutePath);
  } catch {
    return null;
  }
}

/** Locate an export by name in raw source; `__default__` targets the default export. */
function locateExportSafe(source: string, name: string): { line: number; column: number } | null {
  let ast: t.File;
  try {
    ast = parseCode(source);
  } catch {
    return null;
  }
  if (name === '__default__') {
    for (const node of ast.program.body) {
      if (t.isExportDefaultDeclaration(node)) {
        const decl = node.declaration;
        if ((t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) && decl.loc) {
          return { line: decl.loc.start.line, column: decl.loc.start.column };
        }
        if (node.loc) return { line: node.loc.start.line, column: node.loc.start.column };
      }
    }
    return null;
  }
  const located = locateExport(ast, name);
  if (located && 'line' in located) return located;
  return null;
}
