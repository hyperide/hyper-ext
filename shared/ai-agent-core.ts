/**
 * Shared AI Agent Core
 *
 * Provides the streaming chat loop and Anthropic API provider that work
 * in both SaaS (server/services/ai-agent.ts) and VSCode extension (bridges/AIBridge.ts).
 *
 * Key abstractions:
 * - StreamProvider: creates an SSE stream from Anthropic API (or compatible)
 * - ToolExecutor: executes tools and returns results
 * - runChat(): async generator that drives the tool-use loop
 */

import type { ToolDefinition } from './ai-agent-tools.js';

// ============================================
// Core Types
// ============================================

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/** Parameters for creating a stream */
export interface StreamParams {
  model: string;
  system: string;
  messages: MessageParam[];
  tools: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
}

/** Anthropic message format */
export type MessageParam = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** Raw SSE event from Anthropic API */
export type RawStreamEvent =
  | { type: 'message_start'; message: { id: string; model: string; stop_reason: string | null } }
  | {
      type: 'content_block_start';
      index: number;
      content_block: { type: string; id?: string; name?: string; text?: string };
    }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null; usage?: { output_tokens: number } } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } };

/** Provider that creates SSE streams to Anthropic API */
interface StreamProvider {
  createStream(params: StreamParams): AsyncIterable<RawStreamEvent>;
}

/** Executor that runs tools and returns results */
export interface ToolExecutor {
  execute(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

// ============================================
// Chat Events (yielded by runChat)
// ============================================

export type ChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; toolName: string; toolUseId: string }
  | { type: 'tool_use_input'; toolUseId: string; partialJson: string }
  | { type: 'tool_use_end'; toolUseId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_use_result'; toolUseId: string; toolName: string; result: ToolResult }
  | { type: 'turn_complete'; messages: MessageParam[] }
  | { type: 'error'; error: string };

// ============================================
// runChat Options
// ============================================

export interface RunChatOptions {
  provider: StreamProvider;
  executor: ToolExecutor;
  model: string;
  system: string;
  messages: MessageParam[];
  tools: ToolDefinition[];
  maxTokens?: number;
  maxTurns?: number;
  signal?: AbortSignal;
}

// ============================================
// Core Chat Loop
// ============================================

/**
 * Drive an AI chat with automatic tool execution loop.
 *
 * Yields ChatEvent for each streaming token, tool use, and tool result.
 * Automatically continues the conversation when the model uses tools.
 * Stops when the model finishes without tool calls, or maxTurns is reached.
 */
export async function* runChat(options: RunChatOptions): AsyncGenerator<ChatEvent> {
  const { provider, executor, model, system, tools, maxTokens = 8192, maxTurns = 20, signal } = options;

  let messages = [...options.messages];
  let turns = 0;

  while (turns < maxTurns) {
    turns++;

    if (signal?.aborted) return;

    // Collect content blocks from the assistant's response
    const assistantBlocks: ContentBlock[] = [];
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let currentToolId = '';
    let currentToolName = '';
    let toolInputBuffer = '';
    let currentTextBuffer = '';
    let stopReason: string | null = null;

    try {
      const stream = provider.createStream({
        model,
        system,
        messages,
        tools,
        maxTokens,
        signal,
      });

      for await (const event of stream) {
        if (signal?.aborted) return;

        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use' && block.id && block.name) {
              currentToolId = block.id;
              currentToolName = block.name;
              toolInputBuffer = '';
              yield { type: 'tool_use_start', toolName: block.name, toolUseId: block.id };
            } else if (block.type === 'text') {
              currentTextBuffer = '';
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta' && delta.text) {
              currentTextBuffer += delta.text;
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
              toolInputBuffer += delta.partial_json;
              yield { type: 'tool_use_input', toolUseId: currentToolId, partialJson: delta.partial_json };
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId && currentToolName) {
              let input: Record<string, unknown> = {};
              try {
                input = JSON.parse(toolInputBuffer);
              } catch {
                // malformed JSON from model, treat as empty
              }

              assistantBlocks.push({
                type: 'tool_use',
                id: currentToolId,
                name: currentToolName,
                input,
              });
              toolCalls.push({ id: currentToolId, name: currentToolName, input });

              yield { type: 'tool_use_end', toolUseId: currentToolId, toolName: currentToolName, input };

              currentToolId = '';
              currentToolName = '';
              toolInputBuffer = '';
            } else if (currentTextBuffer) {
              assistantBlocks.push({ type: 'text', text: currentTextBuffer });
              currentTextBuffer = '';
            }
            break;
          }

          case 'message_delta': {
            stopReason = event.delta.stop_reason;
            break;
          }

          case 'error': {
            yield { type: 'error', error: event.error.message };
            return;
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      yield { type: 'error', error: err instanceof Error ? err.message : 'Stream error' };
      return;
    }

    // Collect any text blocks that were streamed (reconstruct from deltas would be complex,
    // but we only need this for the message history - the text was already yielded as deltas)
    // For simplicity, we build a text block from accumulated text if there are no tool calls
    // In practice, the assistant blocks already contain tool_use blocks from above

    // Execute tool calls
    if (toolCalls.length > 0) {
      // Add assistant message with tool calls
      messages = [...messages, { role: 'assistant', content: assistantBlocks }];

      // Execute each tool and collect results
      const toolResultBlocks: ContentBlock[] = [];
      for (const tool of toolCalls) {
        if (signal?.aborted) return;

        const result = await executor.execute(tool.name, tool.input);
        yield { type: 'tool_use_result', toolUseId: tool.id, toolName: tool.name, result };

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result.success ? result.output || 'Done' : `Error: ${result.error}`,
        });
      }

      // Add tool results as user message
      messages = [...messages, { role: 'user', content: toolResultBlocks }];

      // Continue the loop to let the model respond to tool results
      continue;
    }

    // No tool calls — conversation turn is complete
    if (stopReason === 'max_tokens') {
      // Model ran out of tokens mid-response, continue with accumulated text
      const blocks = assistantBlocks.length > 0 ? assistantBlocks : [{ type: 'text' as const, text: '...' }];
      messages = [
        ...messages,
        { role: 'assistant', content: blocks },
        { role: 'user', content: 'Continue from where you left off.' },
      ];
      continue;
    }

    // end_turn or stop — we're done
    yield { type: 'turn_complete', messages };
    return;
  }

