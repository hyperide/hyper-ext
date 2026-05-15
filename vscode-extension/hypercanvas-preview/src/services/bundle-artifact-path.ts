/**
 * @file Detects generated bundle paths that should not be treated as source
 *
 * Accessed via: Preview iframe source tracing and inspector style reads
 * Assumptions: bundler artifacts can appear in React source traces when source
 *   maps are missing or stale, but they are not editable user source files.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

const BUNDLE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)_bun\/client\//,
  /(?:^|\/)_next\/static\/chunks\//,
  /(?:^|\/)node_modules\//,
];

export function isBundleArtifactPath(filePath: string): boolean {
  return BUNDLE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}
