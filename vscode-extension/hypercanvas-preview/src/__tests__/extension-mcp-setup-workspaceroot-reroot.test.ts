/**
 * @file HYP-984 regression test — MCP config auto-update targeted the STALE `workspaceRoot`
 * after a workspace reroot, the same bug class as the AstService/ComponentService staleness
 * covered by extension-mcp-setup-workspace-reroot.test.ts (surfaced independently by both
 * review-cli seats on that fix's own diff).
 *
 * Bug: `setupMcpServer()` (extension-mcp-setup.ts) is called exactly ONCE, at activation
 * (extension.ts). It used to capture the `workspaceRoot: string` constructor argument into a
 * closure and hand that same frozen string to `handleMcpServerStarted()` on every subsequent
 * `server.onStarted(...)` fire — including a `hypercanvas.setupMcp` Retry that succeeds AFTER a
 * `PanelRouter._ensureCurrentWorkspace()` reroot. `handleMcpServerStarted()` calls
 * `autoUpdateMcpConfigs(workspaceRoot, server.url)`, which writes `.mcp.json`, `.vscode/mcp.json`,
 * `opencode.json`, and `.codex/config.toml` — all of that would keep landing in the OLD
 * workspace's directory tree forever, even though the MCP server itself now correctly serves the
 * NEW workspace's AstService/ComponentService.
 *
 * Fix: `setupMcpServer()` no longer takes a `workspaceRoot: string` constructor argument at all —
 * both the `HyperMcpServices.workspaceRoot` live getter and `handleMcpServerStarted()` now read
 * `panelRouter.workspaceRoot` directly (PanelRouter's own live getter, re-derived from
 * `vscode.workspace.workspaceFolders` on every access), so the config-write path reads the
 * CURRENT root at the moment a start actually fires, not a value captured at setup time.
 *
 * Uses the same `mock.module` technique as extension-mcp-setup-retry-side-effects.test.ts
 * (HYP-954 review P3) to make `autoUpdateMcpConfigs`'s argument observable, plus a fake
 * PanelRouter whose `workspaceRoot` getter can be flipped mid-test to simulate a reroot.
 *
 * `mock.module()` patches the shared module registry, not a per-file registry — safe here only
 * because this package's test command is `bun test --isolate src/` (package.json), which runs
 * each test FILE in its own isolated process/registry. Running this file with a bare `bun test`
 * (no `--isolate`) risks leaking the `netProbe`/`extension-commands-utils` mocks into other files
 * executed in the same process — always use the package script, not an ad hoc `bun test <path>`.
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

/** Fake PanelRouter with a MUTABLE `workspaceRoot` — a test can flip it mid-run to simulate
 *  `PanelRouter._ensureCurrentWorkspace()` rerooting to a new folder. */
function makeFakePanelRouter(initialRoot: string): PanelRouter & { workspaceRoot: string } {
  return {
    astBridge: { astService: {} },
    componentService: {},
    workspaceRoot: initialRoot,
  } as unknown as PanelRouter & { workspaceRoot: string };
}

function makeFakeContext(): import('vscode').ExtensionContext {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: { get: () => false, update: () => Promise.resolve() },
  } as unknown as import('vscode').ExtensionContext;
}

describe('setupMcpServer() — workspaceRoot config-write follows a live PanelRouter root across a reroot (HYP-984)', () => {
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

  it('a post-reroot setupMcp Retry writes MCP configs to the NEW workspace root, not the activation-time root', async () => {
    const fakeContext = makeFakeContext();
    const fakePanelRouter = makeFakePanelRouter('/test-workspace-old');

    const server = setupMcpServer(
      fakeContext,
      fakePanelRouter,
      {} as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();

    // Let activation's own eager ensureStarted() attempt settle (it rejects — bind refused).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdateMcpConfigs).not.toHaveBeenCalled();

    // Simulate PanelRouter._ensureCurrentWorkspace() rerooting to a NEW folder, THEN the user
    // pressing Retry (hypercanvas.setupMcp) — a later successful ensureStarted() call.
    fakePanelRouter.workspaceRoot = '/test-workspace-new';
    currentBindImpl = () => Promise.resolve(7654);
    await server.ensureStarted();

    // The config-write must target the NEW root read live from panelRouter, not the
    // '/test-workspace-old' string captured at setupMcpServer()'s own call time.
    expect(autoUpdateMcpConfigs).toHaveBeenCalledWith('/test-workspace-new', server.url);
    expect(autoUpdateMcpConfigs).not.toHaveBeenCalledWith('/test-workspace-old', server.url);
  });
});
