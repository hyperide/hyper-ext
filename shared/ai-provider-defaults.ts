/**
 * Default base URLs and models per AI provider.
 *
 * Single source of truth — used by SaaS client, VS Code extension, and lib/.
 */

/**
 * Provider capability matrix:
 *
 * | Provider | callAI (text) | Server Agent (tools)         | Extension chat |
 * |----------|---------------|------------------------------|----------------|
 * | claude      | Yes           | Yes (Anthropic SDK)          | Yes (tools)    |
 * | glm         | Yes           | Yes (OpenAI function calling) | Yes (tools)    |
 * | firepass    | Yes           | Yes (OpenAI function calling) | Yes (tools)    |
 * | commandcode | Yes           | Yes (routed by model)        | Yes (tools)    |
 * | openai      | Yes           | Yes (OpenAI function calling) | Yes (tools)    |
 * | proxy       | Yes           | Yes (litellm + Anthropic)    | Text-only      |
 * | opencode    | Yes (via SDK) | Yes (MCP bridge + SSE)       | Text-only      |
 *
 * Protocol policy: the Anthropic SDK / Messages API is reserved for the REAL
 * Anthropic API (provider 'claude'). Every other gateway speaks OpenAI Chat
 * Completions with function calling — server via chatWithOpenAITools, extension
 * via FetchOpenAIProvider. The one exception: commandcode routes claude-* models
 * to its Anthropic-compatible /messages (their gateway returns 400 for a claude
 * model on /chat/completions and vice versa).
 * Tool definitions ({name, description, input_schema: JSON Schema}) are
 * SDK-neutral; each provider adapter does its own wire-format translation.
 */
export type AIProvider = 'claude' | 'openai' | 'glm' | 'firepass' | 'commandcode' | 'proxy' | 'opencode';

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
    // Coding-plan OpenAI endpoint — note the /v4 base, there is NO /v1 suffix.
    baseURL: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-4.7',
    protocol: 'openai',
  },
  firepass: {
    baseURL: 'https://api.fireworks.ai/inference/v1',
    model: 'accounts/fireworks/routers/kimi-k2p6-turbo',
    protocol: 'openai',
  },
  commandcode: {
    baseURL: 'https://api.commandcode.ai/provider',
    // Actual wire protocol is chosen per model by resolveAIConfig (claude-* →
    // anthropic, everything else → openai); this field is the catalog default.
    model: 'deepseek/deepseek-v4-pro',
    protocol: 'openai',
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
