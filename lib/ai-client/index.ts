/**
 * Unified AI client for non-streaming and streaming requests.
 *
 * Single entry point for all AI API calls across SaaS server and VS Code extension.
 * Anthropic SDK serves Anthropic-protocol endpoints only (claude, commandcode
 * claude-* models, proxy with anthropic backend); everything else (glm, firepass,
 * commandcode OSS models, openai, opencode) speaks OpenAI chat completions.
 *
 * For complex streaming with tools (agentic loops), use Anthropic SDK directly
 * with resolveServerAIConfig for provider resolution.
 */

export { callAI, callAIStream } from './client.js';
export { type ResolvedAIConfig, resolveAIConfig } from './config.js';
