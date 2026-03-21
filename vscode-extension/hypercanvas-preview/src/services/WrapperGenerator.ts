/**
 * @file AI-powered generator for .hyperide/preview.tsx (PreviewWrapper).
 *
 * Accessed via: PreviewPanel "Generate wrapper" notification button,
 *               or scope toggle when switching to Isolated mode.
 * Assumptions: API key must be configured in extension settings.
 *              Returns null (silent skip) when no key is available.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { callAI, resolveAIConfig } from '@lib/ai-client';
import * as vscode from 'vscode';

/**
 * Generate .hyperide/preview.tsx content using the project's entry files as context.
 * Returns null when API key is not configured or generation fails.
 */
export async function generatePreviewWrapper(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const apiKey =
    (await context.secrets.get('hypercanvas.ai.apiKey')) ||
    vscode.workspace.getConfiguration('hypercanvas.ai').get<string>('apiKey');
  if (!apiKey) return null;

  const config = vscode.workspace.getConfiguration('hypercanvas.ai');
  const resolved = resolveAIConfig({
    provider: config.get<string>('provider', 'glm'),
    apiKey,
    model: config.get<string>('model') || '',
    baseURL: config.get<string>('baseURL') || undefined,
    backend: config.get<string>('backend') || undefined,
  });
  if (!resolved) return null;

  const contextFiles = await _readProjectContext(workspaceRoot);
  const prompt = _buildPrompt(workspaceRoot, contextFiles);

  try {
    const text = await callAI(resolved, prompt);
    return _extractCode(text);
  } catch (error) {
    console.error('[WrapperGenerator] AI call failed:', error);
    return null;
  }
}

/** Write generated content to .hyperide/preview.tsx, creating the directory if needed. */
export async function writePreviewWrapper(workspaceRoot: string, content: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hyperide');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'preview.tsx'), content, 'utf8');
}

// ============================================================================
// Internals
// ============================================================================

interface ContextFile {
  name: string;
  content: string;
}

const CONTEXT_CANDIDATES = ['src/main.tsx', 'src/main.ts', 'main.tsx', 'src/App.tsx', 'src/app.tsx', 'App.tsx'];

async function _readProjectContext(workspaceRoot: string): Promise<ContextFile[]> {
  const result: ContextFile[] = [];
  for (const rel of CONTEXT_CANDIDATES) {
    try {
      const raw = await fs.readFile(path.join(workspaceRoot, rel), 'utf8');
      result.push({ name: rel, content: raw.slice(0, 3000) });
    } catch {
      /* file doesn't exist */
    }
  }
  return result;
}

function _buildPrompt(workspaceRoot: string, contextFiles: ContextFile[]): string {
  const fileSection = contextFiles.map((f) => `// ${f.name}\n${f.content}`).join('\n\n---\n\n');

  const pkgSection = ''; // package.json already covered by entry files' imports

  return `Generate a PreviewWrapper React component for the project at "${path.basename(workspaceRoot)}".

Requirements:
1. Export: \`export function PreviewWrapper({ children }: { children: ReactNode }) { ... }\`
2. Import all necessary context providers (ThemeProvider, RouterProvider, TamaguiProvider, etc.) found in the entry files below
3. Import global CSS files that are imported in the entry files
4. First line must be: // @hyperide-managed
5. Keep it minimal — only providers that the component tree actually needs
6. Use React Router v6 MemoryRouter (not BrowserRouter) to avoid navigation side-effects in preview
${pkgSection}
Entry files for context:
${fileSection || '(no entry files found — generate a minimal wrapper)'}

Output ONLY the TypeScript/TSX code. No markdown fences. No explanations.`;
}

function _extractCode(text: string): string {
  // Strip markdown code fences if the model wrapped the response
  const match = text.match(/```(?:tsx?|typescript|jsx?)?\n([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}
