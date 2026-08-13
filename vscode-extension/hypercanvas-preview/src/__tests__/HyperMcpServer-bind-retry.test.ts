/**
 * @file HYP-954 — end-to-end coverage for HyperMcpServer's bind-retry LOOP
 * (`_bindWithRetry`, exercised via `start()`): retryable errno codes get a bounded
 * number of attempts with the real backoff schedule; everything else fails fast.
 * Complements bindRetry.test.ts, which covers the classification/jitter helpers in
 * isolation — this file proves HyperMcpServer actually wires them into the bind loop
 * (recreates the net.Server per attempt, stops at the bound, rejects immediately for
 * non-retryable errors).
 *
 * Uses the real 250/500/1000ms backoff schedule (no fake timers in this repo's test
 * setup) — the exhaustion case therefore takes ~1.75s real time. Kept in its own file
 * so a slow run here doesn't block the fast HyperMcpServer-ensure-started.test.ts cases.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

type BindImpl = () => Promise<number>;

let bindCallCount = 0;
let currentBindImpl: BindImpl = () => Promise.reject(new Error('bindImpl not configured for this test'));

mock.module('../services/netProbe', () => ({
  listenLoopback: () => {
    bindCallCount++;
    return currentBindImpl();
  },
}));

const { HyperMcpServer } = await import('../mcp/HyperMcpServer');
import type { HyperMcpServices } from '../mcp/types';

function createMinimalServices(): HyperMcpServices {
  return {
    astService: {} as HyperMcpServices['astService'],
    componentService: {} as HyperMcpServices['componentService'],
    stateHub: { state: { currentComponent: null } } as unknown as HyperMcpServices['stateHub'],
    diagnosticHub: {} as HyperMcpServices['diagnosticHub'],
    workspaceRoot: '/test-workspace',
    onNavigate: mock(() => Promise.resolve()),
    onRefresh: mock(),
    onOpenComponent: mock(),
    onScreenshot: mock(() => Promise.resolve(null)),
  };
}

function errnoError(code: string): NodeJS.ErrnoException {
  const err = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

describe('HyperMcpServer bind-retry loop (HYP-954)', () => {
  let server: InstanceType<typeof HyperMcpServer>;

  beforeEach(() => {
    bindCallCount = 0;
  });

  afterEach(() => {
    server?.dispose();
  });

  it('retries EADDRINUSE and succeeds once the port frees up', async () => {
    currentBindImpl = () => {
      if (bindCallCount === 1) return Promise.reject(errnoError('EADDRINUSE'));
      return Promise.resolve(33333);
    };
    server = new HyperMcpServer(createMinimalServices());

    const port = await server.start();

    expect(bindCallCount).toBe(2);
    expect(port).toBe(33333);
    expect(server.port).toBe(33333);
  }, 10_000);

  it('exhausts all attempts (1 initial + 3 retries) then rejects with the last error', async () => {
    currentBindImpl = () => Promise.reject(errnoError('EADDRINUSE'));
    server = new HyperMcpServer(createMinimalServices());

    await expect(server.start()).rejects.toThrow('simulated EADDRINUSE');

    expect(bindCallCount).toBe(4);
    expect(server.port).toBe(0);
    expect(server.startError).toBe('simulated EADDRINUSE');
  }, 10_000);

  it('dispose() during the retry backoff delay prevents a new bind attempt (review finding — no zombie listener)', async () => {
    currentBindImpl = () => Promise.reject(errnoError('EADDRINUSE'));
    server = new HyperMcpServer(createMinimalServices());

    const startPromise = server.start(); // attempt 1 fails, enters the ~250ms backoff delay
    await new Promise((resolve) => setTimeout(resolve, 50)); // still inside the backoff window
    server.dispose();

    await expect(startPromise).rejects.toThrow();
    // If the generation guard were missing, the retry loop would create and bind a
    // SECOND net.Server right about now — a listener nobody references anymore.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(bindCallCount).toBe(1);
  }, 10_000);

  it('does not retry EACCES — fails on the first attempt', async () => {
    currentBindImpl = () => Promise.reject(errnoError('EACCES'));
    server = new HyperMcpServer(createMinimalServices());

    const startedAt = Date.now();
    await expect(server.start()).rejects.toThrow('simulated EACCES');
    const elapsedMs = Date.now() - startedAt;

    expect(bindCallCount).toBe(1);
    // No backoff wait at all — well under the 250ms*0.8 floor of a single retry delay.
    expect(elapsedMs).toBeLessThan(200);
  });
});