  // Exceeded max turns
  yield { type: 'turn_complete', messages };
}

// ============================================
// FetchAnthropicProvider
// ============================================

export interface FetchAnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

/**
 * StreamProvider that uses raw fetch() to call the Anthropic Messages API.
 * Reserved for Anthropic-protocol endpoints (the real Anthropic API, and
 * commandcode's /messages gateway for claude-* models); every other provider
 * goes through FetchOpenAIProvider.
 * Works in both Node.js and browser environments (VSCode extension webview).
 */
export class FetchAnthropicProvider implements StreamProvider {
  private _apiKey: string;
  private _baseUrl: string;

  constructor(options: FetchAnthropicProviderOptions) {
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl || 'https://api.anthropic.com';
  }

  async *createStream(params: StreamParams): AsyncGenerator<RawStreamEvent> {
    const body = {
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      stream: true,
    };

    const response = await fetch(`${this._baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this._apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as RawStreamEvent;
            yield event;
          } catch {
            // skip unparseable SSE lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const remaining = buffer.trim();
        if (remaining.startsWith('data: ')) {
          const data = remaining.slice(6).trim();
          if (data && data !== '[DONE]') {
            try {
              yield JSON.parse(data) as RawStreamEvent;
            } catch {
              // skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ============================================
// FetchOpenAIProvider
// ============================================

export interface FetchOpenAIProviderOptions {
  apiKey: string;
  /** OpenAI-compatible base, e.g. https://api.commandcode.ai/provider/v1 — /chat/completions is appended */
  baseUrl: string;
}

/** OpenAI streaming delta for a function tool call */
interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIStreamChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: OpenAIToolCallDelta[] };
    finish_reason?: string | null;
  }[];
}

/**
 * StreamProvider that speaks OpenAI Chat Completions with function calling and
 * translates the stream into the Anthropic-shaped RawStreamEvent sequence that
 * runChat() consumes. This gives OpenAI-protocol providers (Command Code OSS
 * models, OpenAI, any /chat/completions gateway) the same agentic tool loop the
 * Anthropic path has.
 */
export class FetchOpenAIProvider implements StreamProvider {
  private _apiKey: string;
  private _baseUrl: string;

  constructor(options: FetchOpenAIProviderOptions) {
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async *createStream(params: StreamParams): AsyncGenerator<RawStreamEvent> {
    const body = {
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      messages: toOpenAIMessages(params.system, params.messages),
      ...(params.tools.length > 0
        ? {
            tools: params.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.input_schema },
            })),
          }
        : {}),
    };

    const response = await fetch(`${this._baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI-compatible API error ${response.status}: ${errorBody}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    yield { type: 'message_start', message: { id: 'openai', model: params.model, stop_reason: null } };

    // Translator state. Text streams through immediately as a text block; tool
    // calls CANNOT be streamed as blocks because OpenAI emits parallel calls
    // with interleaved per-index deltas — they are accumulated per index here
    // and emitted as complete tool_use blocks after the stream ends.
    let blockIndex = -1;
    let textOpen = false;
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // Labeled so the [DONE] sentinel can reach finalization immediately —
      // some proxies keep the SSE socket open after sending it.
      read: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;
          if (data === '[DONE]') break read;

          let chunk: OpenAIStreamChunk;
          try {
            chunk = JSON.parse(data) as OpenAIStreamChunk;
          } catch {
            continue; // skip unparseable SSE lines
          }
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const text = choice.delta?.content;
          if (typeof text === 'string' && text.length > 0) {
            if (!textOpen) {
              blockIndex++;
              textOpen = true;
              yield { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } };
            }
            yield { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } };
          }

          for (const call of choice.delta?.tool_calls ?? []) {
            const entry = toolCalls.get(call.index) ?? { id: '', name: '', args: '' };
            if (call.id) entry.id = call.id;
            // Names and arguments both stream in fragments — append, never overwrite.
            if (call.function?.name) entry.name += call.function.name;
            if (call.function?.arguments) entry.args += call.function.arguments;
            toolCalls.set(call.index, entry);
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (textOpen) {
      yield { type: 'content_block_stop', index: blockIndex };
    }

    // Emit the accumulated tool calls as complete blocks, in index order.
    for (const [index, call] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      blockIndex++;
      yield {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id: call.id || `call_${index}`, name: call.name || 'unknown_tool' },
      };
      if (call.args) {
        yield {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: call.args },
        };
      }
      yield { type: 'content_block_stop', index: blockIndex };
    }

    // Map OpenAI finish reasons onto Anthropic stop reasons for runChat.
    const stopReason =
      finishReason === 'tool_calls' || toolCalls.size > 0
        ? 'tool_use'
        : finishReason === 'length'
          ? 'max_tokens'
          : 'end_turn';
    yield { type: 'message_delta', delta: { stop_reason: stopReason } };
    yield { type: 'message_stop' };
  }
}

/**
 * OpenAI Chat Completions wire-format message produced by toOpenAIMessages.
 */
export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Convert Anthropic-shaped message history (runChat's in-memory history, or the
 * SaaS chat history persisted in that shape) into OpenAI Chat Completions
 * messages: tool_use blocks become assistant tool_calls, tool_result blocks
 * become role:"tool" messages.
 */
export function toOpenAIMessages(system: string, messages: MessageParam[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolCalls = msg.content
        .filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }));
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user message with blocks: tool results become role:"tool"; any text rides separately
    const textBlocks: string[] = [];
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
      } else if (block.type === 'text') {
        textBlocks.push(block.text);
      }
    }
    if (textBlocks.length > 0) {
      out.push({ role: 'user', content: textBlocks.join('\n') });
    }
  }

  return out;
}
