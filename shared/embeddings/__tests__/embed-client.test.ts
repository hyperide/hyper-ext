/**
 * @file Tests for the optional BGE-M3 embed client (HTTP wrapper).
 *
 * The client is health-gated and time-boxed: it returns embeddings only when
 * the server is reachable and well-behaved, otherwise null (which the resolver
 * treats as "model unavailable → use the pattern fallback"). It must NEVER throw.
 *
 * `fetch` is mocked per-test; no live server is contacted.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createEmbedClient } from '../embed-client';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return handler(url, init);
  }) as typeof fetch;
}

const OK_VEC = [
  [0.1, 0.2, 0.3],
  [0.4, 0.5, 0.6],
];

describe('createEmbedClient — disabled when no baseUrl', () => {
  it('returns null client when baseUrl is empty/undefined', () => {
    expect(createEmbedClient(undefined)).toBeNull();
    expect(createEmbedClient('')).toBeNull();
  });
});

describe('createEmbedClient.embed — happy path', () => {
  it('passes health, posts /embed, returns embeddings', async () => {
    const calls: string[] = [];
    mockFetch((url) => {
      calls.push(url);
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      if (url.endsWith('/embed')) return new Response(JSON.stringify({ embeddings: OK_VEC }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    const client = createEmbedClient('http://127.0.0.1:8080');
    expect(client).not.toBeNull();
    const out = await client!.embed(['locales', 'src']);
    expect(out).toEqual(OK_VEC);
    expect(calls.some((u) => u.endsWith('/health'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/embed'))).toBe(true);
  });

  it('caches the health probe (does not re-probe on every embed call)', async () => {
    let healthCalls = 0;
    mockFetch((url) => {
      if (url.endsWith('/health')) {
        healthCalls++;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ embeddings: OK_VEC }), { status: 200 });
    });
    const client = createEmbedClient('http://127.0.0.1:8080')!;
    await client.embed(['a', 'b']);
    await client.embed(['c', 'd']);
    expect(healthCalls).toBe(1);
  });
});

describe('createEmbedClient.embed — failure modes return null (never throw)', () => {
  it('health non-200 → null', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health')) return new Response('down', { status: 503 });
      return new Response(JSON.stringify({ embeddings: OK_VEC }), { status: 200 });
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(['a']);
    expect(out).toBeNull();
  });

  it('health network error → null', async () => {
    mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(['a']);
    expect(out).toBeNull();
  });

  it('embed non-200 → null', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(['a']);
    expect(out).toBeNull();
  });

  it('embed malformed JSON / missing embeddings → null', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      return new Response(JSON.stringify({ nope: true }), { status: 200 });
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(['a']);
    expect(out).toBeNull();
  });

  it('embed length mismatch (fewer vectors than texts) → null', async () => {
    mockFetch((url) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      return new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 });
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(['a', 'b']);
    expect(out).toBeNull();
  });

  it('empty input short-circuits to [] without any fetch', async () => {
    let called = false;
    mockFetch(() => {
      called = true;
      return new Response('x', { status: 200 });
    });
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed([]);
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('createEmbedClient.embed — batching over MAX_BATCH_SIZE', () => {
  it('chunks >32 texts into multiple /embed calls and concatenates in order', async () => {
    const embedBatches: number[] = [];
    mockFetch(async (url, init) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      const body = JSON.parse(String(init?.body)) as { texts: string[] };
      embedBatches.push(body.texts.length);
      // echo: each text → a 1-D vector equal to its numeric index encoded once
      return new Response(JSON.stringify({ embeddings: body.texts.map((t) => [Number(t)]) }), { status: 200 });
    });
    const texts = Array.from({ length: 70 }, (_, i) => String(i));
    const out = await createEmbedClient('http://127.0.0.1:8080')!.embed(texts);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(70);
    expect(out![0]).toEqual([0]);
    expect(out![69]).toEqual([69]);
    // 70 → 32 + 32 + 6
    expect(embedBatches).toEqual([32, 32, 6]);
  });
});
