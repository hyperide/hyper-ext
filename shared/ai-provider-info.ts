/**
 * Provider recommendation texts and labels (GLM, Fire Pass, Command Code).
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

export const FIREPASS_INFO = {
  tagline: 'Fire Pass via Fireworks AI',
  description:
    'Flat-rate monthly pass for Kimi K2.6 Turbo (no per-token charges). Other Fireworks models bill per-token through the same API.',
  plans: [{ name: 'Fire Pass', price: '$49/mo', note: 'Kimi K2.6 Turbo, 256k context' }],
  getKeyUrl: 'https://app.fireworks.ai/api-keys',
  subscribeUrl: 'https://docs.fireworks.ai/firepass',
} as const;

export const COMMANDCODE_INFO = {
  tagline: 'Command Code',
  description:
    'Credit-based subscription from $1/mo. One API for DeepSeek V4 Pro, Qwen 3.7 Max, Kimi K2.6, MiniMax M3, Nemotron, Claude, GPT-5 and more.',
  plans: [
    { name: 'Go', price: '$1/mo', note: '$10 credits' },
    { name: 'Pro', price: '$15/mo', note: '$30 credits, API access' },
    { name: 'Max', price: '$100/mo', note: '$150 credits' },
    { name: 'Ultra', price: '$200/mo', note: '$300 credits' },
  ],
  getKeyUrl: 'https://commandcode.ai/studio/',
  subscribeUrl: 'https://commandcode.ai/pricing',
} as const;

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  glm: 'GLM (Z.ai)',
  firepass: 'Fire Pass (Fireworks AI)',
  commandcode: 'Command Code (DeepSeek, Qwen, Kimi…)',
  claude: 'Claude (Anthropic)',
  openai: 'OpenAI or compatible',
  proxy: 'Proxy (Gemini, DeepSeek, Mistral, Groq)',
  opencode: 'OpenCode (Gemini, DeepSeek, Qwen)',
};

/** Where to get an API key for each main provider */
export const PROVIDER_KEY_URLS: Partial<Record<AIProvider, { url: string; label: string }>> = {
  glm: { url: GLM_RECOMMENDATION.getKeyUrl, label: 'Z.ai' },
  firepass: { url: FIREPASS_INFO.getKeyUrl, label: 'Fireworks AI' },
  commandcode: { url: COMMANDCODE_INFO.getKeyUrl, label: 'Command Code Studio' },
  claude: { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Platform' },
};
