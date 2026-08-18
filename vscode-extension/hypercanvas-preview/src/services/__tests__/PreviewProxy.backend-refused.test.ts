import { describe, expect, it, mock } from 'bun:test';
import * as http from 'node:http';

/**
 * PreviewProxy backend-refused notification (HYP-1185).
 *
 * Live-wedged-container evidence (hyper-e2e-wedge-r1-s1): the proxy listened and
 * answered, but its backend vite port was dead — every GET burned the 5-retry
 * socket-error ladder (~4.5s) and then 502'd, FOREVER, while DevServerManager
 * kept reporting `running`. The proxy must surface a terminal ECONNREFUSED to
 * its owner so the manager can restart with a fresh dev server instead of
 * proxying a dead port forever.
 *
 * PreviewProxy reads the pre-built iframe scripts via fs.readFileSync at import
 * time; those .js files only exist next to the bundled output, not in src/.
 * Stub readFileSync for them so the real class can be imported (same pattern as
 * PreviewProxy.serving.test.ts).
 */
const realFs = await import('node:fs');
// Capture the ORIGINAL readFileSync before mock.module mutates the node:fs
// namespace in place — calling realFs.readFileSync inside the factory would
// resolve to the MOCKED function and recurse forever on any non-iframe read
// (same hazard DevServerManager.test.ts documents).
const origReadFileSync = realFs.readFileSync;
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return origReadFileSync(file as string, enc as never);
  },
}));

const { PreviewProxy } = await import('../PreviewProxy');

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

/** Bind a port and give it back — a guaranteed-dead backend (ECONNREFUSED). */
function reserveDeadPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no address'));
      });
    });
  });
}

describe('PreviewProxy backend-refused notification (HYP-1185)', () => {
  it('fires onBackendRefused once the GET retry ladder is exhausted against a dead backend', async () => {
    const deadPort = await reserveDeadPort();
    const proxy = new PreviewProxy(deadPort);
    let refusedCount = 0;
    proxy.setOnBackendRefused(() => {
      refusedCount += 1;
    });
    await proxy.start();
    try {
      const res = await get(proxy.port ?? 0, '/test-preview?component=src%2FApp.tsx');
      expect(res.status).toBe(502);
      expect(refusedCount).toBe(1);
    } finally {
      proxy.stop();
    }
  }, 20_000); // The socket-error ladder waits 300+600+900+1200+1500ms ≈ 4.5s before the terminal 502.

  it('does NOT fire onBackendRefused when the backend answers', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('OK');
    });
    await new Promise<void>((resolve) => upstream.listen(0, 'localhost', resolve));
    const addr = upstream.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    const proxy = new PreviewProxy(port);
    let refusedCount = 0;
    proxy.setOnBackendRefused(() => {
      refusedCount += 1;
    });
    await proxy.start();
    try {
      const res = await get(proxy.port ?? 0, '/asset.js');
      expect(res.status).toBe(200);
      expect(refusedCount).toBe(0);
    } finally {
      proxy.stop();
      upstream.close();
    }
  });

  it('does NOT fire onBackendRefused for a non-GET request (no ladder absorption — transient refusals must not trigger recovery)', async () => {
    const deadPort = await reserveDeadPort();
    const proxy = new PreviewProxy(deadPort);
    let refusedCount = 0;
    proxy.setOnBackendRefused(() => {
      refusedCount += 1;
    });
    await proxy.start();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: 'localhost', port: proxy.port ?? 0, path: '/save', method: 'POST' },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(status).toBe(502);
      expect(refusedCount).toBe(0);
    } finally {
      proxy.stop();
    }
  }, 20_000);

  it('reaches a backend that bound IPv6-only ::1 (localhost family mismatch — the r7 wedge root cause)', async () => {
    // bun-spawned vite binds 'localhost' to ::1 ONLY (its resolver picks IPv6
    // first); the extension-host's Node resolves 'localhost' to 127.0.0.1 and
    // gets ECONNREFUSED forever — the proxy must try both loopback families.
    // Verified live in docker r7: curl 127.0.0.1:11100 → refused while
    // [::1]:11100 → 200. NOTE: this test cannot go RED under bun (bun's own
    // HTTP stack is already dual-family); it locks the contract for the
    // Electron/Node extension-host runtime, where autoSelectFamily is what
    // provides the guarantee.
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('IPV6_UPSTREAM_OK');
    });
    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once('error', reject);
        upstream.listen(0, '::1', resolve);
      });
    } catch {
      // Host without IPv6 — nothing to verify here.
      return;
    }
    const addr = upstream.address();
    const port = addr && typeof addr === 'object' ? addr.port : 0;
    const proxy = new PreviewProxy(port);
    let refusedCount = 0;
    proxy.setOnBackendRefused(() => {
      refusedCount += 1;
    });
    await proxy.start();
    try {
      const res = await get(proxy.port ?? 0, '/asset.js');
      expect(res.status).toBe(200);
      expect(res.body).toBe('IPV6_UPSTREAM_OK');
      expect(refusedCount).toBe(0);
    } finally {
      proxy.stop();
      upstream.close();
    }
  });

  it('recovers when the backend re-binds on the OTHER loopback family (stale family cache invalidated)', async () => {
    const serveOn = (host: string, body: string, port = 0) =>
      new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
        const server = http.createServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end(body);
        });
        server.once('error', reject);
        server.listen(port, host, () => {
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            resolve({
              port: addr.port,
              close: () => new Promise<void>((res) => server.close(() => res())),
            });
          } else {
            reject(new Error('no address'));
          }
        });
      });

    // Phase 1: IPv4-only backend — the proxy caches 127.0.0.1.
    const v4 = await serveOn('127.0.0.1', 'V4_OK');
    const proxy = new PreviewProxy(v4.port);
    await proxy.start();
    const first = await get(proxy.port ?? 0, '/asset.js');
    expect(first.body).toBe('V4_OK');
    await v4.close();

    // Phase 2: the backend comes back IPv6-ONLY on the same port. The first
    // attempt hits the stale cached family (refused → invalidate), the ladder
    // retry re-probes both literals and finds ::1.
    let v6: { port: number; close: () => Promise<void> };
    try {
      v6 = await serveOn('::1', 'V6_OK', v4.port);
    } catch {
      // Host without IPv6 — nothing more to verify here.
      proxy.stop();
      return;
    }
    try {
      const second = await get(proxy.port ?? 0, '/asset.js');
      expect(second.status).toBe(200);
      expect(second.body).toBe('V6_OK');
    } finally {
      proxy.stop();
      await v6.close();
    }
  }, 20_000);

  it('tolerates a missing callback (back-compat: a bare proxy still just 502s)', async () => {
    const deadPort = await reserveDeadPort();
    const proxy = new PreviewProxy(deadPort);
    await proxy.start();
    try {
      const res = await get(proxy.port ?? 0, '/');
      expect(res.status).toBe(502);
    } finally {
      proxy.stop();
    }
  }, 20_000);
});
