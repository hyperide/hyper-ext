/**
 * @file Regression test for `Hyper: Setup MCP` (command id `hypercanvas.setupMcp`).
 *
 * Bug (#383 / 592f8e67 — decompose-large-files): the command was moved out of
 * activate() (where it read the live module-level `mcpServer` binding) into
 * extension-commands.ts, which read a by-value `ctx.mcpServer` snapshot. activate()
 * calls registerCommands() BEFORE setupMcpServer() assigns `mcpServer`, so that
 * snapshot was permanently null — the gate always fired "HyperCanvas MCP server is
 * not running" and the step-1 agent quick pick never opened. Dead in production for
 * every user; the e2e matrix caught it as 12 reds in mcp-setup.spec.ts.
 *
 * Fix: replace the by-value field with a live `getMcpServer()` accessor that closes
 * over activate()'s `let mcpServer`, so registration order no longer matters.
 *
 * Coverage here (two independent guards):
 *   1. Consumer gate — invokes the REAL registered `hypercanvas.setupMcp` handler
 *      (via registerCommands + the preloaded vscode mock) and asserts that, with a
 *      live server set AFTER registration, execution reaches the quick pick (the
 *      pick opens) rather than aborting on the "not running" toast.
 *   2. Producer wiring — a source-level tripwire on extension.ts, since this test
 *      builds a synthetic CommandContext and does NOT execute activate(); without it
 *      a revert of extension.ts back to a by-value `mcpServer,` snapshot would slip
 *      through guard #1.
 *
 * Assumptions: vscode is mocked by the preload (test/mock-vscode.ts). The mock has no
 * `window.showQuickPick`, so once the gate PASSES the handler throws a TypeError there
 * — that throw is the positive signal that the pick was reached.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import * as vscode from 'vscode';
import { registerCommands, type CommandContext } from '../extension-commands';
import type { HyperMcpServer } from '../mcp/HyperMcpServer';

const NOT_RUNNING = 'HyperCanvas MCP server is not running';
/** The handler reaches this (absent in the mock) only AFTER the gate passes. */
const PICK_REACHED = /showQuickPick is not a function/;

/** A mutable holder, standing in for activate()'s module-level `let mcpServer`. */
interface ServerHolder {
  server: HyperMcpServer | null;
}

/** Only the fields the gate / handler actually read. Typed (not `as unknown as`) so
 *  this fake fails loudly if the surface the handler depends on changes. */
function fakeServer(port: number): HyperMcpServer {
  const minimal: Pick<HyperMcpServer, 'port' | 'url' | 'dispose'> = {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    dispose() {},
  };
  return minimal as HyperMcpServer;
}

/** Build a real CommandContext whose getMcpServer closes over `holder`, exactly like
 *  activate() wires `getMcpServer: () => mcpServer` over its own `let mcpServer`. */
function makeCtx(holder: ServerHolder): CommandContext {
  return {
    previewPanel: null,
    devServerManager: null,
    diagnosticHub: null,
    aiChatProvider: null,
    rightPanelProvider: null,
    leftPanelProvider: null,
    logsProvider: null,
    stateHub: null,
    panelRouter: null,
    getMcpServer: () => holder.server,
    prepareDevServerTargetRef: null,
    rerootDevServerTargetRef: null,
    getWorkspaceRoot: () => '/test-workspace',
  };
}

/** Read the recorded calls of a bun-mocked function. The `vscode` module declares
 *  these as plain functions, so the bun `mock` metadata needs a localized cast. */
function recordedArgs(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

function registerAndGetHandler(holder: ServerHolder): () => Promise<void> {
  const fakeContext = { subscriptions: [] as Array<{ dispose(): void }> };
  registerCommands(fakeContext as unknown as vscode.ExtensionContext, '/test-workspace', makeCtx(holder));
  const entry = recordedArgs(vscode.commands.registerCommand).find((c) => c[0] === 'hypercanvas.setupMcp');
  if (!entry) throw new Error('hypercanvas.setupMcp was not registered');
  return entry[1] as () => Promise<void>;
}

function firedNotRunning(): boolean {
  return recordedArgs(vscode.window.showErrorMessage).some((c) => c[0] === NOT_RUNNING);
}

describe('hypercanvas.setupMcp — live MCP-server gate (#383 regression)', () => {
  it('opens the pick when the MCP server is assigned AFTER registerCommands (activate ordering)', async () => {
    // activate() ordering: registerCommands runs FIRST, while mcpServer is still null.
    const holder: ServerHolder = { server: null };
    const fakeContext = { subscriptions: [] as Array<{ dispose(): void }> };
    const ctx = makeCtx(holder);
    registerCommands(fakeContext as unknown as vscode.ExtensionContext, '/test-workspace', ctx);
    const entry = recordedArgs(vscode.commands.registerCommand).find((c) => c[0] === 'hypercanvas.setupMcp');
    const handler = entry?.[1] as () => Promise<void>;

    // ...then setupMcpServer() assigns the live server AFTERWARDS. The getter must see it
    // (a by-value snapshot captured at registration time would still read null here).
    holder.server = fakeServer(45321);
    expect(ctx.getMcpServer()?.port).toBe(45321);

    // The gate passes, so the handler runs ON to the quick pick (absent in the mock ->
    // TypeError). Reaching it is the proof the step-1 pick opens. Any OTHER rejection
    // (e.g. a pre-pick crash) would fail this assertion rather than false-greening.
    await expect(handler()).rejects.toThrow(PICK_REACHED);
    expect(firedNotRunning()).toBe(false);
  });

  it('still aborts with the "not running" toast when no server is up', async () => {
    const handler = registerAndGetHandler({ server: null });
    // Gate aborts -> handler resolves (no quick pick reached, no throw).
    await handler();
    expect(firedNotRunning()).toBe(true);
  });

  it('aborts when the server exists but its port is still 0 (not yet listening)', async () => {
    const handler = registerAndGetHandler({ server: fakeServer(0) });
    await handler();
    expect(firedNotRunning()).toBe(true);
  });
});

describe('extension.ts MCP wiring tripwire (#383 regression)', () => {
  it('passes getMcpServer as a live closure over the module-level mcpServer, not a by-value snapshot', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'extension.ts'), 'utf-8');

    // The live wiring the fix restores. A revert to `getMcpServer: () => null` or to a
    // captured snapshot would not match this and would re-open #383.
    expect(source).toMatch(/getMcpServer:\s*\(\)\s*=>\s*mcpServer\b/);

    // And it must NOT hand registerCommands a by-value `mcpServer,` field (the bug shape).
    expect(source).not.toMatch(/^\s*mcpServer,\s*$/m);
  });
});
