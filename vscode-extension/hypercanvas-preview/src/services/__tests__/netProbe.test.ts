import { afterEach, describe, expect, it } from 'bun:test';
import * as http from 'node:http';
import * as net from 'node:net';
import { findFreePort, probeHttp, probeOpen } from '../netProbe';

/**
 * Open a listening server bound to a specific host and resolve once it is
 * accepting connections. Returns the chosen port and a close() helper.
 */
function listenOn(host: string): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({ port: addr.port, close: () => server.close() });
      } else {
        reject(new Error('no address'));
      }
    });
  });
}

describe('netProbe', () => {
  const closers: Array<() => void> = [];

  afterEach(() => {
    while (closers.length) closers.pop()?.();
  });

  describe('probeOpen', () => {
    it('returns true for a server bound to 127.0.0.1 (IPv4)', async () => {
      const s = await listenOn('127.0.0.1');
      closers.push(s.close);
      expect(await probeOpen(s.port)).toBe(true);
    });

    it('returns true for a server bound to ::1 (IPv6-only)', async () => {
      // This is the bug the util exists to fix: a 127.0.0.1-only probe is
      // blind to an IPv6-only bind, so it must check both families.
      const s = await listenOn('::1');
      closers.push(s.close);
      expect(await probeOpen(s.port)).toBe(true);
    });

    it('returns false for a port nobody is listening on', async () => {
      // Grab a free port via the util, then probe it while closed.
      const port = await findFreePort(49500);
      expect(await probeOpen(port)).toBe(false);
    });
  });

  describe('probeHttp', () => {
    it('resolves true on the FIRST HTTP response even when the other family hangs (PR #692 review)', async () => {
      // A blackhole on ::1 — accepts TCP but never speaks HTTP — stands in for a
      // hung family that neither answers nor errors until the probe timeout.
      // The IPv4 HTTP server answers immediately; the probe must return true
      // from that first response, not wait out the ::1 timeout (Promise.all did).
      const httpServer = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      const { promise: httpListening, resolve: httpReady, reject: httpFailed } = Promise.withResolvers<void>();
      httpServer.once('error', httpFailed);
      httpServer.listen(0, '127.0.0.1', httpReady);
      await httpListening;
      closers.push(() => httpServer.close());
      const httpAddr = httpServer.address();
      if (!httpAddr || typeof httpAddr !== 'object') throw new Error('no address');
      const port = httpAddr.port;

      const hungSockets: net.Socket[] = [];
      const blackhole = net.createServer((socket) => {
        hungSockets.push(socket); // hold the connection open, never respond
      });
      const { promise: bhListening, resolve: bhReady, reject: bhFailed } = Promise.withResolvers<void>();
      blackhole.once('error', bhFailed);
      blackhole.listen(port, '::1', bhReady);
      await bhListening;
      closers.push(() => {
        for (const socket of hungSockets) socket.destroy();
        blackhole.close();
      });

      const start = Date.now();
      expect(await probeHttp(port)).toBe(true);
      // Well under the 1s probe timeout the ::1 blackhole would otherwise cost.
      expect(Date.now() - start).toBeLessThan(800);
    });

    it('resolves false only after BOTH families fail', async () => {
      const port = await findFreePort(49700);
      expect(await probeHttp(port)).toBe(false);
    });
  });

  describe('findFreePort', () => {
    it('returns a port that probeOpen agrees is free, via the same path', async () => {
      const port = await findFreePort(49600);
      expect(port).toBeGreaterThanOrEqual(49600);
      expect(await probeOpen(port)).toBe(false);
    });

    it('skips a port occupied by an IPv6-only server (same path as probe)', async () => {
      // findFreePort must bind on the same surface probeOpen connects to,
      // otherwise it hands out a port already taken on ::1.
      const s = await listenOn('::1');
      closers.push(s.close);
      const occupied = s.port;
      const free = await findFreePort(occupied);
      expect(free).not.toBe(occupied);
      expect(await probeOpen(occupied)).toBe(true);
    });
  });
});
