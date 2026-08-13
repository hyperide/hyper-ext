/**
 * @file AI-powered generator for .hyperide/preview.tsx (PreviewWrapper).
 *
 * Accessed via: PreviewPanel "Generate wrapper" notification button,
 *               or scope toggle when switching to Isolated mode.
 * Assumptions: an AI key gives the best wrapper (one with the real providers).
 * Invariant (e2e #11): ensureIsolationWrapper ALWAYS leaves a valid
 *              `.hyperide/preview.tsx` on disk — a real AI wrapper when one can
 *              be generated and parses; otherwise a static provider-scaffold
 *              template (HYP-880, pass-through at runtime with the detected
 *              provider stack commented out); otherwise a minimal pass-through
 *              fallback — so isolated mode never wedges on an empty preview.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { callAI, resolveAIConfig } from '@lib/ai-client';
import { parseCode } from '@lib/ast/parser';
import * as t from '@babel/types';
import * as vscode from 'vscode';
import { buildPreviewWrapperScaffold, SCAFFOLD_MARKER } from './preview-wrapper-scaffold';

/**
 * Human-readable annotation embedded in the pass-through FALLBACK wrapper so a
 * developer (or grep) can tell an auto-generated fallback from a real one. NOT
 * the replaceability signal — {@link ensureIsolationWrapper} compares the file
 * byte-for-byte against {@link FALLBACK_WRAPPER} so a fallback the user has
 * edited (marker intact) is preserved rather than clobbered.
 */
const FALLBACK_MARKER = '@hyperide-fallback';

/**
 * Minimal pass-through wrapper written when AI generation is unavailable or
 * produces unusable output. It renders the component (or the component's own
 * clean error boundary) instead of leaving the preview empty — the silent
 * `rootChildren:0` wedge from e2e #11. Providers may be missing, but a visible
 * render (or a real error) beats a 320s blank-preview timeout. Carries
 * {@link FALLBACK_MARKER} so a later run can replace it with a real wrapper.
 *
 * Deliberately JSX-FREE: it returns `children` directly rather than wrapping in
 * a `<>…</>` fragment. Under the classic JSX runtime a fragment compiles to
 * `React.Fragment`, which would need a runtime `React` import; returning
 * `children` works under both the classic and automatic runtimes with only a
 * type-level `ReactNode` import.
 */
const FALLBACK_WRAPPER = `// @hyperide-managed ${FALLBACK_MARKER}
import type { ReactNode } from 'react';

export function PreviewWrapper({ children }: { children: ReactNode }) {
  return children;
}
`;

/**
 * Validate an AI-generated wrapper before it's written to disk. Two ways an
 * AI wrapper breaks the preview bundle, both rejected here so callers fall back
 * to {@link FALLBACK_WRAPPER}:
 *   1. It doesn't parse → crashes the bundle (the very wedge this fix removes).
 *   2. It parses but has no NAMED `PreviewWrapper` export → the preview imports
 *      `{ PreviewWrapper }`, so a default export or a missing export resolves to
 *      undefined and the iframe renders nothing.
 * Mirrors the intent of `validateGeneratedSample` in lib/preview-generator.
 */
function isValidWrapper(code: string): boolean {
  if (!code.trim()) return false;
  let ast: ReturnType<typeof parseCode>;
  try {
    ast = parseCode(code);
  } catch (error) {
    // Recoverable: returning false makes the caller write the pass-through fallback
    // wrapper instead. An AI wrapper that doesn't parse is an expected outcome the
    // generator is designed to handle — warn, not error (error-level would imply the
    // extension broke, and trips the e2e diagnostic-error guard over a handled fallback).
    console.warn('[WrapperGenerator] Generated wrapper failed parse-check — using fallback:', error);
    return false;
  }
  // Require a named `PreviewWrapper` export. The bundle does
  // `import { PreviewWrapper }`, so `export default` / no export would break it.
  // Check the AST (not a regex) so a commented-out `// export ... PreviewWrapper`
  // can't false-positive.
  if (!hasNamedPreviewWrapperExport(ast)) {
    // Recoverable: caller writes the pass-through fallback instead. Warn, not error.
    console.warn('[WrapperGenerator] Generated wrapper has no named PreviewWrapper export — using fallback');
    return false;
  }
  return true;
}

