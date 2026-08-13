import { afterEach, describe, expect, it } from 'bun:test';
import { type ChatEvent, FetchOpenAIProvider, runChat, toOpenAIMessages, type ToolExecutor } from './ai-agent-core';

const realFetch = globalThis.fetch;

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}\n\n`).join('');
}

/**
 * Mock fetch that serves a scripted sequence of OpenAI streaming responses
 * (one per POST) and records each request body for assertions.
 */
function scriptOpenAIStreams(bodies: string[]): { requests: { url: string; body: Record<string, unknown> }[] } {
  const captured: { requests: { url: string; body: Record<string, unknown> }[] } = { requests: [] };
  let call = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const payload = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as typeof fetch;
  return captured;
}

const TOOL_CALL_STREAM = sse([
  JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'Let me edit that. ' } }] }),
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }],
        },
      },
    ],
  }),
  JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a.tsx",' } }] } }],
  }),
  JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"content":"x"}' } }] } }],
  }),
  JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  '[DONE]',
]);

const FINAL_STREAM = sse([
  JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'Done!' } }] }),
  JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
  '[DONE]',
]);

// OpenAI's default: PARALLEL tool calls with interleaved per-index deltas.
const PARALLEL_INTERLEAVED_STREAM = sse([
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '' } }],
        },
      },
    ],
  }),
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'write_file', arguments: '' } }],
        },
      },
    ],
  }),
  JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] }),
  JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"path":"b.tsx"}' } }] } }] }),
  JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.tsx"}' } }] } }] }),
  JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
  '[DONE]',
]);

const TOOLS = [
  {
    name: 'write_file',
    description: 'Write a file',
    input_schema: { type: 'object' as const, properties: { path: { type: 'string' } } },
  },
];

describe('toOpenAIMessages history conversion', () => {
  it('carries Anthropic-shaped tool_use/tool_result history into OpenAI messages', () => {
    // Server chat history persists tool turns as Anthropic-shaped blocks
    // regardless of which protocol produced them — the OpenAI path must not
    // drop them when rebuilding the wire messages (HYP-632).
    const out = toOpenAIMessages('sys', [
      { role: 'user', content: 'Make it red' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Editing now.' },
          { type: 'tool_use', id: 'call_9', name: 'edit_file', input: { path: 'a.tsx' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_9', content: 'done' }] },
      { role: 'assistant', content: 'Done — it is red now.' },
    ]);

    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    const assistantWithCalls = out.find((m) => Array.isArray(m.tool_calls));
    expect(assistantWithCalls?.tool_calls).toEqual([
      { id: 'call_9', type: 'function', function: { name: 'edit_file', arguments: '{"path":"a.tsx"}' } },
    ]);
    const toolMsg = out.find((m) => m.role === 'tool');
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'call_9', content: 'done' });
    expect(out[out.length - 1]).toEqual({ role: 'assistant', content: 'Done — it is red now.' });
  });
});

describe('FetchOpenAIProvider tool loop', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('drives runChat through an OpenAI function-calling round trip', async () => {
    const captured = scriptOpenAIStreams([TOOL_CALL_STREAM, FINAL_STREAM]);
    const provider = new FetchOpenAIProvider({ apiKey: 'cc-key', baseUrl: 'https://example.test/v1' });
    const executed: { name: string; input: Record<string, unknown> }[] = [];
    const executor: ToolExecutor = {
      execute: async (name, input) => {
        executed.push({ name, input });
        return { success: true, output: 'written' };
      },
    };

    const events: ChatEvent[] = [];
    for await (const ev of runChat({
      provider,
      executor,
      model: 'deepseek/deepseek-v4-pro',
      system: 'You are an editor.',
      messages: [{ role: 'user', content: 'Make the button red' }],
      tools: TOOLS,
    })) {
      events.push(ev);
    }

    // Tool was executed with parsed streamed arguments
    expect(executed).toEqual([{ name: 'write_file', input: { path: 'a.tsx', content: 'x' } }]);

    // Events include the full tool lifecycle and final text
    const types = events.map((e) => e.type);
    expect(types).toContain('tool_use_start');
    expect(types).toContain('tool_use_end');
    expect(types).toContain('tool_use_result');
    expect(types[types.length - 1]).toBe('turn_complete');
    const text = events
      .filter((e): e is Extract<ChatEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    expect(text).toContain('Done!');

    // First request: OpenAI-shaped tools + endpoint
    const first = captured.requests[0];
    expect(first.url).toBe('https://example.test/v1/chat/completions');
    const firstTools = first.body.tools as { type: string; function: { name: string } }[];
    expect(firstTools[0]).toMatchObject({ type: 'function', function: { name: 'write_file' } });

    // Second request: history carries assistant tool_calls + role:"tool" result
    const second = captured.requests[1];
    const msgs = second.body.messages as { role: string; tool_call_id?: string; tool_calls?: unknown[] }[];
    expect(msgs[0].role).toBe('system');
    const assistantWithCalls = msgs.find((m) => m.role === 'assistant' && m.tool_calls);
    expect(assistantWithCalls).toBeTruthy();
    const toolMsg = msgs.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('call_1');
  });

  it('handles parallel interleaved tool-call deltas without corrupting calls', async () => {
    scriptOpenAIStreams([PARALLEL_INTERLEAVED_STREAM, FINAL_STREAM]);
    const provider = new FetchOpenAIProvider({ apiKey: 'k', baseUrl: 'https://example.test/v1' });
    const executed: { name: string; input: Record<string, unknown> }[] = [];
    const executor: ToolExecutor = {
      execute: async (name, input) => {
        executed.push({ name, input });
        return { success: true, output: 'ok' };
      },
    };

    for await (const _ev of runChat({
      provider,
      executor,
      model: 'gpt-test',
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
    })) {
      // drain
    }

    expect(executed).toEqual([
      { name: 'read_file', input: { path: 'a.tsx' } },
      { name: 'write_file', input: { path: 'b.tsx' } },
    ]);
  });

  it('accumulates function names split across deltas', async () => {
    const SPLIT_NAME_STREAM = sse([
      JSON.stringify({
        choices: [
          { delta: { tool_calls: [{ index: 0, id: 'call_s', type: 'function', function: { name: 'read' } }] } },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '_file', arguments: '{}' } }] } }],
      }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      '[DONE]',
    ]);
    scriptOpenAIStreams([SPLIT_NAME_STREAM, FINAL_STREAM]);
    const provider = new FetchOpenAIProvider({ apiKey: 'k', baseUrl: 'https://example.test/v1' });
    const executed: string[] = [];
    for await (const _ev of runChat({
      provider,
      executor: {
        execute: async (name) => {
          executed.push(name);
          return { success: true };
        },
      },
      model: 'gpt-test',
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
    })) {
      // drain
    }
    expect(executed).toEqual(['read_file']);
  });

  it('finalizes on data:[DONE] even if the connection stays open', async () => {
    // Some proxies send [DONE] but keep the SSE socket alive — the stream must
    // finalize on the sentinel, not on TCP close.
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(FINAL_STREAM));
          // never calls controller.close()
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    const provider = new FetchOpenAIProvider({ apiKey: 'k', baseUrl: 'https://example.test/v1' });
    const events: ChatEvent[] = [];
    for await (const ev of runChat({
      provider,
      executor: { execute: async () => ({ success: true }) },
      model: 'gpt-test',
      system: 's',
      messages: [{ role: 'user', content: 'go' }],
      tools: [],
    })) {
      events.push(ev);
    }
    expect(events[events.length - 1].type).toBe('turn_complete');
  });
});
