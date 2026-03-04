import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { ResolvedAIConfig } from '../config';

// Mock Anthropic SDK before importing client
const mockCreate = mock(() =>
  Promise.resolve({
    content: [{ type: 'text', text: 'Hello from Claude' }],
  }),
);

const mockStreamAbort = mock();
const mockStreamAsyncIterator = mock();

const mockStream = mock(() => ({
  abort: mockStreamAbort,
  [Symbol.asyncIterator]: () => mockStreamAsyncIterator(),
}));

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
  },
}));

// Import AFTER mocking
const { callAI, callAIStream } = await import('../client');

const anthropicConfig: ResolvedAIConfig = {
  apiKey: 'sk-ant-test',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
};

const openaiConfig: ResolvedAIConfig = {
  apiKey: 'sk-openai-test',
  model: 'gpt-4o',
  baseURL: 'https://api.openai.com/v1',
  provider: 'openai',
};

describe('callAI', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello from Claude' }],
    });
  });

  it('should call Anthropic SDK for anthropic provider', async () => {
    const result = await callAI(anthropicConfig, 'test prompt');
    expect(result).toBe('Hello from Claude');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-4-20250514');
    expect(call.messages[0].content).toBe('test prompt');
  });

  it('should pass system prompt when provided', async () => {
    await callAI(anthropicConfig, 'test', { system: 'You are helpful' });
    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toBe('You are helpful');
  });

  it('should respect maxTokens option', async () => {
    await callAI(anthropicConfig, 'test', { maxTokens: 4096 });
    const call = mockCreate.mock.calls[0][0];
    expect(call.max_tokens).toBe(4096);
  });

  it('should use default maxTokens of 2048', async () => {
    await callAI(anthropicConfig, 'test');
    const call = mockCreate.mock.calls[0][0];
    expect(call.max_tokens).toBe(2048);
  });

  it('should throw on non-text response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'test' }],
    });
    await expect(callAI(anthropicConfig, 'test')).rejects.toThrow('Unexpected AI response type');
  });

  it('should call OpenAI-compatible API for openai provider', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from GPT' } }],
        }),
        { status: 200 },
      ),
    );

    const result = await callAI(openaiConfig, 'test prompt');
    expect(result).toBe('Hello from GPT');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'test prompt' }]);

    fetchSpy.mockRestore();
  });

  it('should include system message for openai when provided', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
        }),
        { status: 200 },
      ),
    );

    await callAI(openaiConfig, 'test', { system: 'Be concise' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be concise' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'test' });

    fetchSpy.mockRestore();
  });

  it('should throw on OpenAI API error', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(callAI(openaiConfig, 'test')).rejects.toThrow('OpenAI-compatible API error 401');

    fetchSpy.mockRestore();
  });

  it('should strip trailing slashes from baseURL', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    );

    await callAI({ ...openaiConfig, baseURL: 'https://api.example.com/v1///' }, 'test');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');

    fetchSpy.mockRestore();
  });
});

describe('callAIStream', () => {
  it('should stream text from OpenAI-compatible API', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([sseBody]).stream(), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const chunks: string[] = [];
    for await (const chunk of callAIStream(openaiConfig, 'test')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['Hello', ' World']);

    fetchSpy.mockRestore();
  });

  it('should pass abortSignal to fetch for OpenAI streams', async () => {
    const controller = new AbortController();
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['data: [DONE]\n\n']).stream(), { status: 200 }),
    );

    const gen = callAIStream(openaiConfig, 'test', { abortSignal: controller.signal });
    // Consume
    for await (const _ of gen) {
      /* noop */
    }

    expect(fetchSpy.mock.calls[0][1].signal).toBe(controller.signal);
    fetchSpy.mockRestore();
  });

  it('should skip empty and non-data SSE lines', async () => {
    const sseBody = [
      ': comment\n',
      '\n',
      'event: ping\n\n',
      'data: {"choices":[{"delta":{"content":"only"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([sseBody]).stream(), { status: 200 }),
    );

    const chunks: string[] = [];
    for await (const chunk of callAIStream(openaiConfig, 'test')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['only']);

    fetchSpy.mockRestore();
  });

  it('should handle malformed SSE chunks gracefully', async () => {
    const sseBody = [
      'data: not-json\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([sseBody]).stream(), { status: 200 }),
    );

    const chunks: string[] = [];
    for await (const chunk of callAIStream(openaiConfig, 'test')) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['ok']);

    fetchSpy.mockRestore();
  });

  it('should return immediately if abortSignal is already aborted (anthropic)', async () => {
    const controller = new AbortController();
    controller.abort();

    const chunks: string[] = [];
    for await (const chunk of callAIStream(anthropicConfig, 'test', {
      abortSignal: controller.signal,
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
