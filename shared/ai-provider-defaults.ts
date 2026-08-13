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
 * | claude   | Yes           | Yes (Anthropic SDK)          | Yes (tools)    |
 * | glm      | Yes           | Yes (Anthropic SDK)          | Yes (tools)    |
 * | firepass | Yes           | Yes (Anthropic SDK)          | Yes (tools)    |
 * | openai   | Yes           | Yes (OpenAI function calling) | Text-only      |
 * | proxy    | Yes           | Yes (litellm + Anthropic)    | Text-only      |
 * | opencode | Yes (via SDK) | Yes (MCP bridge + SSE)       | Text-only      |
 *
 * Tool support per provider:
 * - claude/glm/firepass/proxy: Anthropic Messages API with native tool_use
 * - openai: OpenAI Chat Completions with function calling (chatWithOpenAITools)
 * - opencode: Tools via SaaS MCP server (/api/mcp), streaming via promptAsync + event.subscribe
 */
export type AIProvider = 'claude' | 'openai' | 'glm' | 'firepass' | 'proxy' | 'opencode';

export interface AIProviderDefaults {
  baseURL: string | null;
  model: string;
  /** 'anthropic' = Anthropic Messages API, 'openai' = OpenAI Chat Completions */
  protocol: 'anthropic' | 'openai';
  /**
   * How the API key is sent on the Anthropic protocol. Default (undefined) is the
   * `x-api-key` header; 'bearer' sends `Authorization: Bearer` instead (Fireworks
   * accepts only bearer tokens on its Anthropic-compatible endpoint).
   */
  auth?: 'bearer';
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
  firepass: {
    baseURL: 'https://api.fireworks.ai/inference',
    model: 'accounts/fireworks/routers/kimi-k2p6-turbo',
    protocol: 'anthropic',
    auth: 'bearer',
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
