/**
 * @file HYP-984 regression test — MCP held a stale AstService/ComponentService after a
 * workspace reroot.
 *
 * Bug: `setupMcpServer()` (extension-mcp-setup.ts) used to snapshot
 * `panelRouter.astBridge.astService` / `panelRouter.componentService` into local `const`s ONCE,
 * at MCP-server setup time, and hand those by-value references into `HyperMcpServer`.
 * `PanelRouter._ensureCurrentWorkspace()` (PanelRouter.ts) REPLACES `_astBridge` (and
 * `_componentService`) wholesale on a workspace reroot — the getters `panelRouter.astBridge` /
 * `panelRouter.componentService` reflect the new instances, but the frozen snapshot inside
 * `HyperMcpServer`'s services object kept pointing at the OLD workspace's services forever.
 * Every MCP tool call after a reroot (e.g. from Claude/Copilot/Codex talking to the loopback
 * MCP server) would silently keep mutating the PREVIOUS workspace's files and files under the
 * PREVIOUS workspace's AstService/ComponentService.
 *
 * Fix: `setupMcpServer()` now hands `HyperMcpServer` `get astService()` / `get componentService()`
 * accessors that read `panelRouter.astBridge.astService` / `panelRouter.componentService` LIVE,
 * on every access — matching how `HyperMcpServer._createMcpServer()` already re-reads
 * `this._services.astService` on every incoming MCP request (stateless mode: a new McpServer +
 * tool registration per request), so the getter closes the loop all the way to the wire.
 *
 * This test drives a REAL HyperMcpServer over HTTP (not a mocked transport) through two tool
 * calls each (`hyper_insert_element`, `hyper_get_component_tree`): once before a simulated
 * reroot, once after, against a fake PanelRouter whose `astBridge`/`componentService` are swapped
 * exactly like `_ensureCurrentWorkspace()` swaps them. It asserts the post-reroot calls reach the
 * NEW AstService/ComponentService (not the old ones) via the actual JSON-RPC response, not just
 * the mock's call count.
 *
 * Mocks `../extension-commands-utils` (same technique as
 * extension-mcp-setup-retry-side-effects.test.ts, HYP-954 review P3): `server.ensureStarted()`
 * here binds a REAL loopback socket and fires `onStarted` → `handleMcpServerStarted()` for real,
 * which would otherwise call the REAL `autoUpdateMcpConfigs('/test-workspace-old', …)` — writing
 * `.mcp.json` / `.vscode/mcp.json` / `opencode.json` / `.codex/config.toml` under a nonexistent
 * absolute path at filesystem root (review round 2 finding). Mocking it keeps this test scoped to
 * the AstService/ComponentService routing it actually exercises.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

// Named + hoisted (review finding) so `afterEach` below can reset them — an inline factory
// passed straight to `mock.module` leaves the mock fns unreachable outside that call, so a
// sibling test added later would inherit this file's call-count state instead of starting clean.
const autoUpdateMcpConfigs = mock(() => Promise.resolve());
const registerCopilotMcp = mock(() => {});

mock.module('../extension-commands-utils', () => ({
  autoUpdateMcpConfigs,
  registerCopilotMcp,
}));

// Imported AFTER the mock.module call so extension-mcp-setup picks up the mock.
const { setupMcpServer } = await import('../extension-mcp-setup');
import type { HyperMcpServer } from '../mcp/HyperMcpServer';
import type { HyperMcpServices } from '../mcp/types';
import type { PanelRouter } from '../PanelRouter';
import type { AstService } from '../services/AstService';
import type { ComponentService } from '../services/ComponentService';
import type { StateHub } from '../StateHub';
import type { DiagnosticHub } from '../DiagnosticHub';

/** Minimal AstService stand-in: only `insertElement` (what `hyper_insert_element` calls).
 *  `hyper_insert_element`'s tool handler (ast-tools.ts) re-serializes the result down to
 *  `{ index }` only — an arbitrary `_servedBy` field would be silently dropped on the wire — so
 *  the distinguishing "which fake instance served this" signal has to ride the one field that DOES
 *  survive: `resultIndex`, forced to a distinct value per fake instance. */
function fakeAstService(resultIndex: number): AstService {
  return {
    insertElement: mock(() => Promise.resolve({ success: true, index: resultIndex })),
  } as unknown as AstService;
}

/** Minimal ComponentService stand-in: only `parseStructure` (what `hyper_get_component_tree`
 *  calls), tagged with a `_servedBy` marker in its result for the same reason as `fakeAstService`. */
function fakeComponentService(label: string): ComponentService {
  return {
    parseStructure: mock(() => Promise.resolve({ _servedBy: label })),
  } as unknown as ComponentService;
}

