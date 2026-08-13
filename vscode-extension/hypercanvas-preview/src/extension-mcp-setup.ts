import * as vscode from 'vscode';
import { goToCode } from './EditorBridge';
import { autoUpdateMcpConfigs, registerCopilotMcp } from './extension-commands-utils';
import { HyperMcpServer } from './mcp/HyperMcpServer';
import type { PanelRouter } from './PanelRouter';
import type { PreviewPanel } from './PreviewPanel';
import type { StateHub } from './StateHub';
import type { DiagnosticHub } from './DiagnosticHub';
import type { AstService } from './services/AstService';

/**
 * MCP `hyper_navigate_to_element` handler: resolve an element ref to its source location and
 * navigate the editor there. Extracted from the inline onNavigate closure so the 0-based →
 * 1-based column conversion (the off-by-one guard) is unit-testable without standing up the
 * whole MCP server. `navigate` is injected (defaults to goToCode) for the same reason.
 */
export async function navigateToElement(
  astService: Pick<AstService, 'getElementLocation'>,
  filePath: string,
  elementId: string,
  navigate: typeof goToCode = goToCode,
): Promise<void> {
  const location = await astService.getElementLocation(filePath, elementId);
  if (!location) return;
  // getElementLocation returns a Babel 0-based column; goToCode expects a 1-based column (it
  // subtracts 1 for the VS Code Position). Add 1 like the other callers (SyncPositionService,
  // goToCodeSelected) — otherwise navigation lands one char left and column 0 underflows to -1.
  await navigate(filePath, location.line, location.column + 1);
}

// Eager activation start is fire-and-forget (no user waiting), so give it plenty
// of room for the full bind-retry budget to land before abandonment. The
// interactive setupMcp path uses ensureStarted()'s own 3000ms default instead.
const ACTIVATION_START_TIMEOUT_MS = 30_000;

/**
 * Fires on every successful `ensureStarted()` transition to STARTED — the
 * eager activation attempt AND any later successful `hypercanvas.setupMcp`
 * retry (HyperMcpServer.onStarted; HYP-954 review finding). Config auto-update,
 * Copilot MCP registration, and the status bar used to run ONLY from
 * activation's one-shot `.then()`, so a retry that succeeded after activation's
 * own attempt had failed left stale configs, no Copilot provider, and a hidden
 * status bar even though the server was genuinely up. Routing both paths
 * through this single handler keeps them in sync.
 */
function handleMcpServerStarted(
  context: vscode.ExtensionContext,
  panelRouter: PanelRouter,
  mcpStatusBarItem: vscode.StatusBarItem,
  server: HyperMcpServer,
): void {
  // HYP-984: read panelRouter.workspaceRoot live at fire time, not a value captured at
  // setupMcpServer() call time — this handler fires on every successful start INCLUDING a
  // hypercanvas.setupMcp retry that happens after a workspace reroot, and a captured string
  // would keep writing .mcp.json / .vscode/mcp.json / opencode.json / .codex/config.toml to the
  // OLD workspace forever.
  autoUpdateMcpConfigs(panelRouter.workspaceRoot, server.url);
  registerCopilotMcp(context, server.url);
  mcpStatusBarItem.text = '$(plug) Hyper MCP';
  mcpStatusBarItem.tooltip = `HyperCanvas MCP: http://127.0.0.1:${server.port}/mcp\nClick to configure AI agents`;
  mcpStatusBarItem.show();

  const notificationShown = context.globalState.get<boolean>('mcpNotificationShown', false);
  if (!notificationShown) {
    vscode.window
      .showInformationMessage(
        'HyperCanvas MCP server is running — AI agents can now use visual editing tools.',
        'Setup Agents',
        'Dismiss',
      )
      .then((choice) => {
        if (choice === 'Setup Agents') {
          vscode.commands.executeCommand('hypercanvas.setupMcp');
        }
      });
    context.globalState.update('mcpNotificationShown', true);
  }
}

