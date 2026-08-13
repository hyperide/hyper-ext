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

/** Minimal upstream "dev server" that always answers 200 with a marker body. */
function startUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('UPSTREAM_OK');
    });
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
