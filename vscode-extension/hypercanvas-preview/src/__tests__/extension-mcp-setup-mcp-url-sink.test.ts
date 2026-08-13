/**
 * @file HYP-1159 regression test — the e2e harness had no way to learn the per-start MCP
 * bearer token minted by HYP-956, so every direct `/mcp` call from mcp-tools.spec.ts 401'd
 * (0 passes across the 2026-07-29 and 2026-08-01 nightly matrix runs:
 * `MCP call failed: 401 {"error":"Unauthorized: missing or invalid token"}`).
 *
 * The token is intentionally NOT in the status-bar tooltip or any config file, so the
 * harness reads it from an env-gated URL sink: when `HYPERIDE_MCP_URL_SINK` names a file
 * path, `handleMcpServerStarted()` writes the freshly-started server's token-bearing
 * `url` there; the harness's launchVSCode sets that env var into the extension host and
 * the spec parses `?token=` out of the file. Without the sink write the whole hyper_*
 * tool surface is unreachable to the harness.
 *
 * Contract under test (extension-mcp-setup.ts `publishMcpUrlToE2ESink`):
 *  1. a successful start with the env var set writes the current `server.url` to the file;
 *  2. a sink write failure (bad path) is swallowed — it must never break server startup.
 *
 * Uses the same `mock.module` technique as extension-mcp-setup-workspaceroot-reroot.test.ts
 * and relies on the same isolation guarantee: this package's test command is
 * `bun test --isolate src/`, one process per test file — never run this file with a bare
 * `bun test <path>` alongside others or the netProbe/extension-commands-utils mocks leak.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type BindImpl = () => Promise<number>;
const currentBindImpl: BindImpl = () => Promise.resolve(7654);

mock.module('../services/netProbe', () => ({
  listenLoopback: () => currentBindImpl(),
}));

mock.module('../extension-commands-utils', () => ({
  autoUpdateMcpConfigs: mock(() => Promise.resolve()),
  registerCopilotMcp: mock(() => {}),
}));

// Imported AFTER the mock.module calls so extension-mcp-setup picks up the mocks
// (test-case exception to the static-import rule: mock.module must precede import).
const { setupMcpServer } = await import('../extension-mcp-setup');
import type { ExtensionContext } from 'vscode';
import type { PanelRouter } from '../PanelRouter';
import type { StateHub } from '../StateHub';
import type { DiagnosticHub } from '../DiagnosticHub';

function makeFakePanelRouter(): PanelRouter {
  return {
    astBridge: { astService: {} },
    componentService: {},
    workspaceRoot: '/test-workspace',
  } as unknown as PanelRouter;
}

function makeFakeContext(): ExtensionContext {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: { get: () => true, update: () => Promise.resolve() },
  } as unknown as ExtensionContext;
}

describe('setupMcpServer() — HYPERIDE_MCP_URL_SINK publishes the token-bearing url on start (HYP-1159)', () => {
  const SINK_ENV = 'HYPERIDE_MCP_URL_SINK';
  let disposeServer: (() => void) | null = null;
  let savedSinkEnv: string | undefined;
  let tmpDir: string | null = null;

  afterEach(() => {
    disposeServer?.();
    disposeServer = null;
    if (savedSinkEnv === undefined) delete process.env[SINK_ENV];
    else process.env[SINK_ENV] = savedSinkEnv;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  function armSinkEnv(): string {
    savedSinkEnv = process.env[SINK_ENV];
    tmpDir = mkdtempSync(join(tmpdir(), 'hyp1159-sink-'));
    const sinkPath = join(tmpDir, 'mcp-server-url.txt');
    process.env[SINK_ENV] = sinkPath;
    return sinkPath;
  }

  it('writes the freshly-started server url (with ?token=) to the sink file', async () => {
    const sinkPath = armSinkEnv();

    const server = setupMcpServer(
      makeFakeContext(),
      makeFakePanelRouter(),
      {} as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();

    await server.ensureStarted();

    const published = readFileSync(sinkPath, 'utf8').trim();
    expect(published).toBe(server.url);
    // The harness authenticates by parsing ?token= out of this url — a published url
    // without the token would re-create the exact 401 cluster this fix eliminates.
    expect(new URL(published).searchParams.get('token')).toBeTruthy();
  });

  it('a sink write failure is swallowed — server start still succeeds', async () => {
    savedSinkEnv = process.env[SINK_ENV];
    // A path whose parent directory does not exist makes writeFileSync throw.
    process.env[SINK_ENV] = join(tmpdir(), 'hyp1159-no-such-dir', 'mcp-server-url.txt');

    const server = setupMcpServer(
      makeFakeContext(),
      makeFakePanelRouter(),
      {} as unknown as StateHub,
      {} as unknown as DiagnosticHub,
      () => null,
    );
    disposeServer = () => server.dispose();

    await server.ensureStarted();

    expect(server.port).toBe(7654);
    expect(server.url).toContain('?token=');
  });
});
