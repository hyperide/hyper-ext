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

    case 'glm': {
      // Anthropic SDK is reserved for the real Anthropic API — GLM speaks OpenAI
      // chat completions on the coding-plan endpoint. Users may still have the
      // legacy Anthropic-protocol default persisted in settings; migrate it
      // (trailing slashes included — settings round-trips add them).
      const trimmed = baseURL ? baseURL.replace(/\/+$/, '') : '';
      const isLegacyOrEmpty = !trimmed || trimmed === 'https://api.z.ai/api/anthropic';
      return {
        apiKey,
        model,
        baseURL: isLegacyOrEmpty ? AI_PROVIDER_DEFAULTS.glm.baseURL || undefined : trimmed,
        provider: 'openai',
      };
    }

    case 'firepass': {
      // Same migration: the old default was the Anthropic-compatible base.
      const trimmed = baseURL ? baseURL.replace(/\/+$/, '') : '';
      const isLegacyOrEmpty = !trimmed || trimmed === 'https://api.fireworks.ai/inference';
      return {
        apiKey,
        model,
        baseURL: isLegacyOrEmpty ? AI_PROVIDER_DEFAULTS.firepass.baseURL || undefined : trimmed,
        provider: 'openai',
      };
    }

    case 'commandcode': {
      // Command Code routes by model family: /messages serves Anthropic models
      // ONLY, everything else (deepseek, qwen, kimi, …) must use OpenAI
      // /chat/completions — sending the wrong family returns a 400.
      const ccDefault = AI_PROVIDER_DEFAULTS.commandcode.baseURL;
      // The settings UI persists the provider default into the stored baseURL,
      // so a saved default (either family's shape) is normalized per model —
      // only a genuinely custom URL is passed through untouched.
      const isDefaultBase = !baseURL || baseURL === ccDefault || baseURL === `${ccDefault}/v1`;
      if (model.startsWith('claude')) {
        return {
          apiKey,
          model,
          baseURL: isDefaultBase ? ccDefault || undefined : baseURL,
          provider: 'anthropic',
        };
      }
      // OpenAI-compatible callers append /chat/completions themselves, so the
      // default base gains the /v1 segment.
      return {
        apiKey,
        model,
        baseURL: isDefaultBase ? `${ccDefault}/v1` : baseURL,
        provider: 'openai',
      };
    }

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

      // OpenCode stores model as "provider/model" (e.g. "google/gemini-2.5-pro").
      // Strip the provider prefix for direct API calls.
      const resolvedModel = provider === 'opencode' && model.includes('/') ? model.split('/', 2)[1] : model;

      // anthropic backend still uses Anthropic SDK
      if (b === 'anthropic') {
        return { apiKey, model: resolvedModel, baseURL: baseURL || undefined, provider: 'anthropic' };
      }

      const resolvedBaseURL = baseURL || OPENAI_COMPATIBLE_BASE_URLS[b];
      if (!resolvedBaseURL) return null;

      return { apiKey, model: resolvedModel, baseURL: resolvedBaseURL, provider: 'openai' };
    }

    default:
      console.warn(`[resolveAIConfig] Unknown provider: "${provider}"`);
      return null;
  }
}
