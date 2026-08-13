import { afterEach, describe, expect, it } from 'bun:test';
import { FetchAnthropicProvider } from './ai-agent-core';

const realFetch = globalThis.fetch;

function captureFetchHeaders(): { headers: Record<string, string> | null } {
  const captured: { headers: Record<string, string> | null } = { headers: null };
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured.headers = (init?.headers as Record<string, string>) ?? null;
    return new Response('data: {"type":"message_stop"}\n\n', { status: 200 });
  }) as typeof fetch;
  return captured;
}

async function drain(provider: FetchAnthropicProvider): Promise<void> {
  const stream = provider.createStream({
    model: 'test-model',
    maxTokens: 16,
    system: '',
    messages: [],
    tools: [],
  });
  for await (const _event of stream) {
    // drain
  }
}

describe('FetchAnthropicProvider auth headers', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends x-api-key (Anthropic SDK semantics — this provider serves Anthropic only)', async () => {
    const captured = captureFetchHeaders();
    await drain(new FetchAnthropicProvider({ apiKey: 'sk-test', baseUrl: 'https://example.test' }));
    expect(captured.headers?.['x-api-key']).toBe('sk-test');
    expect(captured.headers?.Authorization).toBeUndefined();
  });
});
