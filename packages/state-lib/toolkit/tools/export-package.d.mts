/**
 * Checked typing contract for the sibling `export-package.mjs` exporter.
 *
 * Package-contract tests check the exact runtime export set and constant
 * shapes; root TypeScript checking validates consuming code. It exists because the root typecheck
 * program includes toolkit tests, which import the untyped `.mjs` exporter
 * directly; without it that import is an implicit `any`. The exporter
 * itself is a local build tool, never part of the published package.
 */
export declare const SOURCE_RUNTIME_SPECIFIER: string;
export declare const PUBLIC_CORE_SPECIFIER: string;
export declare const KNOWN_BUILT_FILES: string[];

export interface ExportPackageOptions {
  /** Requested output must be absent, with an existing parent outside both source trees (symlinks resolved). */
  dest?: string;
  toolkitRoot?: string;
  repoRoot?: string;
  srcDir?: string;
  tscBin?: string;
  nodeBin?: string;
}

export interface ToolkitExportManifest {
  package: string;
  version: string;
  corePeer: { name: string; version: string };
  /** Destination populated by a successful export. */
  dest: string;
  builtFiles: string[];
}

export declare function exportPackage(options?: ExportPackageOptions): ToolkitExportManifest;
