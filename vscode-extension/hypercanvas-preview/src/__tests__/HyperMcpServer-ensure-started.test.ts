/**
 * @file HYP-954 — HyperMcpServer.ensureStarted() coverage: the async-race fix and the
 * retry-after-failure fix.
 *
 * Root cause this closes (see HYP-954): `hypercanvas.setupMcp` used to synchronously
 * check `mcpServer.port === 0` right after activation's fire-and-forget `.start()` —
 * a caller landing before start() resolved always saw port 0 and dead-ended. And a
 * single transient bind failure left the server permanently dead (the `.catch` only
 * logged) until a window reload, because nothing retried it.
 *
 * `ensureStarted()` fixes both: concurrent callers share one in-flight promise
 * (single-flight, closes the race), and a failed attempt clears the memo so the NEXT
 * call starts a genuinely new attempt (closes the terminal-failure bug).
 *
 * Mocks `../services/netProbe`'s `listenLoopback` (same technique as
 * HyperMcpServer-start-error.test.ts) via a mutable `currentBindImpl` — this file
 * needs a DIFFERENT bind outcome per test, unlike that file's single fixed rejection,
 * so the mock delegates to a swappable closure instead of a static implementation.
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

// Imported AFTER the mock.module call so HyperMcpServer picks up the mocked listenLoopback.
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

describe('HyperMcpServer.ensureStarted() (HYP-954)', () => {
  let server: InstanceType<typeof HyperMcpServer>;

  beforeEach(() => {
    bindCallCount = 0;
    currentBindImpl = () => Promise.reject(new Error('bindImpl not configured for this test'));
  });

  afterEach(() => {
    server?.dispose();
  });

  it('dedupes concurrent callers onto a single in-flight bind (closes the async race)', async () => {
    let resolveBind: (port: number) => void = () => {};
    currentBindImpl = () => new Promise<number>((resolve) => (resolveBind = resolve));

    server = new HyperMcpServer(createMinimalServices());
    const first = server.ensureStarted();
    const second = server.ensureStarted();

    // Both callers are awaiting the SAME bind attempt before it resolves.
    expect(bindCallCount).toBe(1);
    expect(server.state).toBe('STARTING');

    resolveBind(12345);
    await Promise.all([first, second]);

    expect(bindCallCount).toBe(1);
    expect(server.port).toBe(12345);
    expect(server.state).toBe('STARTED');
  });

  it('clears the memo on failure so the next call retries instead of replaying a cached rejection', async () => {
    currentBindImpl = () => Promise.reject(new Error('listen EACCES: permission denied 127.0.0.1:0'));
    server = new HyperMcpServer(createMinimalServices());

    await expect(server.ensureStarted()).rejects.toThrow('listen EACCES');
    expect(server.state).toBe('FAILED');
    expect(server.port).toBe(0);

    // A cached-rejection bug would make this call reject again with the SAME error
    // without ever calling listenLoopback a second time.
    currentBindImpl = () => Promise.resolve(54321);
    await server.ensureStarted();

    expect(bindCallCount).toBe(2);
    expect(server.port).toBe(54321);
    expect(server.state).toBe('STARTED');
  });

  it('already-started calls resolve immediately without a second bind attempt', async () => {
    currentBindImpl = () => Promise.resolve(9001);
    server = new HyperMcpServer(createMinimalServices());

    await server.ensureStarted();
    expect(bindCallCount).toBe(1);

    await server.ensureStarted();
    expect(bindCallCount).toBe(1);
    expect(server.port).toBe(9001);
  });

  it('abandons a hung attempt on timeout — Retry starts fresh, and the stale bind cannot resurrect state (review finding)', async () => {
    let resolveFirstBind: (port: number) => void = () => {};
    currentBindImpl = () => new Promise<number>((resolve) => (resolveFirstBind = resolve));

    server = new HyperMcpServer(createMinimalServices());
    await expect(server.ensureStarted(10)).rejects.toThrow(/did not start within 10ms/);
    expect(server.state).toBe('FAILED');

    // The abandoned attempt's bind eventually "succeeds" from listenLoopback's point of
    // view, but this settlement belongs to a superseded generation — HyperMcpServer must
    // NOT resurrect it as the current server (an earlier version of ensureStarted() did,
    // which meant Retry re-awaited the same hung promise forever — a no-op Retry button).
    resolveFirstBind(7777);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.state).toBe('FAILED');
    expect(server.port).toBe(0);

    // A user pressing Retry (a fresh ensureStarted() call) must trigger a genuinely NEW
    // bind attempt, not re-await the stale one.
    currentBindImpl = () => Promise.resolve(8888);
    await server.ensureStarted();

    expect(bindCallCount).toBe(2);
    expect(server.port).toBe(8888);
    expect(server.state).toBe('STARTED');
  });

  it('a slow caller that times out AFTER a Retry already succeeded must not tear down the healthy retry (round-4 review finding)', async () => {
    // The original bind attempt is left permanently hung (never resolved) —
    // it must stay abandoned/ignored for the rest of this test.
    currentBindImpl = () => new Promise<number>(() => {});

    server = new HyperMcpServer(createMinimalServices());

    // Simulates activation's long-timeout ensureStarted() (e.g. 30s in
    // production) still awaiting the very first, hung bind attempt. Its own
    // timeout is deliberately the LAST thing to fire in this test.
    //
    // Both this and the short-timeout call below race real setTimeout timers
    // (ensureStarted()'s `withTimeout` has no injectable clock). An earlier
    // version used 40ms/5ms, which passed in isolation but flaked in CI once
    // ~450 test files run in parallel: GC pauses / scheduler jitter routinely
    // exceed a 35ms gap, occasionally firing the two timers out of order (the
    // short-timeout call below observed the LONG timer's rejection message
    // instead of its own). 350ms of separation is comfortably beyond observed
    // CI jitter while keeping the test fast — see HYP-954 CI run 29005787419.
    const slowTimeoutMs = 400;
    const shortTimeoutMs = 50;
    const slowCaller = server.ensureStarted(slowTimeoutMs);

    // Simulates hypercanvas.setupMcp's short-timeout ensureStarted() (e.g. 3s
    // in production) racing the same attempt and timing out FIRST — this
    // abandons the hung attempt (closes it, flips state to FAILED) so a
    // subsequent Retry can start a genuinely fresh one.
    await expect(server.ensureStarted(shortTimeoutMs)).rejects.toThrow(
      new RegExp(`did not start within ${shortTimeoutMs}ms`),
    );
    expect(server.state).toBe('FAILED');
    expect(bindCallCount).toBe(1);

    // User presses Retry: a brand-new bind attempt starts and succeeds while
    // `slowCaller` above is STILL awaiting the original (now-abandoned, still
    // hung) promise on its own timer.
    currentBindImpl = () => Promise.resolve(9999);
    await server.ensureStarted();
    expect(server.state).toBe('STARTED');
    expect(server.port).toBe(9999);
    expect(bindCallCount).toBe(2);

    // `slowCaller`'s own timeout now fires. It must reject with ITS OWN
    // timeout error (the original bind is still hung) but must NOT touch the
    // now-healthy server that Retry already established. A buggy
    // implementation that only checks "_startPromise is truthy" (instead of
    // "is this still the attempt I was waiting on") would null it out, close
    // the live server, and flip state back to FAILED here.
    await expect(slowCaller).rejects.toThrow(new RegExp(`did not start within ${slowTimeoutMs}ms`));

    expect(server.state).toBe('STARTED');
    expect(server.port).toBe(9999);
    expect(bindCallCount).toBe(2);
  });

  it('onStarted() fires on every successful transition to STARTED, including a later retry (review finding — retry-success side effects)', async () => {
    currentBindImpl = () => Promise.reject(new Error('listen EACCES: permission denied 127.0.0.1:0'));
    server = new HyperMcpServer(createMinimalServices());

    const startedPorts: number[] = [];
    server.onStarted((port) => startedPorts.push(port));

    await expect(server.ensureStarted()).rejects.toThrow();
    expect(startedPorts).toEqual([]); // failed attempt never fires onStarted

    // A later successful retry (e.g. the user pressing Retry on the failure toast)
    // must fire onStarted() too — activation's config-write/status-bar side effects
    // used to run ONLY from the very first attempt's own .then(), silently skipping
    // a subsequent successful retry.
    currentBindImpl = () => Promise.resolve(6001);
    await server.ensureStarted();
    expect(startedPorts).toEqual([6001]);
  });

  it('a throwing onStarted listener does NOT corrupt lifecycle state (review round-3 finding)', async () => {
    currentBindImpl = () => Promise.resolve(6100);
    server = new HyperMcpServer(createMinimalServices());

    // A listener that throws (e.g. autoUpdateMcpConfigs doing file I/O) must not
    // reject ensureStarted() or flip the genuinely-bound server to FAILED.
    server.onStarted(() => {
      throw new Error('listener boom (simulated config-write failure)');
    });
    const secondListenerPorts: number[] = [];
    server.onStarted((port) => secondListenerPorts.push(port));

    await server.ensureStarted(); // must NOT reject despite the throwing listener
    expect(server.state).toBe('STARTED');
    expect(server.port).toBe(6100);
    // A throwing listener must not prevent the others from running.
    expect(secondListenerPorts).toEqual([6100]);
    // No spurious extra bind attempt from a bogus FAILED->Retry cycle.
    expect(bindCallCount).toBe(1);
  });

  describe('dispose()', () => {
    it('nulls the start-promise memo — ensureStarted() after dispose() starts a fresh server', async () => {
      currentBindImpl = () => Promise.resolve(11111);
      server = new HyperMcpServer(createMinimalServices());
      await server.ensureStarted();
      expect(server.port).toBe(11111);

      server.dispose();
      expect(server.port).toBe(0);
      expect(server.state).toBe('STOPPED');

      currentBindImpl = () => Promise.resolve(22222);
      await server.ensureStarted();

      expect(bindCallCount).toBe(2);
      expect(server.port).toBe(22222);
      expect(server.state).toBe('STARTED');
    });
  });
});
