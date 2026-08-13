import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as http from 'node:http';
import * as net from 'node:net';

/**
 * @file HYP-903 regression: PreviewProxy root-route fallback for catch-all-less dev servers.
 *
 * cms-spa-shaped dev servers (`Bun.serve({ routes: { '/': index } })`) serve ONLY their
 * root path — `/test-preview` 404s FOREVER there, not from the FSWatch lag the retry
 * loop in PreviewProxy._handleHttp exists to ride out. Before this fix, that dead-end
 * 404 exhausted the retry budget and the iframe stayed blank with no real content ever
 * reaching it. `shouldFallbackToRootRoute` (PreviewAssetResponses.ts) gates a single
 * extra upstream request against `/` once the budget is exhausted; this file proves the
 * PreviewProxy wiring actually takes that branch and serves the root HTML through the
 * normal script-injection pipeline.
 *
 * Same fs stub as PreviewProxy.serving.test.ts (pre-built iframe scripts are read via
 * fs.readFileSync at import time; only that file needs stubbing).
 *
 * testPreviewRetryBudget is mocked to 0 so the fallback fires on the FIRST 404 instead
 * of waiting through the real ~46s retry loop — this test asserts the fallback branch
 * itself, not the (separately-tested) backoff timing.
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

const realAssetResponses = await import('../PreviewAssetResponses');
mock.module('../PreviewAssetResponses', () => ({
  ...realAssetResponses,
  testPreviewRetryBudget: () => 0,
}));

const { PreviewProxy } = await import('../PreviewProxy');

const ROOT_HTML =
  '<html><head></head><body>ROOT_HTML_MARKER<script type="module" src="./dev-entry.tsx"></script></body></html>';

/** Mimics a Bun.serve({ routes: { '/': index } }) dev server: serves ONLY '/'. */
function startServeAtRootUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(ROOT_HTML);
        return;
      }
      // No catch-all/SPA-fallback route — every other path 404s with an empty body,
      // exactly like cms-spa's dev-server.tsx.
      res.writeHead(404);
      res.end();
    });
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () => new Promise<void>((res) => server.close(() => res())),
        });
      } else {
        reject(new Error('no upstream address'));
      }
    });
  });
}

/**
 * Same serve-at-root shape as startServeAtRootUpstream, but the FIRST request to `/`
 * gets its socket destroyed with no response (simulating the ECONNRESET path in
 * PreviewProxy's socket-error retry branch) — every subsequent `/` request succeeds.
 * Used to prove `rootFallbackAttempted` survives a retry that isn't the root-fallback
 * branch itself: dropping it on the socket-error recursive call would make that retry
 * revert to querying the original (permanently-404ing) /test-preview path instead of
 * continuing to retry `/`.
 */
function startFlakyRootUpstream(): Promise<{
  port: number;
  close: () => Promise<void>;
  hitsByPathname: () => Record<string, number>;
}> {
  return new Promise((resolve, reject) => {
    const hits: Record<string, number> = {};
    let rootRequestCount = 0;
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      hits[pathname] = (hits[pathname] ?? 0) + 1;
      if (pathname === '/') {
        rootRequestCount += 1;
        if (rootRequestCount === 1) {
          req.socket.destroy();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(ROOT_HTML);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.once('error', reject);
    server.listen(0, 'localhost', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () => new Promise<void>((res) => server.close(() => res())),
          hitsByPathname: () => ({ ...hits }),
        });
      } else {
        reject(new Error('no upstream address'));
      }
    });
  });
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
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

