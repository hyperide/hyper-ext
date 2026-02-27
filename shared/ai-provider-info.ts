/**
 * GLM recommendation texts and provider labels.
 *
 * Shared between SaaS client and VS Code extension so that
 * marketing copy, URLs, and pricing stay in sync.
 */

import type { AIProvider } from './ai-provider-defaults';

export const GLM_RECOMMENDATION = {
  tagline: 'Recommended: GLM via Z.ai',
  description: 'Flat-rate subscription (not per-token). Up to 3\u00d7 Claude plan usage from $10/mo.',
  plans: [
    { name: 'Lite', price: '$10/mo', note: '3\u00d7 Claude Pro usage' },
    { name: 'Pro', price: '$30/mo', note: '15\u00d7 Claude Pro usage' },
    { name: 'Max', price: '$80/mo', note: '60\u00d7 Claude Pro usage' },
  ],
  getKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
  subscribeUrl: 'https://z.ai/subscribe',
} as const;

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  glm: 'GLM (Z.ai)',
  claude: 'Claude (Anthropic)',
  openai: 'OpenAI or compatible',
  proxy: 'Proxy (Gemini, DeepSeek, Mistral, Groq)',
  opencode: 'OpenCode (Gemini, DeepSeek, Qwen)',
};

/** Where to get an API key for each main provider */
export const PROVIDER_KEY_URLS: Partial<Record<AIProvider, { url: string; label: string }>> = {
  glm: { url: GLM_RECOMMENDATION.getKeyUrl, label: 'Z.ai' },
  claude: { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' },
};
