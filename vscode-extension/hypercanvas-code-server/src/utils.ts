/**
 * Pure utility functions extracted from extension.ts and PreviewViewProvider.ts.
 * Testable without vscode dependency.
 */

export interface SSECommand {
  type: string;
  filePath?: string;
  line?: number;
  column?: number;
}

/** Parse a single SSE line like "data: {...}" into a command object */
export function parseSSELine(line: string): SSECommand | null {
  if (!line.startsWith('data: ')) return null;

  const jsonStr = line.slice(6).trim();
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr) as SSECommand;
  } catch {
    return null;
  }
}

/** Extract relative component path from /app/... filesystem path */
export function extractComponentPath(filePath: string): string | undefined {
  if (!/\.(tsx|jsx)$/.test(filePath)) return undefined;

  const match = filePath.match(/\/app\/(.+\.(tsx|jsx))$/);
  return match ? match[1] : undefined;
}

/** Build the preview URL for a project, optionally scoped to a component */
export function buildPreviewUrl(origin: string, projectId: string, component?: string): string {
  const base = `${origin}/project-preview/${projectId}/test-preview`;
  return component ? `${base}?component=${encodeURIComponent(component)}` : base;
}

/** Convert VS Code 0-based position to API 1-based position */
export function toApiPosition(line: number, character: number): { line: number; column: number } {
  return { line: line + 1, column: character + 1 };
}

/** Convert 1-based line and column to VS Code 0-based position */
export function toVSCodePosition(line: number, column: number): { line: number; column: number } {
  return { line: line - 1, column: Math.max(0, column - 1) };
}

/** Strip /app/ prefix from an absolute path */
export function stripAppPrefix(filePath: string): string {
  return filePath.replace(/^\/app\//, '');
}