/** Fake PanelRouter shape: `astBridge`/`componentService`/`workspaceRoot` all reassignable
 *  post-construction — on the real class these are getters computed from private fields that
 *  `_ensureCurrentWorkspace()` replaces wholesale on a reroot, so a fake that can't be mutated the
 *  same way couldn't prove `setupMcpServer()` reads them live instead of snapshotting once. */
type FakePanelRouter = PanelRouter & {
  astBridge: { astService: AstService };
  componentService: ComponentService;
  workspaceRoot: string;
};

/** Stands in for PanelRouter, with mutable `astBridge`/`componentService` fields that a test can
 *  reassign wholesale — exactly what `PanelRouter._ensureCurrentWorkspace()` does to its private
 *  `_astBridge`/`_componentService` on a real workspace reroot (PanelRouter.ts `new AstBridge(...)`
 *  / `_createComponentService(...)` assignments). `setupMcpServer()` must read through these
 *  live, not snapshot them once. */
function makeFakePanelRouter(astService: AstService, componentService: ComponentService): FakePanelRouter {
  return {
    astBridge: { astService },
    componentService,
    // HYP-984 review round 2: production `setupMcpServer()` reads `panelRouter.workspaceRoot`
    // live (no fallback), so a fake PanelRouter must implement it. This test doesn't reroot the
    // workspace path itself, only the AstService/ComponentService, so the value never changes.
    workspaceRoot: '/test-workspace-old',
  } as unknown as FakePanelRouter;
}

function makeFakeContext(): import('vscode').ExtensionContext {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: { get: () => false, update: () => Promise.resolve() },
  } as unknown as import('vscode').ExtensionContext;
}

/**
 * The MCP HTTP transport wraps each JSON-RPC response in an SSE `data: ` frame, and
 * `tools/call` wraps the tool's own text payload one level deeper again
 * (`result.content[0].text`, itself a JSON string for `hyper_insert_element` /
 * `hyper_get_component_tree`). Parse all the way down to that inner JSON so assertions compare
 * real structured values instead of matching brittle, easy-to-miscount escaped substrings.
 */
function parseToolResultJson(sseText: string): unknown {
  const dataLine = sseText.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`No SSE data frame in response: ${sseText}`);
  const envelope = JSON.parse(dataLine.slice('data: '.length)) as {
    error?: { message?: string };
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
  };
  // Fail loudly with the SERVER's own error message instead of a bare
  // "Cannot read properties of undefined" a couple lines down if a tool call actually failed —
  // a broken fake (wrong mock shape, thrown error) must surface as a readable assertion failure.
  if (envelope.error)
    throw new Error(`MCP JSON-RPC error: ${envelope.error.message ?? JSON.stringify(envelope.error)}`);
  if (!envelope.result) throw new Error(`No result in MCP response: ${sseText}`);
  if (envelope.result.isError) throw new Error(`Tool call returned isError: ${envelope.result.content[0]?.text}`);
  // `?.` on the success path too (review finding): an empty `content` array must fail with a
  // readable message here, not a bare "Cannot read properties of undefined" several stack frames
  // away in JSON.parse — exactly the confusing-failure shape the guards above already avoid.
  const payload = envelope.result.content[0]?.text;
  if (payload === undefined) throw new Error(`Tool result has no content[0].text: ${sseText}`);
  return JSON.parse(payload);
}

async function callMcpTool(
  port: number,
  token: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; json: unknown }> {
  const initResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    }),
  });
  // Drain + check the handshake response (review round 5): an unread body can hold the socket
  // open, and a failed handshake would otherwise only surface as a confusing tools/call error
  // several lines below instead of a readable failure right here.
  const initText = await initResponse.text();
  if (!initResponse.ok) throw new Error(`MCP initialize failed (${initResponse.status}): ${initText}`);

  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await response.text();
  return { text, json: parseToolResultJson(text) };
}

const callInsertElement = (port: number, token: string) =>
  callMcpTool(port, token, 'hyper_insert_element', {
    filePath: 'src/App.tsx',
    parentId: null,
    componentType: 'div',
    props: {},
  });

const callGetComponentTree = (port: number, token: string) =>
  callMcpTool(port, token, 'hyper_get_component_tree', { filePath: 'src/App.tsx' });

