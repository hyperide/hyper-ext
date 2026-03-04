/**
 * AI-powered Sample component generator for the VS Code extension.
 *
 * Returns a SampleGeneratorFn compatible with ensureSample() from lib/preview-generator.
 * Uses callAI() from lib/ai-client — unified AI client abstraction.
 * Prompt and code extraction are shared with the server via lib/preview-generator.
 */

import { callAI, resolveAIConfig } from '@lib/ai-client';
import { buildSamplePrompt, extractCodeFromAIResponse, type SampleGeneratorFn } from '@lib/preview-generator';
import * as vscode from 'vscode';

/**
 * Create a SampleGeneratorFn that uses the extension's AI config.
 * Returns null from the callback when API key is not configured (silent skip).
 */
export function createExtensionSampleGenerator(context: vscode.ExtensionContext): SampleGeneratorFn {
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

    const prompt = buildSamplePrompt(sourceCode, sampleName);

    try {
      const text = await callAI(resolved, prompt);
      return extractCodeFromAIResponse(text);
    } catch (error) {
      console.error('[SampleAI] Generation failed:', error);
      return null;
    }
  };
}

// buildSamplePrompt and extractCodeFromAIResponse are shared with the server
// via lib/preview-generator/sample-prompt.ts — no duplication.
