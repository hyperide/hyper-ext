const BUNDLE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)_bun\/client\//,
  /(?:^|\/)_next\/static\/chunks\//,
  /(?:^|\/)node_modules\//,
];

export function isBundleArtifactPath(filePath: string): boolean {
  return BUNDLE_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}