/**
 * True when the parsed module has a NAMED, RUNTIME `PreviewWrapper` export —
 * either an inline declaration (`export function/const PreviewWrapper …`) or a
 * re-export specifier (`export { PreviewWrapper }`). Walks top-level statements
 * only (exports can't be nested), so comments and strings can't false-positive.
 *
 * Rejects exports TypeScript erases at runtime — the preview's
 * `import { PreviewWrapper }` would still resolve to undefined:
 *   - `export type { PreviewWrapper }` (type-only export declaration)
 *   - `export { type PreviewWrapper }` (type-only specifier)
 *   - `export declare const PreviewWrapper` (ambient)
 *   - `export const PreviewWrapper;` with no initializer
 */
function hasNamedPreviewWrapperExport(ast: ReturnType<typeof parseCode>): boolean {
  for (const node of ast.program.body) {
    if (!t.isExportNamedDeclaration(node)) continue;
    if (node.exportKind === 'type') continue; // `export type { … }`
    if (hasRuntimePreviewWrapperSpecifier(node)) return true;
    if (declaresRuntimePreviewWrapper(node.declaration)) return true;
  }
  return false;
}

/** `export { PreviewWrapper }` — but not `export { type PreviewWrapper }`. */
function hasRuntimePreviewWrapperSpecifier(node: t.ExportNamedDeclaration): boolean {
  for (const spec of node.specifiers) {
    if (!t.isExportSpecifier(spec)) continue;
    if (spec.exportKind === 'type') continue; // `export { type PreviewWrapper }`
    if (t.isIdentifier(spec.exported) && spec.exported.name === 'PreviewWrapper') return true;
  }
  return false;
}

/** `export function/const PreviewWrapper …` — not `declare`, not an uninitialised var. */
function declaresRuntimePreviewWrapper(decl: t.Declaration | null | undefined): boolean {
  if (t.isFunctionDeclaration(decl) && decl.id?.name === 'PreviewWrapper') return true;
  if (t.isVariableDeclaration(decl) && !decl.declare) {
    for (const d of decl.declarations) {
      if (t.isIdentifier(d.id) && d.id.name === 'PreviewWrapper' && d.init != null) return true;
    }
  }
  return false;
}

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
    // Recoverable: returning null makes the caller write the pass-through fallback.
    // A failed AI call is a handled outcome, not an extension fault — warn, not error.
    console.warn('[WrapperGenerator] AI call failed — using fallback:', error);
    return null;
  }
}

/** Write generated content to .hyperide/preview.tsx, creating the directory if needed. Module-internal. */
async function writePreviewWrapper(workspaceRoot: string, content: string): Promise<void> {
  const dir = path.join(workspaceRoot, '.hyperide');
  await fs.mkdir(dir, { recursive: true });
  // codeql[js/http-to-file-access] -- writing the AI-generated preview wrapper into the user's own workspace (.hyperide/preview.tsx) IS the feature; the path is fixed, not attacker-chosen
  await fs.writeFile(path.join(dir, 'preview.tsx'), content, 'utf8');
}

/**
 * Read an existing wrapper, returning its contents, or `null` ONLY when the file
 * genuinely doesn't exist (ENOENT). Any other read failure (EACCES, an I/O
 * error) is rethrown — treating it as "no wrapper" would let the caller clobber
 * a present-but-unreadable manual wrapper with a generated one.
 */
