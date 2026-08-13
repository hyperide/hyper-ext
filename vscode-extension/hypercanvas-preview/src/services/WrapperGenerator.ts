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
 * Module-internal — callers use {@link ensureIsolationWrapper}.
 */
async function generatePreviewWrapper(workspaceRoot: string, context: vscode.ExtensionContext): Promise<string | null> {
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

/** Write generated content to .hyperide/preview.tsx, creating the directory if needed. Module-internal. */
async function writePreviewWrapper(workspaceRoot: string, content: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hyperide');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'preview.tsx'), content, 'utf8');
}

/**
 * Generate + write `.hyperide/preview.tsx` if it doesn't already exist,
 * flipping the preview into isolated mode (the FSWatch in PreviewModeManager
 * picks the file up → onWrapperCreated → setIsolatedMode(true)).
 *
 * Shared by the manual scope toggle (`setScopeChangeHandler`) and the
 * automatic provider-context-error recovery path (HYP-487), so the no-AI-key
 * fallback message and the "don't clobber a manual wrapper" guard live in one
 * place.
 *
 * Returns the outcome so callers can decide whether to surface their own
 * messaging:
 * - 'exists'   — a wrapper was already present, nothing written.
 * - 'written'  — a wrapper was generated and written.
 * - 'no-key'   — generation skipped (no AI key configured); a guidance
 *                message was already shown to the user.
 */
export async function ensureIsolationWrapper(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
): Promise<'exists' | 'written' | 'no-key'> {
  const wrapperPath = path.join(workspaceRoot, '.hyperide', 'preview.tsx');
  const exists = await fs
    .access(wrapperPath)
    .then(() => true)
    .catch(() => false);
  if (exists) return 'exists';

  const content = await generatePreviewWrapper(workspaceRoot, context);
  if (content) {
    await writePreviewWrapper(workspaceRoot, content);
    return 'written';
  }

  void vscode.window.showInformationMessage(
    'HyperIDE: this component reads a React context whose provider lives in your app shell. ' +
      'Configure an AI key to auto-generate .hyperide/preview.tsx, or create ' +
      '.hyperide/preview.tsx manually with the needed providers.',
  );
  return 'no-key';
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
