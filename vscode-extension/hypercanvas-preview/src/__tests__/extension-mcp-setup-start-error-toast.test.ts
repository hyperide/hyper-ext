/**
 * @file HYP-953 — closes a gap left by HyperMcpServer-start-error.test.ts and the
 * setup-mcp-live-getter.test.ts "startError surfacing" cases: those prove the error is
 * *recorded* (HyperMcpServer.startError) and *read* by the later `hypercanvas.setupMcp`
 * guard, but nothing exercised setupMcpServer()'s own `.catch()` — the immediate toast
 * fired the moment start() rejects (extension-mcp-setup.ts:95-105), before a user ever
 * clicks Setup AI Agents. Without this test a regression back to the pre-fix
 * console-error-only behavior would slip through green.
 *
 * Forces the rejection the same way HyperMcpServer-start-error.test.ts does — mocking
 * `../services/netProbe`'s `listenLoopback`, since start() always binds an OS-assigned
 * ephemeral port (no fixed port to pre-occupy for a real bind conflict).
 */
import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';

const BIND_ERROR = new Error('listen EACCES: permission denied 127.0.0.1:0');

mock.module('../services/netProbe', () => ({
  listenLoopback: () => Promise.reject(BIND_ERROR),
}));

// Imported AFTER the mock.module call so HyperMcpServer (transitively, via
// extension-mcp-setup.ts) picks up the mocked listenLoopback.
const { setupMcpServer } = await import('../extension-mcp-setup');
import type { PanelRouter } from '../PanelRouter';
import type { StateHub } from '../StateHub';
import type { DiagnosticHub } from '../DiagnosticHub';

function recordedArgs(fn: unknown): unknown[][] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls;
}

function makeFakePanelRouter(): PanelRouter {
  return {
    astBridge: { astService: {} },
    componentService: {},
  } as unknown as PanelRouter;
}

describe('setupMcpServer() — start() failure toast (HYP-953)', () => {
  it('shows an error notification with the real reason when start() rejects', async () => {
    const fakeContext = { subscriptions: [] as Array<{ dispose(): void }> };

    setupMcpServer(
      fakeContext as unknown as import('vscode').ExtensionContext,
      makeFakePanelRouter(),
      {} as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      '/test-workspace',
      null,
    );

    // start() rejection propagates through a couple of microtask hops
    // (listenLoopback's mocked rejection -> HyperMcpServer.start()'s .catch ->
    // the setupMcpServer .catch()) before the toast fires.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = recordedArgs(vscode.window.showErrorMessage);
    expect(calls.some((c) => c[0] === `HyperCanvas MCP server failed to start: ${BIND_ERROR.message}`)).toBe(true);
  });
});
