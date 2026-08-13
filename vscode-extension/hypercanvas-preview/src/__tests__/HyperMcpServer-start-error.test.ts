/**
 * @file HYP-953 — HyperMcpServer.start() failures used to be silent: the only handling was
 * `.catch((err) => console.error(...))` in extension-mcp-setup.ts, which reaches the
 * Extension Host log only (invisible to a user). A partner in Cursor hit "HyperCanvas MCP
 * server is not running" on Setup AI Agents with zero diagnostic info, because a genuine
 * start() rejection (loopback bind refused by a local firewall/AV/sandbox, port exhaustion,
 * etc.) was indistinguishable from "still starting" — both just leave `port` at 0.
 *
 * Fix: HyperMcpServer now records the rejection reason on `startError` (mcp/HyperMcpServer.ts)
 * so both the startup .catch() (immediate toast) and the `hypercanvas.setupMcp` guard
 * (extension-commands.ts, covered by setup-mcp-live-getter.test.ts) can surface it.
 *
 * This file mocks `../services/netProbe`'s `listenLoopback` to force a rejection — start()
 * can't be made to fail via a real bind conflict because it always requests an OS-assigned
 * ephemeral port (`listenLoopback(httpServer, 0)`), so there's no fixed port to pre-occupy.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

const BIND_ERROR = new Error('listen EACCES: permission denied 127.0.0.1:0');

mock.module('../services/netProbe', () => ({
  listenLoopback: () => Promise.reject(BIND_ERROR),
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

describe('HyperMcpServer.start() — startError surfacing (HYP-953)', () => {
  let server: InstanceType<typeof HyperMcpServer>;

  afterEach(() => {
    server?.dispose();
  });

  it('rejects and records the failure reason on startError', async () => {
    server = new HyperMcpServer(createMinimalServices());

    expect(server.startError).toBeNull();
    await expect(server.start()).rejects.toThrow(BIND_ERROR.message);

    expect(server.port).toBe(0);
    expect(server.startError).toBe(BIND_ERROR.message);
  });
});
