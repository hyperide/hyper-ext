/**
 * Unified AI client (non-streaming + streaming).
 *
 * Routes to Anthropic SDK or OpenAI-compatible fetch based on config.provider.
 * Throws on failure — caller decides fallback strategy.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ResolvedAIConfig } from './config.js';

/**
 * Cache Anthropic client instances by apiKey+baseURL to reuse connections.
 * Limited to 8 entries — evicts oldest on overflow (covers key rotation without leaking).
 */
const MAX_ANTHROPIC_CLIENTS = 8;
const anthropicClientCache = new Map<string, Anthropic>();

function getAnthropicClient(apiKey: string, baseURL?: string): Anthropic {
  const cacheKey = `${apiKey}::${baseURL ?? ''}`;
  let client = anthropicClientCache.get(cacheKey);
  if (!client) {
    // Evict oldest entry if cache is full
    if (anthropicClientCache.size >= MAX_ANTHROPIC_CLIENTS) {
      const oldestKey = anthropicClientCache.keys().next().value;
      if (oldestKey !== undefined) anthropicClientCache.delete(oldestKey);
    }
    client = new Anthropic({ apiKey, baseURL: baseURL || undefined });
    anthropicClientCache.set(cacheKey, client);
  }
  return client;
}

export interface CallAIOptions {
  /** Max tokens in the response (default: 2048) */
  maxTokens?: number;
  /** System prompt (optional) */
  system?: string;
}

export interface CallAIStreamOptions extends CallAIOptions {
  /** AbortSignal to cancel the stream */
  abortSignal?: AbortSignal;
}

/**
 * Send a prompt to an AI provider and return the raw text response.
 *
 * Usage (server):
 *   const config = await resolveServerAIConfig(workspaceId);
 *   const text = await callAI(config, prompt);
 *
 * Usage (extension):
 *   const config = resolveAIConfig({ provider, apiKey, model, baseURL, backend });
 *   const text = await callAI(config, prompt);
 */
export async function callAI(config: ResolvedAIConfig, prompt: string, options?: CallAIOptions): Promise<string> {
  const maxTokens = options?.maxTokens ?? 2048;

  if (config.provider === 'openai') {
    return callOpenAICompatible(config.apiKey, config.baseURL || 'https://api.openai.com/v1', config.model, prompt, {
      maxTokens,
      system: options?.system,
    });
  }

  // Anthropic SDK path
  const anthropic = getAnthropicClient(config.apiKey, config.baseURL);

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    ...(options?.system ? { system: options.system } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected AI response type');
  }
  return content.text;
}

/**
 * Stream text from an AI provider. Yields text chunks as they arrive.
 *
 * Supports abort via AbortSignal. For tools/agentic loops, use Anthropic SDK directly.
 */
export async function* callAIStream(
  config: ResolvedAIConfig,
  prompt: string,
  options?: CallAIStreamOptions,
): AsyncGenerator<string> {
  const maxTokens = options?.maxTokens ?? 2048;

  if (config.provider === 'openai') {
    yield* streamOpenAICompatible(config.apiKey, config.baseURL || 'https://api.openai.com/v1', config.model, prompt, {
      maxTokens,
      system: options?.system,
      abortSignal: options?.abortSignal,
    });
    return;
  }

  // Anthropic SDK streaming path
  const anthropic = getAnthropicClient(config.apiKey, config.baseURL);

  if (options?.abortSignal?.aborted) return;

  const stream = anthropic.messages.stream({
    model: config.model,
    max_tokens: maxTokens,
    ...(options?.system ? { system: options.system } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  // Abort proactively when signal fires (not only when next event arrives)
  const abortHandler = () => stream.abort();
  options?.abortSignal?.addEventListener('abort', abortHandler, { once: true });

  try {
    for await (const event of stream) {
      if (options?.abortSignal?.aborted) break;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  } finally {
    options?.abortSignal?.removeEventListener('abort', abortHandler);
  }
}

/**
 * Call an OpenAI Chat Completions-compatible API via fetch.
 * Works with OpenAI, Gemini, DeepSeek, Mistral, Groq, Qwen, etc.
 */
async function callOpenAICompatible(
  apiKey: string,
  baseURL: string,
  model: string,
  prompt: string,
  options: { maxTokens: number; system?: string },
): Promise<string> {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const messages: Array<{ role: string; content: string }> = [];

  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0].message.content;
}

/**
 * Stream from an OpenAI Chat Completions-compatible API via SSE fetch.
 */
async function* streamOpenAICompatible(
  apiKey: string,
  baseURL: string,
  model: string,
  prompt: string,
  options: { maxTokens: number; system?: string; abortSignal?: AbortSignal },
): AsyncGenerator<string> {
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const messages: Array<{ role: string; content: string }> = [];

  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens,
      messages,
      stream: true,
    }),
    signal: options.abortSignal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible API streaming error ${response.status}: ${text}`);
  }

  if (!response.body) {
    throw new Error('No response body for streaming');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data) as {
            choices: { delta: { content?: string } }[];
          };
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
