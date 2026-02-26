/**
 * Default base URLs and models per AI provider.
 *
 * Single source of truth — used by SaaS client, VS Code extension, and lib/.
 */

export type AIProvider = 'claude' | 'openai' | 'glm' | 'proxy' | 'opencode';

export interface AIProviderDefaults {
  baseURL: string | null;
  model: string;
  /** 'anthropic' = Anthropic Messages API, 'openai' = OpenAI Chat Completions */
  protocol: 'anthropic' | 'openai';
}

export const AI_PROVIDER_DEFAULTS: Record<AIProvider, AIProviderDefaults> = {
  claude: {
    baseURL: null, // uses FetchAnthropicProvider default (https://api.anthropic.com)
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
  },
  glm: {
    baseURL: 'https://api.z.ai/api/anthropic',
    model: 'glm-4.7',
    protocol: 'anthropic',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    protocol: 'openai',
  },
  proxy: {
    baseURL: null, // resolved at runtime (Docker container)
    model: 'gemini/gemini-2.5-pro',
    protocol: 'anthropic',
  },
  opencode: {
    baseURL: null, // resolved at runtime (local process)
    model: 'google/gemini-2.5-pro',
    protocol: 'openai',
  },
};
