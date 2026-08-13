import { afterEach, describe, expect, it } from 'bun:test';
import * as net from 'node:net';
import { findFreePort, probeOpen } from '../netProbe';

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
