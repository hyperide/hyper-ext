/**
 * Returns true when the path points to a compiled/bundled artifact that should
 * not be opened in the editor (Bun _bun/, Next.js _next/, node_modules/).
 */
export function isBundleArtifactPath(filePath: string): boolean {
  return /(^|\/)_bun\//.test(filePath) || /(^|\/)_next\//.test(filePath) || /(^|\/)node_modules\//.test(filePath);
}
