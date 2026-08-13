import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as http from 'node:http';

/**
 * PreviewProxy serving-state coupling (HYP-370 Phase 4).
 *
 * Verifies the proxy short-circuits requests EXACTLY when it is not in a
 * serving state, and that "serving" is derived from an injected predicate
 * (single source of truth held by DevServerManager) rather than a private
 * _isStopping flag the proxy maintains itself.
 *
 * PreviewProxy reads the pre-built iframe scripts via fs.readFileSync at
 * import time; those .js files only exist next to the bundled output, not in
 * src/. Stub readFileSync for them so the real class can be imported. Every
 * other fs use (fs.promises for vite.config / package.json) is left intact.
 *
 * Requires `--isolate` (the repo `test` script and CI both pass it): bun's
 * mock.module is process-global, and DevServerManager.test.ts globally mocks
 * '../services/PreviewProxy'. Without isolation that stub would leak into this
 * file's `import` of the real class. `bun run test` / CI run with --isolate, so
 * each file gets its own module registry and this test imports the real proxy.
 */
const realFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return realFs.readFileSync(file as string, enc as never);
  },
}));

const { PreviewProxy } = await import('../PreviewProxy');

/**
 * Minimal upstream "dev server". Defaults to always answering 200 with a marker body;
 * pass `handler` to simulate a different topology (e.g. a dev server with no /test-preview
 * route, matching the live-verified conloca cms-spa case).
 */
function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('UPSTREAM_OK');
  },
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => res());
            }),
        });
      } else {
        reject(new Error('no upstream address'));
      }
    });
  });
}

function get(port: number, path = '/'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('PreviewProxy serving-state coupling (HYP-370 Phase 4)', () => {
  let upstream: { port: number; close: () => Promise<void> };
  let proxy: InstanceType<typeof PreviewProxy>;

  beforeEach(async () => {
    upstream = await startUpstream();
  });

  afterEach(async () => {
    proxy?.stop();
    await upstream.close();
  });

  it('proxies the request when the injected serving predicate is true', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await get(proxy.port ?? 0);
    expect(res.status).toBe(200);
    expect(res.body).toBe('UPSTREAM_OK');
  });

  it('short-circuits with 503 (no upstream hit) when the serving predicate is false', async () => {
    proxy = new PreviewProxy(upstream.port);
    let serving = true;
    proxy.setIsServing(() => serving);
    await proxy.start();

    // Flip the manager-owned source of truth to "not serving" — the proxy must
    // refuse without calling proxy.stop() directly.
    serving = false;
    const res = await get(proxy.port ?? 0);
    expect(res.status).toBe(503);
    expect(res.body).not.toContain('UPSTREAM_OK');
  });

  it('defaults to serving when no predicate is injected (back-compat)', async () => {
    proxy = new PreviewProxy(upstream.port);
    await proxy.start();
    const res = await get(proxy.port ?? 0);
    expect(res.status).toBe(200);
    expect(res.body).toBe('UPSTREAM_OK');
  });
});

/**
 * `process` shim. A previewed user app whose module graph reads `process.env` at
 * module init (e.g. hyperide's `client/` → `@babel/traverse` → `@babel/types`)
 * crashes with `ReferenceError: process is not defined` in the iframe. The proxy
 * defines `process` BEFORE the user's deferred `<script type="module">` entry
 * evaluates.
 *
 * The shim is exposed two ways: injected as a classic <script> at the start of
 * <head> for App-Shell HTML, AND served as a virtual `/__hypercanvas/process-shim.js`
 * endpoint (so Remix routes, which render their own scripts, can pull it).
 *
 * NB: the HTML-injection round-trip is asserted by the e2e harness
 * (debug-hyperide-preview.mts), not here — the proxy forces `transfer-encoding:
 * chunked` on injected HTML, which Bun's test-runtime HTTP client rejects with
 * HPE_INVALID_HEADER_TOKEN (a Bun parser quirk; Chromium and Node accept it). The
 * virtual endpoint serves with content-length (no chunked), so it round-trips
 * cleanly under `bun test` and still proves the shim content.
 */