describe('setupMcpServer() — MCP AstService/ComponentService follow a workspace reroot (HYP-984)', () => {
  let disposeServer: (() => void) | null = null;

  afterEach(() => {
    disposeServer?.();
    disposeServer = null;
    autoUpdateMcpConfigs.mockClear();
    registerCopilotMcp.mockClear();
  });

  it('exposes a workspaceRoot getter (not a by-value snapshot) on the services object HyperMcpServer holds — review finding: only astService/componentService were covered', () => {
    // Direct, no-server-start unit check on the actual object setupMcpServer() constructs, so it
    // pins the invariant the WHOLE fix depends on: HyperMcpServer must store `_services` BY
    // REFERENCE (`this._services = config`), never `{ ...config }`/destructured — either of those
    // would evaluate every getter exactly once at construction and silently reintroduce the
    // staleness bug for a future MCP tool that reads `services.workspaceRoot` (none does today).
    const fakePanelRouter = makeFakePanelRouter(fakeAstService(1), fakeComponentService('x'));
    const server = setupMcpServer(
      makeFakeContext(),
      fakePanelRouter,
      { state: { currentComponent: null }, applyUpdate: mock() } as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();
    const services = (server as unknown as { _services: HyperMcpServices })._services;

    expect(services.workspaceRoot).toBe('/test-workspace-old');
    fakePanelRouter.workspaceRoot = '/test-workspace-new';
    expect(services.workspaceRoot).toBe('/test-workspace-new');
  });

  it('routes an MCP mutation to the NEW workspace AstService/ComponentService after PanelRouter recreates the bridge', async () => {
    const OLD_INSERT_INDEX = 101;
    const NEW_INSERT_INDEX = 202;
    const oldAstService = fakeAstService(OLD_INSERT_INDEX);
    const oldComponentService = fakeComponentService('old-workspace');
    const fakePanelRouter = makeFakePanelRouter(oldAstService, oldComponentService);

    const server = setupMcpServer(
      makeFakeContext(),
      fakePanelRouter,
      { state: { currentComponent: { path: 'src/App.tsx', name: 'App' } }, applyUpdate: mock() } as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();
    await server.ensureStarted();

    // Before the reroot: both tool calls must hit the OLD workspace's services, and the wire
    // response (not just the mock call count) must prove it — the real end-to-end assertion the
    // review flagged as missing. `hyper_insert_element`'s handler re-serializes down to `{ index }`
    // (ast-tools.ts), so the OLD/NEW distinguishing signal rides `index`; `hyper_get_component_tree`
    // passes its result through verbatim, so `_servedBy` survives there untouched.
    const oldInsertResponse = await callInsertElement(server.port, server.token);
    expect(oldInsertResponse.json).toEqual({ index: OLD_INSERT_INDEX });
    expect(oldAstService.insertElement).toHaveBeenCalledTimes(1);

    const oldTreeResponse = await callGetComponentTree(server.port, server.token);
    expect(oldTreeResponse.json).toEqual({ _servedBy: 'old-workspace' });
    expect(oldComponentService.parseStructure).toHaveBeenCalledTimes(1);

    // Simulate PanelRouter._ensureCurrentWorkspace(): the bridge AND componentService are
    // REPLACED wholesale, not mutated in place — a stale by-value snapshot from setup time would
    // never see this.
    const newAstService = fakeAstService(NEW_INSERT_INDEX);
    const newComponentService = fakeComponentService('new-workspace');
    fakePanelRouter.astBridge = { astService: newAstService };
    fakePanelRouter.componentService = newComponentService;

    // After the reroot: the SAME HyperMcpServer instance (no restart, exactly like production —
    // the server survives a reroot) must now hit the NEW workspace's services, proven via the
    // wire response.
    const newInsertResponse = await callInsertElement(server.port, server.token);
    expect(newInsertResponse.json).toEqual({ index: NEW_INSERT_INDEX });
    expect(newAstService.insertElement).toHaveBeenCalledTimes(1);
    // And it must NOT have replayed against the old services.
    expect(oldAstService.insertElement).toHaveBeenCalledTimes(1);

    const newTreeResponse = await callGetComponentTree(server.port, server.token);
    expect(newTreeResponse.json).toEqual({ _servedBy: 'new-workspace' });
    expect(newComponentService.parseStructure).toHaveBeenCalledTimes(1);
    expect(oldComponentService.parseStructure).toHaveBeenCalledTimes(1);

    // NOTE (review round 2): a prior version of this test also asserted
    // `fakePanelRouter.astBridge.astService.projectDefaultCssSystem` here, claiming it proved the
    // getter reads the current workspace's CSS-system floor live. That assertion was tautological
    // — it read the test's own fixture (the object this file just assigned two lines above),
    // never touching setupMcpServer()'s getter, HyperMcpServer, or the wire, so it passed
    // identically against the pre-fix, buggy code. The wire-level insert/tree assertions above
    // are the real proof: they show the SAME `newAstService` object (with its own
    // `projectDefaultCssSystem`) is the one actually invoked through the live getter chain, which
    // is exactly what "the floor reads the current workspace's value" reduces to — no separate
    // assertion adds coverage without also driving `projectDefaultCssSystem` through a tool
    // response, which no current MCP tool surfaces.
  });
});
