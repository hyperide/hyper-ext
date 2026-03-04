/**
 * AI config resolution — normalizes provider settings into a unified shape.
 *
 * Works with both SaaS (DB config) and VS Code extension (workspace settings).
 * For proxy/opencode providers, the caller must resolve baseURL before calling
 * (e.g. via ProxyManager.ensureRunning() on server).
 */

import { AI_PROVIDER_DEFAULTS } from '../../shared/ai-provider-defaults.js';

export interface ResolvedAIConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Which API protocol to use */
  provider: 'anthropic' | 'openai';
}

/** OpenAI Chat Completions-compatible base URLs by backend name */
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  openai: 'https://api.openai.com/v1',
};

/**
 * Resolve raw provider config into a normalized form for callAI.
 *
 * For proxy/opencode with `backend` field, routes to the correct protocol.
 * Returns null if the provider is unrecognized or config is insufficient.
 */
export function resolveAIConfig(opts: {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string | null;
  backend?: string | null;
}): ResolvedAIConfig | null {
  const { provider, apiKey, model, baseURL, backend } = opts;

  switch (provider) {
    case 'claude':
      return { apiKey, model, baseURL: baseURL || undefined, provider: 'anthropic' };

    case 'glm':
      return {
        apiKey,
        model,
        baseURL: baseURL || AI_PROVIDER_DEFAULTS.glm.baseURL || undefined,
        provider: 'anthropic',
      };

    case 'openai':
      return {
        apiKey,
        model,
        baseURL: baseURL || 'https://api.openai.com/v1',
        provider: 'openai',
      };

    case 'proxy':
    case 'opencode': {
      const b = backend;
      if (!b) return null;

      // anthropic backend still uses Anthropic SDK
      if (b === 'anthropic') {
        return { apiKey, model, baseURL: baseURL || undefined, provider: 'anthropic' };
      }

      const resolvedBaseURL = baseURL || OPENAI_COMPATIBLE_BASE_URLS[b];
      if (!resolvedBaseURL) return null;

      return { apiKey, model, baseURL: resolvedBaseURL, provider: 'openai' };
    }

    default:
      console.warn(`[resolveAIConfig] Unknown provider: "${provider}"`);
      return null;
  }
}