export function setupMcpServer(
  context: vscode.ExtensionContext,
  panelRouter: PanelRouter,
  stateHub: StateHub,
  diagnosticHub: DiagnosticHub,
  // A thunk, not a by-value `PreviewPanel | null` parameter — same snapshot shape this whole fix
  // eliminates for astService/componentService/workspaceRoot below.
  getPreviewPanel: () => PreviewPanel | null,
): HyperMcpServer {
  // Does NOT rotate the MCP bearer token or restart the server on a workspace reroot:
  // `HyperMcpServer._token` authenticates "this running server PROCESS", not "this workspace" —
  // there is no separate per-workspace trust boundary to enforce for a single-user loopback
  // server, and forcing re-auth on every folder switch would be a pure UX regression. What this
  // fix delivers is narrower and load-bearing: a NEW tool call issued after a reroot resolves
  // `astService`/`componentService`/`workspaceRoot` against the CURRENT workspace (the getters
  // below), not the previous one. This is a per-CALL guarantee, not a per-OPERATION one — a
  // handler that resolves a service and then awaits I/O is not re-checked mid-flight, so a reroot
  // during that await can still complete against the workspace current when the call STARTED. A
  // narrower, pre-existing race, unaffected by this fix either way.
  //
  // NEVER snapshot `panelRouter.astBridge.astService` / `.componentService` / `.workspaceRoot`
  // into a local `const` here. PanelRouter._ensureCurrentWorkspace() replaces `_astBridge` (and
  // `_componentService`, `_workspaceRoot`) wholesale on a workspace reroot, and every one of
  // PanelRouter's public getters (`astBridge`, `componentService`, `workspaceRoot`) calls
  // `_ensureCurrentWorkspace()` itself before returning — so reading any of them here, at any
  // time, always re-derives from `vscode.workspace.workspaceFolders` first. A by-value snapshot
  // captured once at activation would keep every later MCP tool call (and the `onNavigate`
  // closure below) wired to the OLD workspace forever. `HyperMcpServer` already re-reads
  // `this._services.astService` on EVERY request (`_createMcpServer()` runs per-request,
  // stateless mode), so a `get` accessor here is enough to make the whole chain live.
  const server = new HyperMcpServer({
    get astService() {
      return panelRouter.astBridge.astService;
    },
    get componentService() {
      return panelRouter.componentService;
    },
    stateHub,
    diagnosticHub,
    // No MCP tool handler currently reads `this._services.workspaceRoot` (grep
    // `vscode-extension/hypercanvas-preview/src/mcp/tools/` — every tool resolves paths through
    // `resolveFilePath(stateHub, filePath)` or `astService`/`componentService` instead), so there
    // is no tool-call-level regression to test beyond `handleMcpServerStarted()`'s config-write
    // path (covered by extension-mcp-setup-workspaceroot-reroot.test.ts). Kept live via the same
    // getter pattern regardless, so a future tool that DOES read it inherits correct behavior for
    // free instead of needing its own HYP-984-shaped fix.
    get workspaceRoot() {
      return panelRouter.workspaceRoot;
    },
    onNavigate: (filePath, elementId) => navigateToElement(panelRouter.astBridge.astService, filePath, elementId),
    onRefresh: () => getPreviewPanel()?.refresh(),
    onOpenComponent: (path) => {
      stateHub?.applyUpdate({
        currentComponent: {
          path,
          name:
            path
              .split('/')
              .pop()
              ?.replace(/\.\w+$/, '') ?? path,
        },
      });
    },
    onScreenshot: (elementId) => getPreviewPanel()?.takeScreenshot(elementId) ?? Promise.resolve(null),
  });

  // MCP status bar item (shown after server starts)
  const mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  mcpStatusBarItem.command = 'hypercanvas.setupMcp';
  context.subscriptions.push(mcpStatusBarItem);

  // HYP-954: fires handleMcpServerStarted() on EVERY successful start, not just
  // activation's — see HyperMcpServer.onStarted's doc comment.
  server.onStarted(() => handleMcpServerStarted(context, panelRouter, mcpStatusBarItem, server));

  // Eager fire-and-forget via ensureStarted() (not a bare start()) so this
  // activation attempt and any LATER hypercanvas.setupMcp invocation share the
  // same single-flight promise/state — a setupMcp call that lands mid-activation
  // awaits this same start instead of racing a synchronous port===0 check, and a
  // failure here is retryable later instead of terminal.
  //
  // Generous timeout (review finding): NOBODY is awaiting this fire-and-forget
  // start, so its only job is to give the full bind-retry budget room to land.
  // The interactive `hypercanvas.setupMcp` path keeps the tight 3000ms budget
  // (a user IS waiting there). Here a tight timeout would ABANDON+close a
  // slow-but-viable bind and leave the server down until a manual Retry.
  server.ensureStarted(ACTIVATION_START_TIMEOUT_MS).catch((err) => {
    console.error('[HyperIDE] Failed to start MCP server:', err);
    // HYP-953: a start() failure (loopback bind refused by a local firewall/AV/
    // sandbox, port exhaustion, etc.) used to be silent — console.error only
    // reaches the Extension Host log, which a user never opens. Surface it
    // immediately so a partner sees the real reason instead of discovering the
    // failure later as a bare "MCP server is not running" toast on Setup AI
    // Agents (server.startError carries the same message for that guard).
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`HyperCanvas MCP server failed to start: ${message}`);
  });

  context.subscriptions.push({ dispose: () => server.dispose() });
  return server;
}
