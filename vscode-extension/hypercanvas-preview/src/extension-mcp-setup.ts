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
  workspaceRoot: string,
  mcpStatusBarItem: vscode.StatusBarItem,
  server: HyperMcpServer,
): void {
  autoUpdateMcpConfigs(workspaceRoot, server.url);
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
  workspaceRoot: string,
  previewPanel: PreviewPanel | null,
): HyperMcpServer {
  const astService = panelRouter.astBridge.astService;
  const componentService = panelRouter.componentService;

  const server = new HyperMcpServer({
    astService,
    componentService,
    stateHub,
    diagnosticHub,
    workspaceRoot,
    onNavigate: (filePath, elementId) => navigateToElement(astService, filePath, elementId),
    onRefresh: () => previewPanel?.refresh(),
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
    onScreenshot: (elementId) => previewPanel?.takeScreenshot(elementId) ?? Promise.resolve(null),
  });

  // MCP status bar item (shown after server starts)
  const mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  mcpStatusBarItem.command = 'hypercanvas.setupMcp';
  context.subscriptions.push(mcpStatusBarItem);

  // HYP-954: fires handleMcpServerStarted() on EVERY successful start, not just
  // activation's — see HyperMcpServer.onStarted's doc comment.
  server.onStarted(() => handleMcpServerStarted(context, workspaceRoot, mcpStatusBarItem, server));

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
