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

  server
    .start()
    .then((port) => {
      autoUpdateMcpConfigs(workspaceRoot, port);
      registerCopilotMcp(context, port);
      mcpStatusBarItem.text = '$(plug) Hyper MCP';
      mcpStatusBarItem.tooltip = `HyperCanvas MCP: http://127.0.0.1:${port}/mcp\nClick to configure AI agents`;
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
    })
    .catch((err) => {
      console.error('[HyperIDE] Failed to start MCP server:', err);
    });

  context.subscriptions.push({ dispose: () => server.dispose() });
  return server;
}
