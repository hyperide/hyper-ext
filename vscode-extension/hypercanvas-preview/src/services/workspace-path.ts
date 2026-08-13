/**
 * @file Workspace path resolution helper for VS Code extension services
 *
 * Accessed via: VS Code extension AST and style-read services resolving project files
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

export function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  if (filePath.startsWith('/')) {
    return filePath;
  }
  return `${workspaceRoot}/${filePath}`;
}
