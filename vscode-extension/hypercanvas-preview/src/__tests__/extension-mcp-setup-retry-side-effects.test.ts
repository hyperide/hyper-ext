/**
 * @file HYP-954 review (round 2) — Codex P3: proves `setupMcpServer()`'s wiring of
 * `server.onStarted(...)` to `handleMcpServerStarted()` actually fires config
 * auto-update / Copilot MCP registration on a SUCCESSFUL RETRY after activation's
 * OWN attempt failed — not just that `HyperMcpServer.onStarted()` itself fires
 * (already covered by HyperMcpServer-ensure-started.test.ts's "fires on every
 * successful transition" case, which doesn't touch extension-mcp-setup.ts at all).
 * Without this, a drift in the `server.onStarted(...)` registration line or in
 * `handleMcpServerStarted()` could silently regress while every other lifecycle
 * test stays green.
 *
 * Mocks `../services/netProbe`'s `listenLoopback` (controllable per-call, same
 * technique as HyperMcpServer-ensure-started.test.ts) and
 * `../extension-commands-utils`'s `autoUpdateMcpConfigs`/`registerCopilotMcp` so
 * this file can assert they run with the RETRY's port, not just activation's.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

type BindImpl = () => Promise<number>;
let currentBindImpl: BindImpl = () => Promise.reject(new Error('listen EACCES: permission denied 127.0.0.1:0'));

mock.module('../services/netProbe', () => ({
  listenLoopback: () => currentBindImpl(),
}));

const autoUpdateMcpConfigs = mock(() => Promise.resolve());
const registerCopilotMcp = mock(() => {});

mock.module('../extension-commands-utils', () => ({
  autoUpdateMcpConfigs,
  registerCopilotMcp,
}));

// Imported AFTER the mock.module calls so extension-mcp-setup picks up the mocks.
const { setupMcpServer } = await import('../extension-mcp-setup');
import type { PanelRouter } from '../PanelRouter';
import type { StateHub } from '../StateHub';
import type { DiagnosticHub } from '../DiagnosticHub';

function makeFakePanelRouter(): PanelRouter {
  return {
    astBridge: { astService: {} },
    componentService: {},
    // HYP-984 review round 2: `setupMcpServer()` no longer takes a `workspaceRoot` constructor
    // argument — it reads `panelRouter.workspaceRoot` live — so a fake PanelRouter must implement
    // it like the real one does. `autoUpdateMcpConfigs` below is asserted against this value.
    workspaceRoot: '/test-workspace',
  } as unknown as PanelRouter;
}

function makeFakeContext(): import('vscode').ExtensionContext {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: { get: () => false, update: () => Promise.resolve() },
  } as unknown as import('vscode').ExtensionContext;
}

describe('setupMcpServer() — retry-success side effects (HYP-954 review P3)', () => {
  let disposeServer: (() => void) | null = null;

  afterEach(() => {
    disposeServer?.();
    disposeServer = null;
    // Reset shared module-level mock state (review round 4) — only one test uses these today,
    // but leaving them dirty makes call-count assertions order-dependent the moment a sibling
    // test is added to this file.
    autoUpdateMcpConfigs.mockClear();
    registerCopilotMcp.mockClear();
    currentBindImpl = () => Promise.reject(new Error('listen EACCES: permission denied 127.0.0.1:0'));
  });

  it('fires config auto-update / Copilot registration on a successful Retry after activation failed', async () => {
    const fakeContext = makeFakeContext();

    const server = setupMcpServer(
      fakeContext,
      makeFakePanelRouter(),
      {} as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();

    // Let activation's own eager ensureStarted() attempt settle (it rejects).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdateMcpConfigs).not.toHaveBeenCalled();
    expect(registerCopilotMcp).not.toHaveBeenCalled();

    // Simulate the user pressing Retry: a LATER successful ensureStarted() call,
    // exactly what hypercanvas.setupMcp does (extension-commands.ts).
    currentBindImpl = () => Promise.resolve(7654);
    await server.ensureStarted();

    expect(autoUpdateMcpConfigs).toHaveBeenCalledWith('/test-workspace', server.url);
    expect(registerCopilotMcp).toHaveBeenCalledWith(fakeContext, server.url);
  });
});
