/**
 * AI-powered Sample component generator for the VS Code extension.
 *
 * Returns a SampleGeneratorFn compatible with ensureSample() from lib/preview-generator.
 * Uses callAI() from lib/ai-client — unified AI client abstraction.
 * Prompt and code extraction are shared with the server via lib/preview-generator.
 *
 * Framework detection (HYP-795): the extension has full workspace filesystem access, so — per
 * master spec §5.6 (the ProjectDetector is shared-first across realms, NOT server-only) — this
 * path runs the SAME shared `detectFramework` + `buildFrameworkInstructions` the server runs
 * (`server/routes/parseComponent.ts`) and feeds the result into `buildSamplePrompt`. Previously
 * the extension passed NO framework instructions, so AI-generated samples for routed components
 * (Next.js / Remix / React Router params) lacked the router scaffolding the server already gave.
 */

import type { FileIO } from '@lib/ast/file-io';
import { callAI, resolveAIConfig } from '@lib/ai-client';
import {
  buildFrameworkInstructions,
  buildSamplePrompt,
  extractCodeFromAIResponse,
  type BuildSamplePromptOptions,
  type SampleGeneratorFn,
} from '@lib/preview-generator';
import { detectFramework } from '@lib/preview-generator/framework-routing';
import * as vscode from 'vscode';
import { VSCodeFileIO } from '../vscode-file-io';

/**
 * Build the sample-generation prompt the extension sends, with framework-specific instructions
 * detected from the project filesystem via the SHARED detector (mirrors the server's
 * detect → buildFrameworkInstructions → buildSamplePrompt flow). Exported for unit tests.
 *
 * Degrades gracefully: when `projectRoot` is undefined (no open workspace) or detection throws,
 * it falls back to the base prompt with no framework block — exactly the pre-HYP-795 behavior,
 * never a crash.
 */
export async function buildExtensionSamplePrompt(
  io: FileIO,
  projectRoot: string | undefined,
  sourceCode: string,
  sampleName: string,
  options?: BuildSamplePromptOptions,
): Promise<string> {
  let frameworkInstructions: string | undefined;
  if (projectRoot) {
    try {
      const detection = await detectFramework(projectRoot, io);
      frameworkInstructions = buildFrameworkInstructions(detection);
    } catch (error) {
      console.warn('[SampleAI] Framework detection failed, building prompt without it:', error);
    }
  }
  return buildSamplePrompt(sourceCode, sampleName, frameworkInstructions, options);
}

/** Options for {@link createExtensionSampleGenerator}; both default to a real workspace lookup. */
export interface ExtensionSampleGeneratorOptions {
  /** Resolve the project root used for framework detection. Defaults to the first workspace folder. */
  getProjectRoot?: () => string | undefined;
  /** FileIO used for framework detection. Defaults to VSCodeFileIO. Injectable for tests. */
  io?: FileIO;
  /** Extra prompt context, such as deterministic generated props already tried by the preview. */
  promptOptions?: BuildSamplePromptOptions;
}

/**
 * Create a SampleGeneratorFn that uses the extension's AI config.
 * Returns null from the callback when API key is not configured (silent skip).
 */
export function createExtensionSampleGenerator(
  context: vscode.ExtensionContext,
  options?: ExtensionSampleGeneratorOptions,
): SampleGeneratorFn {
  // _componentName is required by SampleGeneratorFn callback signature
  return async (sourceCode, _componentName, sampleName) => {
    const apiKey = await context.secrets.get('hypercanvas.ai.apiKey');
    if (!apiKey) {
      console.log('[SampleAI] No API key configured, skipping sample generation');
      return null;
    }

    const config = vscode.workspace.getConfiguration('hypercanvas.ai');
    const provider = config.get<string>('provider', 'glm');
    const model = config.get<string>('model');
    const baseURL = config.get<string>('baseURL');
    const backend = config.get<string>('backend');

    const resolved = resolveAIConfig({
      provider: provider as string,
      apiKey,
      model: model || '',
      baseURL: baseURL || undefined,
      backend: backend || undefined,
    });

    if (!resolved) {
      console.warn(`[SampleAI] Could not resolve provider "${provider}" config`);
      return null;
    }

    const projectRoot = options?.getProjectRoot?.() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const io = options?.io ?? new VSCodeFileIO();
    const prompt = await buildExtensionSamplePrompt(io, projectRoot, sourceCode, sampleName, options?.promptOptions);

    try {
      const text = await callAI(resolved, prompt);
      return extractCodeFromAIResponse(text);
    } catch (error) {
      console.error('[SampleAI] Generation failed:', error);
      return null;
    }
  };
}
