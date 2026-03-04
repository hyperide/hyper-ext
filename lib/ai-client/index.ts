/**
 * Unified AI client for non-streaming and streaming requests.
 *
 * Single entry point for all AI API calls across SaaS server and VS Code extension.
 * Supports Anthropic SDK (claude, glm, proxy with anthropic backend)
 * and OpenAI-compatible fetch (openai, proxy with openai backend, opencode).
 *
 * For complex streaming with tools (agentic loops), use Anthropic SDK directly
 * with resolveServerAIConfig for provider resolution.
 */

export { type CallAIOptions, type CallAIStreamOptions, callAI, callAIStream } from './client.js';
export { type ResolvedAIConfig, resolveAIConfig } from './config.js';