async function readExistingWrapper(wrapperPath: string): Promise<string | null> {
  try {
    return await fs.readFile(wrapperPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
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
 * - 'exists'   — a real (AI or manual) wrapper was already present, nothing
 *                written. A prior pass-through fallback / unedited static
 *                scaffold does NOT count as 'exists' — both are replaceable so
 *                recovery can upgrade them.
 * - 'written'  — a valid AI-generated wrapper was written AUTOMATICALLY
 *                (possibly UPGRADING a previous fallback/scaffold once an AI
 *                key became available). This is the tg#5900 auto-fix path: AI
 *                configured + provider error → fixed with no manual click.
 * - 'scaffold' — AI was unavailable, but static analysis of the entry files
 *                found the app's provider chain: an HONEST template was written
 *                (providers + imports commented out with TODO stubs; HYP-880),
 *                active code is a pass-through so the preview still renders
 *                and the manual fix is uncomment-and-fill, not archeology.
 * - 'fallback' — neither AI nor static analysis produced anything: the minimal
 *                pass-through wrapper was written instead, with a guidance
 *                message — the preview renders the component (or its own clean
 *                error) rather than staying empty (e2e #11).
 */
export async function ensureIsolationWrapper(
  workspaceRoot: string,
  context: vscode.ExtensionContext,
): Promise<'exists' | 'written' | 'scaffold' | 'fallback'> {
  const wrapperPath = path.join(workspaceRoot, '.hyperide', 'preview.tsx');
  // A real wrapper (AI-generated earlier, or hand-authored) must NOT be
  // clobbered. Replaceable content is ONLY (a) the byte-exact canonical
  // pass-through fallback or (b) a byte-exact UNEDITED static scaffold (the
  // generator is deterministic for unchanged entry files, so regenerating and
  // comparing detects "still ours"). Exact-match (not a marker substring) so a
  // fallback/scaffold the USER has since edited is preserved, not overwritten,
  // even though it still carries its @hyperide-* annotation. A scaffold whose
  // entry files have since changed also stops matching and is preserved — the
  // conservative direction.
  const existing = await readExistingWrapper(wrapperPath);
  // Fast path: a real wrapper (AI-written or hand-authored) never carries the scaffold
  // marker — skip the expensive entry-file parse + BFS test-helper scan entirely on the hot
  // "already isolated" path (this runs on every provider-error signal; HYP-880 review
  // finding). Only build the scaffold when it could actually be needed for the byte-exact
  // "still ours" comparison below.
  if (existing !== null && existing !== FALLBACK_WRAPPER && !existing.includes(SCAFFOLD_MARKER)) {
    return 'exists';
  }
  const scaffold = await buildScaffoldSafely(workspaceRoot);
  const replaceable = existing === null || existing === FALLBACK_WRAPPER || existing === scaffold;
  if (!replaceable) return 'exists';

  const content = await generatePreviewWrapper(workspaceRoot, context);
  if (content && isValidWrapper(content)) {
    await writePreviewWrapper(workspaceRoot, content);
    void vscode.window.showInformationMessage(
      'HyperIDE: auto-generated .hyperide/preview.tsx with your app’s providers so the preview renders inside them.',
    );
    return 'written';
  }

  // No usable AI wrapper (no key, generation failed, or invalid output): write
  // the static scaffold when provider analysis found a chain, else the minimal
  // pass-through fallback. Either way `.hyperide/preview.tsx` EXISTS and is
  // valid — without that the app renders without providers,
  // ComponentErrorBoundary returns null, and the preview wedges empty for 320s.
  // Idempotent: if the same content is already on disk (a prior retry), don't
  // rewrite it — that would needlessly re-fire the FSWatch and re-prompt.
  if (scaffold && isValidWrapper(scaffold)) {
    if (existing !== scaffold) {
      await writePreviewWrapper(workspaceRoot, scaffold);
      void vscode.window.showInformationMessage(
        'HyperIDE: this component needs providers from your app shell. A wrapper template with the ' +
          'detected providers was created at .hyperide/preview.tsx — fill its TODO stubs, or configure ' + // HYP-880: literal user-facing text, not a dev leftover
          'an AI key to generate one automatically.',
      );
    }
    return 'scaffold';
  }
  if (existing !== FALLBACK_WRAPPER) {
    await writePreviewWrapper(workspaceRoot, FALLBACK_WRAPPER);
    void vscode.window.showInformationMessage(
      'HyperIDE: this component reads a React context whose provider lives in your app shell. ' +
        'A minimal preview wrapper was created at .hyperide/preview.tsx — configure an AI key to ' +
        'auto-generate one with the needed providers, or edit it manually.',
    );
  }
  return 'fallback';
}

/**
 * Static scaffold content for the workspace, or null when analysis finds no
 * providers or throws (analysis is best-effort; a parse crash must never take
 * down the wrapper-recovery path that guards the e2e #11 invariant).
 */
async function buildScaffoldSafely(workspaceRoot: string): Promise<string | null> {
  try {
    const scaffold = await buildPreviewWrapperScaffold(workspaceRoot);
    return scaffold?.content ?? null;
  } catch (error) {
    console.warn('[WrapperGenerator] static scaffold analysis failed — falling back:', error);
    return null;
  }
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