describe('PreviewProxy process-shim', () => {
  let upstream: { port: number; close: () => Promise<void> };
  let proxy: InstanceType<typeof PreviewProxy>;

  beforeEach(async () => {
    upstream = await startUpstream();
  });

  afterEach(async () => {
    proxy?.stop();
    await upstream.close();
  });

  it('serves the process shim as a virtual /__hypercanvas/process-shim.js endpoint', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await get(proxy.port ?? 0, '/__hypercanvas/process-shim.js');
    expect(res.status).toBe(200);
    // Must NOT hit the upstream — it's served from the in-extension script map.
    expect(res.body).not.toContain('UPSTREAM_OK');
    // The shim defines a browser-safe `process` with an env + NODE_ENV.
    expect(res.body).toContain('process');
    expect(res.body).toContain('env');
    expect(res.body).toContain('NODE_ENV');
  });

  it('the shim is idempotent / non-destructive (guards before assigning)', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await get(proxy.port ?? 0, '/__hypercanvas/process-shim.js');
    // Only define when absent — never clobber a real `process` an SSR shell provides.
    expect(res.body).toContain("typeof g.process === 'undefined'");
    expect(res.body).toContain("typeof g.process.env.NODE_ENV === 'undefined'");
  });
});

/**
 * /test-preview retry-exhaustion warning (HYP-903/HYP-914).
 *
 * Exercises the REAL wiring end-to-end (not just the pure predicate/builder unit tests in
 * PreviewAssetResponses.test.ts): an upstream that never serves /test-preview (matching the
 * live-verified conloca cms-spa topology — `Bun.serve({ routes: { '/': index } })`, 404 with
 * an empty body) must, after the retry budget is exhausted, get an explicit 200 HTML warning
 * through the proxy instead of the raw empty pass-through.
 *
 * The real backoff sums to ~46s (16 retries, non-Remix) — too slow for a unit test. Fast-
 * forward it by capping every setTimeout delay at 1ms; this preserves the exact retry COUNT
 * and control flow (same recursion depth, same terminal branch) while collapsing wall-clock
 * time to milliseconds. Restored in afterEach so it can't leak into other test files.
 */
describe('PreviewProxy /test-preview retry exhaustion (HYP-903/HYP-914)', () => {
  let upstream: { port: number; close: () => Promise<void> };
  let proxy: InstanceType<typeof PreviewProxy>;
  let realSetTimeout: typeof setTimeout;

  beforeEach(async () => {
    upstream = await startUpstream();
    realSetTimeout = globalThis.setTimeout;
    // Forward extra args unchanged (Bun's own internals, e.g. http.Server.listen's
    // nextTick-style emit, schedule setTimeout(fn, delay, ...extraArgsForFn) — dropping
    // them breaks unrelated Bun-internal callbacks, not just PreviewProxy's own retries).
    // @ts-expect-error -- deliberately narrowed signature for this test's own retry calls only
    globalThis.setTimeout = (fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
      realSetTimeout(fn, Math.min(delay ?? 0, 1), ...args);
  });

  afterEach(async () => {
    globalThis.setTimeout = realSetTimeout;
    proxy?.stop();
    await upstream.close();
  });

  it('serves the explicit warning page once retries are exhausted, not the raw empty 404', async () => {
    // Replace the default-200 marker upstream with one shaped like cms-spa's real Bun dev
    // server: /test-preview 404s with an empty body, everything else (root) serves 200 HTML.
    await upstream.close();
    upstream = await startUpstream((req, res) => {
      if ((req.url ?? '').startsWith('/test-preview')) {
        res.writeHead(404, { 'content-length': '0' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>root</body></html>');
    });

    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await get(proxy.port ?? 0, '/test-preview?component=src%2Fcomponents%2Fui%2FButton.tsx');
    expect(res.status).toBe(200);
    expect(res.body).toContain("HyperCanvas can't reach this preview route");
    expect(res.body).toContain(`localhost:${upstream.port}`);
    expect(res.body).toContain('404');
  }, 10_000);
});
