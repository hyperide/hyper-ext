/**
 * HyperCanvas Preview Extension
 *
 * Standalone VS Code extension for visual React component editing.
 * Works completely locally — no remote backend dependency.
 *
 * Features:
 * - Local dev server management
 * - AST-based code manipulation
 * - Component discovery and parsing
 * - Local storage for compositions
 * - AI integration with user's API key
 */

import * as vscode from 'vscode';
import { LeftPanelProvider } from './LeftPanelProvider';
import { LogsAndChatPanelProvider } from './LogsAndChatPanelProvider';
import { PanelRouter } from './PanelRouter';
import { PreviewPanel } from './PreviewPanel';
import { RightPanelProvider } from './RightPanelProvider';
import { StateHub } from './StateHub';
import { AstService } from './services/AstService';
import { DevServerManager } from './services/DevServerManager';
import { detectUIKit } from './services/ProjectDetector';
import { VSCodeFileIO } from './vscode-file-io';

// Global references
let previewPanel: PreviewPanel | null = null;
let devServerManager: DevServerManager | null = null;
let logsAndChatProvider: LogsAndChatPanelProvider | null = null;
let leftPanelProvider: LeftPanelProvider | null = null;
let rightPanelProvider: RightPanelProvider | null = null;
let stateHub: StateHub | null = null;
let panelRouter: PanelRouter | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[HyperCanvas] Extension activating...');

  // Get workspace root
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    console.log('[HyperCanvas] No workspace folder open');
    vscode.window.showWarningMessage('HyperCanvas: Please open a folder to use the preview.');
    return;
  }

  console.log(`[HyperCanvas] Workspace root: ${workspaceRoot}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  devServerManager = new DevServerManager(workspaceRoot);

  // Create StateHub and PanelRouter for cross-panel coordination
  stateHub = new StateHub();
  panelRouter = new PanelRouter({
    workspaceRoot,
    stateHub,
  });

  // Create preview panel instance
  previewPanel = new PreviewPanel(context.extensionUri, workspaceRoot, stateHub, panelRouter);

  // Register serializer for cross-restart persistence
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(PreviewPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        previewPanel?.restorePanel(panel);
      },
    }),
  );

  // Open preview panel as editor tab on activation
  previewPanel.createOrShow(vscode.ViewColumn.Beside);

  // Register Logs & AI Chat panel
  logsAndChatProvider = new LogsAndChatPanelProvider(context.extensionUri, workspaceRoot, context);

  // Wire ai:openChat from any panel → Logs & AI Chat panel
  panelRouter.setOnOpenAIChat((prompt) => {
    logsAndChatProvider?.sendAIPrompt(prompt);
  });

  // Detect UI kit from package.json and broadcast to all panels
  detectUIKit(workspaceRoot)
    .then((kit) => {
      stateHub?.applyUpdate('extension-host', { projectUIKit: kit });
    })
    .catch((err) => {
      console.warn('[HyperCanvas] Failed to detect UI kit:', err);
    });

  if (devServerManager) {
    logsAndChatProvider.setDevServerManager(devServerManager);

    // Wire runtime errors from preview iframe to dev server manager
    previewPanel.onRuntimeError((error) => {
      devServerManager?.setRuntimeError(error ?? null);
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LogsAndChatPanelProvider.viewType, logsAndChatProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Auto-inject UUIDs and parse component structure when currentComponent changes
  const unsubStateChange = stateHub.onChange((_state, patch) => {
    if (patch.currentComponent?.path) {
      const componentPath = patch.currentComponent.path;
      // First inject data-uniq-id attributes into source, then parse structure
      panelRouter?.astBridge.astService
        .injectUniqueIds(componentPath)
        .then(() => panelRouter?.componentService.parseStructure(componentPath))
        .then((structure) => {
          stateHub?.applyUpdate('extension-host', { astStructure: structure });
        })
        .catch((err) => {
          console.error('[HyperCanvas] Failed to inject UUIDs / parse structure:', err);
        });
    }
  });
  context.subscriptions.push({ dispose: unsubStateChange });

  // Register Left Panel (Activity Bar explorer)
  leftPanelProvider = new LeftPanelProvider(context.extensionUri, stateHub, panelRouter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LeftPanelProvider.viewType, leftPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register Right Panel (Inspector)
  rightPanelProvider = new RightPanelProvider(context.extensionUri, stateHub, panelRouter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RightPanelProvider.viewType, rightPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands
  registerCommands(context, workspaceRoot);

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(eye) Preview';
  statusBarItem.tooltip = 'Open HyperCanvas Preview';
  statusBarItem.command = 'hypercanvas.openPreview';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Auto-start dev server if configured
  const autoStart = vscode.workspace.getConfiguration('hypercanvas.devServer').get<boolean>('autoStart', false);

  if (autoStart) {
    devServerManager.start().then((state) => {
      if (state.status === 'running' && state.url) {
        previewPanel?.setPreviewUrl(state.url);
      }
    });
  }

  console.log('[HyperCanvas] Extension activated successfully');
}

export function deactivate() {
  console.log('[HyperCanvas] Extension deactivating...');

  // Stop dev server if running
  if (devServerManager) {
    devServerManager.dispose();
    devServerManager = null;
  }

  if (panelRouter) {
    panelRouter.dispose();
    panelRouter = null;
  }

  if (stateHub) {
    stateHub.dispose();
    stateHub = null;
  }

  console.log('[HyperCanvas] Extension deactivated');
}

/**
 * Get workspace root folder
 */
function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

/**
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext, workspaceRoot: string): void {
  // Open preview
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openPreview', () => {
      previewPanel?.createOrShow(vscode.ViewColumn.Beside);
    }),
  );

  // Open Logs & AI Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openLogsAndChat', () => {
      vscode.commands.executeCommand('hypercanvas.logsAndChatView.focus');
    }),
  );

  // Open Explorer panel
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openExplorer', () => {
      vscode.commands.executeCommand('hypercanvas.explorerView.focus');
    }),
  );

  // Open Inspector panel
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openInspector', () => {
      vscode.commands.executeCommand('hypercanvas.inspectorView.focus');
    }),
  );

  // Refresh preview
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.refreshPreview', () => {
      previewPanel?.refresh();
    }),
  );

  // Go to Visual - navigate from code to canvas
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.goToVisual', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      if (!/\.(tsx|jsx)$/.test(filePath)) {
        vscode.window.showWarningMessage('Go to Visual only works in TSX/JSX files');
        return;
      }

      const position = editor.selection.active;
      const line = position.line + 1;
      const column = position.character + 1;

      const astService = new AstService(workspaceRoot, new VSCodeFileIO());
      const result = await astService.findElementAtPosition(filePath, line, column);

      if (result) {
        previewPanel?.sendGoToVisual(result.uuid);
      } else {
        vscode.window.showWarningMessage('No element found at cursor position');
      }
    }),
  );

  // Start dev server
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.startDevServer', async () => {
      console.log('[HyperCanvas] startDevServer command triggered');

      if (!devServerManager) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'HyperCanvas: Starting dev server...',
          cancellable: false,
        },
        async () => {
          if (!devServerManager) return;
          const state = await devServerManager.start();
          console.log('[HyperCanvas] Dev server state:', state.status, state.url);

          if (state.status === 'running') {
            vscode.window.showInformationMessage(`Dev server running at ${state.url}`);
            if (state.url) previewPanel?.setPreviewUrl(state.url);
          } else if (state.status === 'error') {
            vscode.window.showErrorMessage(`Failed to start dev server: ${state.error}`);
          }
        },
      );
    }),
  );

  // Stop dev server
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.stopDevServer', async () => {
      if (!devServerManager) {
        return;
      }

      await devServerManager.stop();
      vscode.window.showInformationMessage('Dev server stopped');
    }),
  );

  // Show dev server output
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.showDevServerOutput', () => {
      devServerManager?.showOutput();
    }),
  );

  // Configure AI API key
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.configureAIKey', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'hypercanvas.ai');
    }),
  );

  // Open/create project structure config file
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openProjectStructure', async () => {
      const configDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.hyperide');
      const configFile = vscode.Uri.joinPath(configDir, 'project-structure.json');

      try {
        await vscode.workspace.fs.stat(configFile);
      } catch {
        // File doesn't exist — create with template
        await vscode.workspace.fs.createDirectory(configDir);

        const template = {
          '.atomComponentsPaths': 'Paths to directories with atomic/base UI components (buttons, inputs, etc.)',
          atomComponentsPaths: [] as string[],
          '.compositeComponentsPaths': 'Paths to directories with composite components (forms, cards, layouts)',
          compositeComponentsPaths: [] as string[],
          '.pagesPaths': 'Paths to directories with page components (Next.js pages, route components)',
          pagesPaths: [] as string[],
        };

        const content = Buffer.from(JSON.stringify(template, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(configFile, content);
      }

      const doc = await vscode.workspace.openTextDocument(configFile);
      await vscode.window.showTextDocument(doc);
    }),
  );
}
