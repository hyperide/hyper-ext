import * as vscode from 'vscode';
import { goToCode } from './EditorBridge';
import { autoUpdateMcpConfigs, registerCopilotMcp } from './extension-commands-utils';
import { HyperMcpServer } from './mcp/HyperMcpServer';
import type { PanelRouter } from './PanelRouter';
import type { PreviewPanel } from './PreviewPanel';
import type { StateHub } from './StateHub';
import type { DiagnosticHub } from './DiagnosticHub';

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
    onNavigate: async (filePath, elementId) => {
      const location = await astService.getElementLocation(filePath, elementId);
      if (location) {
        await goToCode(filePath, location.line, location.column);
      }
    },
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
