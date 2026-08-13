/**
 * Shared, IPv6-aware network-probe utility.
 *
 * Accessed via: the preview stack's port selection and liveness checks —
 * DevServerManager (free-port search, server-ready poll), PreviewProxy (proxy
 * listen socket), and HyperMcpServer (MCP listen socket).
 *
 * Assumptions (architectural invariants):
 * - "localhost" is non-deterministic: modern systems resolve it to ::1 (IPv6)
 *   or 127.0.0.1 (IPv4) depending on /etc/hosts and resolver order. Vite /
 *   Next.js / webpack-dev-server bind to whichever the OS hands them, so an
 *   outbound PROBE that hardcodes a single family disagrees with the server on
 *   an IPv6-only (or IPv4-only) bind. That disagreement was the original bug:
 *   _findFreePort bound 127.0.0.1 while _isPortOpen connected to 'localhost'.
 *   The fix lives in probeOpen: it connects to BOTH loopback families.
 * - The fix is in the PROBE, not the BIND. Our own serving sockets (MCP proxy,
 *   preview proxy) must stay loopback-only — a hostless `listen()` binds the
 *   unspecified address (0.0.0.0 + ::) and would expose them to the LAN. Node
 *   also has no single-socket loopback-dual-stack bind (listen() with a
 *   hostname binds only the first resolved address), so each consumer keeps its
 *   original loopback bind host (127.0.0.1 for MCP, 'localhost' for the proxy)
 *   via listenLoopback; consolidation here is the shared address-extraction
 *   plumbing, not a shared bind surface.
 */
import * as net from 'node:net';

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;
const PROBE_TIMEOUT_MS = 1000;

/**
 * Probe whether a port is accepting TCP connections on loopback. Connects to
 * both IPv4 (127.0.0.1) and IPv6 (::1) loopback in parallel and resolves true
 * on the first success; resolves false only after BOTH families fail. This is
 * what lets the probe agree with a server bound to either family.
 */
export function probeOpen(port: number): Promise<boolean> {
  const connectOne = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;
      const finish = (open: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
      socket.connect(port, host);
    });

  return Promise.all(LOOPBACK_HOSTS.map(connectOne)).then((results) => results.some(Boolean));
}

/**
 * Listen on a loopback host and resolve the bound port. Shared address-
 * extraction plumbing for the MCP proxy and preview proxy; `host` defaults to
 * the IPv4 loopback. Binds ONLY the given loopback host — never the unspecified
 * address — so the server is not reachable from non-local interfaces.
 * `port` of 0 picks a free ephemeral port.
 */
export function listenLoopback(server: net.Server, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
  });
}

/**
 * Find a free port at or after startPort. A port counts as free only if it
 * both (a) binds on loopback and (b) probeOpen finds nobody answering on either
 * loopback family. The dual-family probe is what makes free-port selection
 * agree with a dev server bound to ::1: a 127.0.0.1 bind can succeed on a port
 * already held by an IPv6-only listener, so bind alone would hand out an
 * occupied port — the family disagreement this util exists to remove.
 */
export function findFreePort(startPort: number): Promise<number> {
  const isBindable = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });

  return (async () => {
    let port = startPort;
    while (!((await isBindable(port)) && !(await probeOpen(port)))) {
      port++;
      if (port > startPort + 100) {
        throw new Error('Could not find free port');
      }
    }
    return port;
  })();
}