/**
 * Raw-socket GET for HTML responses only (bypasses Node/Bun's http client header
 * parser). PreviewProxy forces `transfer-encoding: chunked` on every HTML response it
 * injects scripts into (see PreviewProxy.ts's content-length/content-encoding delete),
 * which Bun's test-runtime HTTP client parser rejects with HPE_INVALID_HEADER_TOKEN —
 * a Bun-test-runtime parser quirk, not a real client issue (Chromium/Node accept it
 * fine; see PreviewProxy.serving.test.ts's process-shim suite for the same caveat).
 * Reads the raw response bytes directly off the socket instead of parsing HTTP framing.
 *
 * Completion: the chunked terminator ("0\r\n\r\n") is checked as a fast path, but in
 * practice Node's http server here doesn't close the socket on "Connection: close" from
 * the client while the response is chunked, and the terminator bytes can arrive split
 * across 'data' events — so the primary signal is an IDLE window (no new bytes for
 * IDLE_MS): once the response stops producing data, treat it as complete. This resolves
 * as soon as the response actually finishes instead of always waiting a fixed delay, and
 * — unlike a single fixed timeout — never truncates a response that's still arriving.
 * MAX_WAIT_MS is a deadlock backstop only, not the expected completion path.
 */
const RAW_GET_IDLE_MS = 200;
const RAW_GET_MAX_WAIT_MS = 10_000;
function rawGetHtml(port: number, path: string): Promise<{ statusLine: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, 'localhost', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    const raw = () => Buffer.concat(chunks).toString('utf-8');
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const maxWaitTimer = setTimeout(finish, RAW_GET_MAX_WAIT_MS);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(maxWaitTimer);
      socket.destroy();
      resolve({ statusLine: raw().split('\r\n', 1)[0] ?? '', raw: raw() });
    }
    socket.on('data', (c: Buffer) => {
      chunks.push(c);
      if (raw().includes('\r\n0\r\n\r\n')) {
        finish();
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, RAW_GET_IDLE_MS);
    });
    socket.on('end', finish);
    socket.on('error', reject);
  });
}

describe('PreviewProxy root-route fallback (HYP-903)', () => {
  let upstream: { port: number; close: () => Promise<void> };
  let proxy: InstanceType<typeof PreviewProxy>;

  beforeEach(async () => {
    upstream = await startServeAtRootUpstream();
  });

  afterEach(async () => {
    proxy?.stop();
    await upstream.close();
  });

  it('falls back to the dev server root instead of exhausting to a blank/empty response', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await rawGetHtml(proxy.port ?? 0, '/test-preview?component=src%2FApp.tsx');

    expect(res.statusLine).toContain('200');
    expect(res.raw).toContain('ROOT_HTML_MARKER');
  });

  it('still runs the normal HTML pipeline (script injection) on the fallback content', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await rawGetHtml(proxy.port ?? 0, '/test-preview?component=src%2FApp.tsx');

    expect(res.raw).toContain('data-hyper-inject="interaction"');
    expect(res.raw).toContain('data-hyper-inject="process-shim"');
  });

  it('a genuinely missing (non-/test-preview) path still 404s — the fallback is scoped', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await get(proxy.port ?? 0, '/some/other/missing/path.js');
    expect(res.status).toBe(404);
  });
});

describe('PreviewProxy root-route fallback survives a retry on the fallback request itself', () => {
  // Regression for a review finding: the socket-error / 504 retry branches' recursive
  // _handleHttp calls used to omit the rootFallbackAttempted argument, silently resetting
  // it to false. Once already fallen back to `/`, a transient socket error on THAT request
  // must retry `/` again — not revert to the original, permanently-404ing /test-preview path.
  let upstream: Awaited<ReturnType<typeof startFlakyRootUpstream>>;
  let proxy: InstanceType<typeof PreviewProxy>;

  beforeEach(async () => {
    upstream = await startFlakyRootUpstream();
  });

  afterEach(async () => {
    proxy?.stop();
    await upstream.close();
  });

  it('retries `/` again after a socket error on the fallback request, not the original path', async () => {
    proxy = new PreviewProxy(upstream.port);
    proxy.setIsServing(() => true);
    await proxy.start();

    const res = await rawGetHtml(proxy.port ?? 0, '/test-preview?component=src%2FApp.tsx');

    expect(res.statusLine).toContain('200');
    expect(res.raw).toContain('ROOT_HTML_MARKER');
    const hits = upstream.hitsByPathname();
    // /test-preview hit exactly once (the initial request that triggers the fallback) —
    // if rootFallbackAttempted were dropped on the socket-error retry, it would be hit
    // a second time instead of `/` being retried.
    expect(hits['/test-preview']).toBe(1);
    expect(hits['/']).toBe(2);
  });
});
