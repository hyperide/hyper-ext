/**
 * HyperIDE Preview Extension
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

import { execFile } from 'node:child_process';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ensureSample, PreviewFileManager, PreviewModeManager } from '@lib/preview-generator';
import { buildNeedsPatchPrompt } from '@lib/preview-generator/needs-patch-prompt';
import * as vscode from 'vscode';
import { AI_PROVIDER_DEFAULTS, type AIProvider } from '../../../shared/ai-provider-defaults';
import { GLM_RECOMMENDATION, PROVIDER_KEY_URLS, PROVIDER_LABELS } from '../../../shared/ai-provider-info';
import { AIChatPanelProvider } from './AIChatPanelProvider';
import { DiagnosticHub } from './DiagnosticHub';
import { goToCode } from './EditorBridge';
import { LeftPanelProvider } from './LeftPanelProvider';
import { LogsPanelProvider } from './LogsPanelProvider';
import { HyperMcpServer } from './mcp/HyperMcpServer';
import { PanelRouter } from './PanelRouter';
import { PreviewPanel } from './PreviewPanel';
import { detectBrowserForPlaywright } from './playwright-chrome';
import { RightPanelProvider } from './RightPanelProvider';
import { StateHub } from './StateHub';
import { AstService } from './services/AstService';
import { DevServerManager } from './services/DevServerManager';
import { shouldCreateNoPropsSample } from './services/no-props-sample';
import {
  computeCapabilities,
  detectCssSystem,
  detectPackageManager,
  detectProjectType,
  detectUIKit,
  detectUnsupportedProject,
  readPackageJson,
} from './services/ProjectDetector';
import { createExtensionSampleGenerator } from './services/SampleAIGenerator';
import { generatePreviewWrapper, writePreviewWrapper } from './services/WrapperGenerator';
import { VSCodeFileIO } from './vscode-file-io';

// Global references
let mcpServer: HyperMcpServer | null = null;
let previewPanel: PreviewPanel | null = null;
let devServerManager: DevServerManager | null = null;
let logsProvider: LogsPanelProvider | null = null;
let aiChatProvider: AIChatPanelProvider | null = null;
let leftPanelProvider: LeftPanelProvider | null = null;
let rightPanelProvider: RightPanelProvider | null = null;
let stateHub: StateHub | null = null;
let panelRouter: PanelRouter | null = null;
let diagnosticHub: DiagnosticHub | null = null;

/**
 * Detect project-specific providers needed by preview components.
 * Analyzes App.web.tsx / App.tsx for SafeAreaProvider, TamaguiProvider, NavigationContainer.
 * Returns provider wrap config for __canvas_preview__.tsx generation.
 */
async function detectPreviewProviders(
  root: string,
): Promise<import('@lib/preview-generator').ProviderWrapConfig | undefined> {
  try {
    // Check App.web.tsx first (RN web projects), then App.tsx
    let appContent = '';
    for (const name of ['App.web.tsx', 'App.tsx']) {
      try {
        appContent = await readFile(join(root, name), 'utf-8');
        break;
      } catch {
        /* file doesn't exist — try next */
      }
    }
    if (!appContent) return undefined;

    const imports: string[] = [];
    let wrapOpen = '';
    let wrapClose = '';

    // Detect TamaguiProvider + config
    const tamaguiCfg = appContent.match(
      /import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+['"]([^'"]*tamagui\.config[^'"]*)['"]/,
    );
    if (tamaguiCfg && appContent.includes('TamaguiProvider')) {
      const cfgVar = tamaguiCfg[1] || tamaguiCfg[2];
      // Config path from App.tsx is relative to root — rebase to src/ where __canvas_preview__.tsx lives
      const cfgPathRaw = tamaguiCfg[3];
      const absConfigPath = resolve(root, cfgPathRaw);
      // Detect where __canvas_preview__.tsx will live: apps/next/ for monorepos, src/ otherwise
      let previewDir = join(root, 'src');
      try {
        await access(join(root, 'apps/next')); // nosemgrep: path-join-resolve-traversal
        previewDir = join(root, 'apps/next'); // nosemgrep: path-join-resolve-traversal
      } catch {
        /* not a monorepo — keep src/ */
      }
      let cfgPath = relative(previewDir, absConfigPath);
      if (!cfgPath.startsWith('.')) cfgPath = `./${cfgPath}`;
      const themeMatch = appContent.match(/defaultTheme=["'](\w+)["']/);
      const theme = themeMatch?.[1] || 'dark';
      imports.push("import { TamaguiProvider } from 'tamagui';");
      imports.push(tamaguiCfg[1] ? `import { ${cfgVar} } from '${cfgPath}';` : `import ${cfgVar} from '${cfgPath}';`);
      wrapOpen += `<TamaguiProvider config={${cfgVar}} defaultTheme="${theme}">`;
      wrapClose = `</TamaguiProvider>${wrapClose}`;
    }

    // Detect SafeAreaProvider
    if (appContent.includes('SafeAreaProvider')) {
      imports.push("import { SafeAreaProvider } from 'react-native-safe-area-context';");
      wrapOpen = `<SafeAreaProvider>${wrapOpen}`;
      wrapClose = `${wrapClose}</SafeAreaProvider>`;
    }

    // Detect NavigationContainer
    if (appContent.includes('NavigationContainer')) {
      imports.push("import { NavigationContainer } from '@react-navigation/native';");
      // Place inside SafeAreaProvider but outside TamaguiProvider
      const safeIdx = wrapOpen.indexOf('<TamaguiProvider');
      if (safeIdx >= 0) {
        wrapOpen = `${wrapOpen.slice(0, safeIdx)}<NavigationContainer>${wrapOpen.slice(safeIdx)}`;
        const tamaguiCloseIdx = wrapClose.indexOf('</TamaguiProvider>');
        if (tamaguiCloseIdx >= 0) {
          wrapClose = `${wrapClose.slice(0, tamaguiCloseIdx + '</TamaguiProvider>'.length)}</NavigationContainer>${wrapClose.slice(tamaguiCloseIdx + '</TamaguiProvider>'.length)}`;
        }
      } else {
        wrapOpen = `<NavigationContainer>${wrapOpen}`;
        wrapClose = `${wrapClose}</NavigationContainer>`;
      }
    }

    if (imports.length === 0) return undefined;
    return { imports, wrapOpen, wrapClose };
  } catch {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('[HyperIDE] Extension activating...');

  // Get workspace root
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    console.log('[HyperIDE] No workspace folder open');
    return;
  }

  console.log(`[HyperIDE] Workspace root: ${workspaceRoot}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  devServerManager = new DevServerManager(workspaceRoot);

  // Create StateHub and PanelRouter for cross-panel coordination
  stateHub = new StateHub();
  panelRouter = new PanelRouter({
    workspaceRoot,
    stateHub,
    context,
  });

  // Create preview panel instance
  previewPanel = new PreviewPanel(context.extensionUri, workspaceRoot, stateHub, panelRouter, context);

  // Register serializer for cross-restart persistence
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(PreviewPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        previewPanel?.restorePanel(panel);
      },
    }),
  );

  // Register Logs panel (bottom panel)
  logsProvider = new LogsPanelProvider(context.extensionUri, workspaceRoot, context);

  // Register AI Chat panel (secondary sidebar)
  aiChatProvider = new AIChatPanelProvider(context.extensionUri, workspaceRoot, context, stateHub);

  // Wire ai:openChat from any panel → AI Chat panel
  panelRouter.setOnOpenAIChat((prompt) => {
    aiChatProvider?.sendAIPrompt(prompt);
  });

  // Wire ai:openChat from Logs panel → AI Chat panel
  logsProvider.setOnOpenAIChat((prompt) => {
    aiChatProvider?.sendAIPrompt(prompt);
  });

  // Read package.json once and run all detectors against it
  readPackageJson(workspaceRoot)
    .then(async (pkg) => {
      const kit = await detectUIKit(workspaceRoot, pkg);
      stateHub?.applyUpdate({ projectUIKit: kit });

      const cssSystem = await detectCssSystem(workspaceRoot, pkg);
      const projectType = await detectProjectType(workspaceRoot);
      const projectError = await detectUnsupportedProject(workspaceRoot, pkg);

      const capabilities = computeCapabilities(cssSystem, kit, projectError, projectType);
      console.log('[HyperIDE] Project capabilities:', JSON.stringify(capabilities));

      // Send capabilities to preview panel (readonly badge, style write guard)
      previewPanel?.notifyCapabilities(capabilities);

      // Send capabilities to inspector panel (readonly inputs)
      rightPanelProvider?.notifyCapabilities(capabilities);

      // Legacy: still send projectError for unsupported-project screen
      if (projectError) {
        console.log('[HyperIDE] Unsupported project detected:', projectError.type);
        previewPanel?.notifyUnsupportedProject(projectError);
      }
    })
    .catch((err) => {
      console.warn('[HyperIDE] Failed to detect project info:', err);
    });

  // Flush .hyperide/ to disk on first component open (deferred write).
  // Only unsubscribe after flush actually writes — scan may still be in progress.
  const unsubFlush = stateHub.onChange((_state, patch) => {
    if (patch.currentComponent) {
      panelRouter
        ?.flushStructureStore()
        .then((flushed) => {
          if (flushed) unsubFlush();
        })
        .catch((err) => {
          console.error('[HyperIDE] Failed to flush structure store:', err);
        });
    }
  });

  // Create DiagnosticHub for centralized diagnostic data
  diagnosticHub = new DiagnosticHub(context.globalStorageUri.fsPath);
  diagnosticHub.init().catch((err) => {
    console.error('[HyperIDE] Failed to init DiagnosticHub:', err);
  });

  // Wire DiagnosticHub to logs panel and AI chat
  logsProvider.setDiagnosticHub(diagnosticHub);
  aiChatProvider.setDiagnosticHub(diagnosticHub);

  if (devServerManager) {
    aiChatProvider.setDevServerManager(devServerManager);

    // Feed DiagnosticHub from DevServerManager (without overwriting single-callback APIs)
    devServerManager.onLogsUpdate((logs) => {
      diagnosticHub?.pushServerLogs(logs);
    });

    devServerManager.onStatusChange((state) => {
      const statusMap: Record<string, 'building' | 'ready' | 'error' | 'idle'> = {
        starting: 'building',
        running: 'ready',
        error: 'error',
        stopped: 'idle',
      };
      diagnosticHub?.setBuildStatus(statusMap[state.status] ?? 'idle');

      // Notify preview panel when dev server stops so the status badge updates
      if (state.status === 'stopped' || state.status === 'error') {
        previewPanel?.notifyDevServerStopped();
      }
    });

    // Wire runtime errors from preview iframe to dev server manager + diagnostic hub
    previewPanel.onRuntimeError((error) => {
      devServerManager?.setRuntimeError(error ?? null);
      diagnosticHub?.setRuntimeError(error ?? null);
    });

    // Wire console capture from preview iframe to diagnostic hub
    previewPanel.onConsoleCapture((entries) => {
      diagnosticHub?.handleConsoleCapture(entries);
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LogsPanelProvider.viewType, logsProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AIChatPanelProvider.viewType, aiChatProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Deterministic preview file manager (no AI, no network)
  const vsCodeIO = new VSCodeFileIO();
  const providerWrapPromise = detectPreviewProviders(workspaceRoot);
  const previewManager = new PreviewFileManager({
    projectRoot: workspaceRoot,
    io: vsCodeIO,
  });
  // Provider detection runs async; ensureComponent/rebuild will await it before generating
  previewManager.setProviderWrapAsync(providerWrapPromise);

  // Mode manager: orchestrates App Shell ↔ Isolated transitions via FSWatch
  const modeManager = new PreviewModeManager({
    projectRoot: workspaceRoot,
    io: vsCodeIO,
    onModeChange: (isolated) => {
      devServerManager?.setIsolatedMode(isolated);
      previewPanel?.setPreviewScope(isolated ? 'component-only' : 'full-app');
      // Force iframe reload on every mode change.
      // App Shell ↔ Isolated transitions swap what the proxy serves at the same URL.
      // HMR alone is unreliable across entry-point boundaries — a hard reload ensures
      // the iframe fetches fresh content from the proxy in its new mode.
      previewPanel?.refresh();
    },
  });
  modeManager.startWatching();
  context.subscriptions.push({ dispose: () => modeManager.stopWatching() });

  // Handle scope toggle from toolbar: write or delete .hyperide/preview.tsx
  previewPanel.setScopeChangeHandler(async (scope) => {
    const wrapperPath = join(workspaceRoot, '.hyperide/preview.tsx');
    if (scope === 'component-only') {
      // Check if wrapper already exists (user may have written it manually)
      const exists = await vsCodeIO
        .access(wrapperPath)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        const content = await generatePreviewWrapper(workspaceRoot, context);
        if (content) {
          await writePreviewWrapper(workspaceRoot, content);
          // FSWatch picks up the file and calls modeManager.onWrapperCreated() → setIsolatedMode(true)
        } else {
          void vscode.window.showInformationMessage(
            'HyperIDE: configure an AI key to auto-generate .hyperide/preview.tsx, or create it manually.',
          );
        }
      }
      // If file already exists, FSWatch already triggered isolated mode
    } else {
      // Switch back to App Shell: delete the wrapper
      await vsCodeIO.deleteFile?.(wrapperPath);
      // FSWatch picks up deletion → modeManager.onWrapperDeleted() → setIsolatedMode(false)
    }
  });

  // AI-powered sample generator (uses extension's API key config)
  const sampleGenerator = createExtensionSampleGenerator(context);

  // Auto-inject UUIDs and parse component structure when currentComponent changes.
  // Serial queue prevents race conditions on rapid component switching:
  // each new switch cancels the previous ensureSample/ensureComponent chain.
  let previewAbortController: AbortController | null = null;

  const unsubStateChange = stateHub.onChange((_state, patch) => {
    if (patch.currentComponent?.path) {
      const componentPath = patch.currentComponent.path;
      const componentName = patch.currentComponent.name;

      // Auto-open Preview Panel if not already visible
      previewPanel?.createOrShow(vscode.ViewColumn.Beside);

      // Open the component file in the left editor group (ViewColumn.One)
      // so the user can see the code alongside the preview.
      // Uses preview mode (italic tab) — consistent with single-click Explorer UX.
      const absPath = isAbsolute(componentPath) ? componentPath : join(workspaceRoot, componentPath);
      vscode.workspace.openTextDocument(vscode.Uri.file(absPath)).then(
        (doc) =>
          vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: true,
            preview: true,
          }),
        (err) => console.error('[HyperIDE] Failed to open component file:', err),
      );

      // Parse component structure
      panelRouter?.componentService
        .parseStructure(componentPath)
        .then((structure) => {
          stateHub?.applyUpdate({ astStructure: structure });
        })
        .catch((err) => {
          console.error('[HyperIDE] Failed to inject UUIDs / parse structure:', err);
        });

      // Cancel previous ensureSample/ensureComponent chain
      previewAbortController?.abort();
      const ac = new AbortController();
      previewAbortController = ac;

      // Normalize: currentComponent.path may be relative or absolute
      const absComponentPath = isAbsolute(componentPath) ? componentPath : join(workspaceRoot, componentPath);

      // Skip source-file mutation entirely when the harness disables it.
      // E2E tests set hypercanvas.preview.autoSampleGeneration=false so
      // ensureSample / ensureDefaultSampleForNoProps don't write SampleDefault
      // into the test project's component files — otherwise `git checkout -- .`
      // between specs drops the export, Vite reports "export removed", forces
      // a full reload, and __canvas_preview__.tsx fails to reload mid-transition.
      const autoSampleEnabled = vscode.workspace
        .getConfiguration('hypercanvas.preview')
        .get<boolean>('autoSampleGeneration', true);

      const ensureSamplePromise = autoSampleEnabled
        ? ensureSample({
            io: vsCodeIO,
            absolutePath: absComponentPath,
            componentName,
            sampleName: 'SampleDefault',
            generate: sampleGenerator,
          })
        : Promise.resolve({ generated: false, exists: false });

      ensureSamplePromise
        .then(async (sampleResult) => {
          if (ac.signal.aborted) return;
          const props = await panelRouter?.componentService.getComponentDefinitions(componentPath);
          if (previewPanel && shouldCreateNoPropsSample(sampleResult, props)) {
            await previewPanel.ensureDefaultSampleForNoProps(componentPath, componentName);
          }
          // 2. Ensure component is registered in __canvas_preview__.tsx (deterministic)
          const relativePath = relative(workspaceRoot, absComponentPath);
          return previewManager.ensureComponent([relativePath]);
        })
        .then(async () => {
          if (ac.signal.aborted) return 'aborted' as const;
          // 3. Ensure route files + handle mode transitions (App Shell / Isolated)
          const result = await modeManager.onComponentSelected();
          if (result === 'unsupported') {
            // SYNC: shared/framework-support.ts → FRAMEWORK_SUPPORT
            void vscode.window.showWarningMessage(
              'HyperIDE: unsupported project type. ' +
                'Supported: Next.js, Remix, Vite (file-based and JSX router), Webpack/CRA, Parcel.',
            );
            return 'unsupported' as const;
          }
          if (result === 'needs-patch') {
            void vscode.window
              .showWarningMessage(
                'HyperIDE: JSX router detected but no /test-preview route found. ' +
                  'Add the route manually or let AI do it.',
                'Auto fix',
                'Dismiss',
              )
              .then(async (choice) => {
                if (choice === 'Auto fix') {
                  const prompt = await buildNeedsPatchPrompt(workspaceRoot, vsCodeIO);
                  aiChatProvider?.sendAIPrompt(prompt);
                }
              });
            return 'needs-patch' as const;
          }
          return result;
        })
        .then((result) => {
          if (ac.signal.aborted || result === 'aborted' || result === 'unsupported' || result === 'needs-patch') return;
          // 4. Update iframe component URL param — no hard reload needed
          const relativePath = relative(workspaceRoot, absComponentPath);
          previewPanel?.setComponentParam(relativePath);
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          console.error('[HyperIDE] Failed to ensure sample/preview:', err);
        });
    }
  });
  context.subscriptions.push({ dispose: unsubStateChange });

  // Auto-reveal Inspector when component insertion UI opens
  const unsubInsertReveal = stateHub.onChange((_state, patch) => {
    if (patch.insertTargetId) {
      vscode.commands.executeCommand('hypercanvas.inspectorView.focus');
    }
  });
  context.subscriptions.push({ dispose: unsubInsertReveal });

  // Register Left Panel (Activity Bar explorer)
  leftPanelProvider = new LeftPanelProvider(context.extensionUri, stateHub, panelRouter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LeftPanelProvider.viewType, leftPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register Right Panel (Inspector) — receives leftPanelProvider for component list fallback
  const pr = panelRouter;
  rightPanelProvider = new RightPanelProvider(context.extensionUri, stateHub, panelRouter, leftPanelProvider, () =>
    pr.getComponentGroups(),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RightPanelProvider.viewType, rightPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands
  registerCommands(context, workspaceRoot);

  // --- MCP Server for AI Agents ---
  const astService = panelRouter.astBridge.astService;
  const componentService = panelRouter.componentService;

  mcpServer = new HyperMcpServer({
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

  mcpServer
    .start()
    .then((port) => {
      // Auto-update existing MCP config files with new port
      autoUpdateMcpConfigs(workspaceRoot, port);

      // Register with VS Code Copilot (VS Code 1.99+)
      registerCopilotMcp(context, port);

      // Show MCP status bar
      mcpStatusBarItem.text = '$(plug) Hyper MCP';
      mcpStatusBarItem.tooltip = `HyperCanvas MCP: http://127.0.0.1:${port}/mcp\nClick to configure AI agents`;
      mcpStatusBarItem.show();

      // One-time notification for MCP discoverability
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

  context.subscriptions.push({ dispose: () => mcpServer?.dispose() });

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(eye) Hyper Canvas';
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

  console.log('[HyperIDE] Extension activated successfully');
}

export async function deactivate() {
  console.log('[HyperIDE] Extension deactivating...');

  // Flush deferred .hyperide writes before teardown
  if (panelRouter) {
    await panelRouter.flushStructureStore().catch((err) => {
      console.error('[HyperIDE] Failed to flush structure store on deactivate:', err);
    });
  }

  // Stop dev server if running
  if (devServerManager) {
    devServerManager.dispose();
    devServerManager = null;
  }

  if (mcpServer) {
    mcpServer.dispose();
    mcpServer = null;
  }

  if (panelRouter) {
    panelRouter.dispose();
    panelRouter = null;
  }

  if (diagnosticHub) {
    diagnosticHub.dispose();
    diagnosticHub = null;
  }

  if (stateHub) {
    stateHub.dispose();
    stateHub = null;
  }

  console.log('[HyperIDE] Extension deactivated');
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

  // Open Logs
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openLogs', () => {
      vscode.commands.executeCommand('hypercanvas.logsView.focus');
    }),
  );

  // Open AI Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openAIChat', () => {
      vscode.commands.executeCommand('hypercanvas.aiChatView.focus');
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

  // Close preview panel (disposes the webview, clearing all iframe state)
  // AND reset every sidebar webview's HTML so React state (tree expand,
  // selection, click handlers, source-map caches in the preview iframe)
  // doesn't leak between tests. We used to also reset all sidebar
  // webviews here, but that wedged the AI Chat panel on the next test:
  // reset()'s html reassign on a HIDDEN webview (because the sidebar
  // was collapsed or pointing elsewhere at the moment closePreview ran)
  // left the webview with freshly-written HTML that never got a chance
  // to boot React — the next `Hyper: Open AI Chat` showed an empty
  // iframe and E2E polls for `hyper-aichat-root` timed out with
  // "Webviews: 0, available testIds: []". Leaving sidebar state alone
  // is fine: their React reducers are idempotent across mode switches,
  // and the per-test git checkout + command palette reopens give us
  // enough isolation for cross-test stability.
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.closePreview', async () => {
      previewPanel?.dispose();
    }),
  );

  // Canvas keybinding commands (VS Code intercepts keys before they reach the webview iframe)
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.canvasUndo', () => previewPanel?.undo()),
    vscode.commands.registerCommand('hypercanvas.canvasRedo', () => previewPanel?.redo()),
    vscode.commands.registerCommand('hypercanvas.canvasDelete', () => previewPanel?.deleteSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasDuplicate', () => previewPanel?.duplicateSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasWrap', () => previewPanel?.wrapSelected()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectChildren', () => previewPanel?.selectChildren()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectParent', () => previewPanel?.selectParent()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectNextSibling', () => previewPanel?.selectNextSibling()),
    vscode.commands.registerCommand('hypercanvas.canvasSelectPrevSibling', () => previewPanel?.selectPrevSibling()),
    vscode.commands.registerCommand('hypercanvas.canvasEscape', () => previewPanel?.clearSelection()),
    vscode.commands.registerCommand('hypercanvas.selectElement', (elementId: string) => {
      previewPanel?.selectElement(elementId);
    }),
    vscode.commands.registerCommand('hypercanvas.selectElements', (elementIds: string[]) => {
      previewPanel?.selectElements(elementIds);
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

      if (result?.nodeRef) {
        previewPanel?.sendGoToVisual(result.nodeRef);
      } else {
        vscode.window.showWarningMessage('No element found at cursor position');
      }
    }),
  );

  // Start dev server
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.startDevServer', async () => {
      console.log('[HyperIDE] startDevServer command triggered');

      if (!devServerManager) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'HyperIDE: Starting dev server...',
          cancellable: false,
        },
        async () => {
          if (!devServerManager) return;
          const state = await devServerManager.start();
          console.log('[HyperIDE] Dev server state:', state.status, state.url);

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

  // Fix unsupported project — installs react-native-web + Vite config for React Native / Tamagui projects
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.fixUnsupportedProject', async () => {
      const pkgManager = await detectPackageManager(workspaceRoot);
      const installCmd =
        pkgManager === 'bun'
          ? 'bun add'
          : pkgManager === 'yarn'
            ? 'yarn add'
            : pkgManager === 'pnpm'
              ? 'pnpm add'
              : 'npm install';
      const devInstallCmd =
        pkgManager === 'bun'
          ? 'bun add -d'
          : pkgManager === 'yarn'
            ? 'yarn add -D'
            : pkgManager === 'pnpm'
              ? 'pnpm add -D'
              : 'npm install -D';

      // Detect if this is a Next.js project
      let isNextJs = false;
      try {
        const pkgRaw = await readFile(join(workspaceRoot, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgRaw);
        isNextJs = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
      } catch {
        // Can't read package.json — fall through to Vite path
      }

      // Detect Tamagui One projects (use `one()` Vite plugin / `one dev`)
      let isTamaguiOne = false;
      if (!isNextJs) {
        try {
          const viteRaw = await readFile(join(workspaceRoot, 'vite.config.ts'), 'utf-8');
          isTamaguiOne =
            /\bone\s*\(/.test(viteRaw) || viteRaw.includes("from 'one/vite'") || viteRaw.includes('from "one/vite"');
        } catch {
          // No vite.config.ts — not a One project
        }
      }

      try {
        if (isNextJs) {
          // ── Next.js + Tamagui path ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Setting up react-native-web for Next.js via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              // Step 1: Install react-native-web as a dependency (no Vite needed)
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: workspaceRoot, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 2: Create or patch next.config
              progress.report({ message: 'Configuring Next.js for Tamagui...' });

              // Find existing next.config file (ts > mjs > js)
              const configVariants = ['next.config.ts', 'next.config.mjs', 'next.config.js'] as const;
              let existingConfigPath: string | null = null;
              let existingConfigContent = '';
              for (const variant of configVariants) {
                const candidate = join(workspaceRoot, variant);
                try {
                  existingConfigContent = await readFile(candidate, 'utf-8');
                  existingConfigPath = candidate;
                  break;
                } catch {
                  // Try next variant
                }
              }

              const targetConfigPath = existingConfigPath ?? join(workspaceRoot, 'next.config.ts');
              const isTypeScript = targetConfigPath.endsWith('.ts');

              // Check if config already has tamagui transpilePackages and turbo alias
              const hasTranspile =
                existingConfigContent.includes('react-native-web') &&
                existingConfigContent.includes('transpilePackages');
              const hasTurboAlias =
                existingConfigContent.includes('resolveAlias') && existingConfigContent.includes('react-native-web');

              if (!hasTranspile || !hasTurboAlias) {
                // Generate a fresh config — patching arbitrary user configs is fragile,
                // so we only overwrite if the critical pieces are missing.
                const configLines: string[] = [];
                if (isTypeScript) {
                  configLines.push("import type { NextConfig } from 'next';");
                  configLines.push('');
                  configLines.push('const nextConfig: NextConfig = {');
                } else {
                  configLines.push('/** @type {import("next").NextConfig} */');
                  configLines.push('const nextConfig = {');
                }
                configLines.push(
                  "  transpilePackages: ['react-native', 'react-native-web', 'tamagui', '@tamagui/config'],",
                );
                configLines.push('  experimental: {');
                configLines.push('    turbo: {');
                configLines.push('      resolveAlias: {');
                configLines.push("        'react-native': 'react-native-web',");
                configLines.push('      },');
                configLines.push('      resolveExtensions: [');
                configLines.push("        '.web.tsx',");
                configLines.push("        '.web.ts',");
                configLines.push("        '.web.jsx',");
                configLines.push("        '.web.js',");
                configLines.push("        '.tsx',");
                configLines.push("        '.ts',");
                configLines.push("        '.jsx',");
                configLines.push("        '.js',");
                configLines.push("        '.json',");
                configLines.push('      ],');
                configLines.push('    },');
                configLines.push('  },');
                configLines.push('};');
                configLines.push('');
                if (isTypeScript || targetConfigPath.endsWith('.mjs')) {
                  configLines.push('export default nextConfig;');
                } else {
                  configLines.push('module.exports = nextConfig;');
                }
                configLines.push('');
                await writeFile(targetConfigPath, configLines.join('\n'), 'utf-8');
              }
            },
          );
        } else if (isTamaguiOne) {
          // ── Tamagui One path — already has Vite via one(), just needs react-native-web ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Installing react-native-web for Tamagui One via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: workspaceRoot, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            },
          );
        } else {
          // ── Vite + Tamagui path (existing logic) ──
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `HyperIDE: Setting up react-native-web + Vite via ${pkgManager}...`,
              cancellable: false,
            },
            async (progress) => {
              // Step 1: Install react-native-web as a dependency
              progress.report({ message: 'Installing react-native-web...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${installCmd} react-native-web`.split(' ');
                execFile(cmd, args, { cwd: workspaceRoot, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 2: Install Vite toolchain as devDependencies
              progress.report({ message: 'Installing vite + plugins...' });
              await new Promise<void>((resolve, reject) => {
                const [cmd, ...args] = `${devInstallCmd} vite @vitejs/plugin-react @tamagui/vite-plugin`.split(' ');
                execFile(cmd, args, { cwd: workspaceRoot, shell: process.platform === 'win32' }, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              // Step 3: Create or patch vite.config.ts
              // If the file exists but doesn't have tamaguiPlugin / react-native-web
              // alias, overwrite it — a bare vite.config without these won't work
              // for Tamagui web builds.
              progress.report({ message: 'Configuring Vite for Tamagui...' });
              const viteConfigPath = join(workspaceRoot, 'vite.config.ts');
              let existingViteConfig = '';
              try {
                existingViteConfig = await readFile(viteConfigPath, 'utf-8');
              } catch {
                // File doesn't exist
              }
              // Never overwrite a Tamagui One vite config (uses one() plugin)
              const isOneConfig =
                /\bone\s*\(/.test(existingViteConfig) ||
                existingViteConfig.includes("from 'one/vite'") ||
                existingViteConfig.includes('from "one/vite"');
              const needsViteConfig =
                !isOneConfig &&
                (!existingViteConfig ||
                  !existingViteConfig.includes('tamaguiPlugin') ||
                  !existingViteConfig.includes('react-native-web'));
              if (needsViteConfig) {
                // Create stub files for deep react-native imports that rolldown can't resolve
                const stubsDir = join(workspaceRoot, 'src', 'stubs');
                await mkdir(stubsDir, { recursive: true });
                const codegenStub = join(stubsDir, 'codegenNativeComponent.ts');
                const appContainerStub = join(stubsDir, 'AppContainer.tsx');
                try {
                  await readFile(codegenStub);
                } catch {
                  await writeFile(
                    codegenStub,
                    'export default function codegenNativeComponent<P>(_name: string) {\n  return (_props: P) => null;\n}\n',
                    'utf-8',
                  );
                }
                try {
                  await readFile(appContainerStub);
                } catch {
                  await writeFile(
                    appContainerStub,
                    'import React from "react";\nexport default function AppContainer({ children }: { children: React.ReactNode }) {\n  return <>{children}</>;\n}\n',
                    'utf-8',
                  );
                }

                const viteConfigContent = [
                  "import path from 'path'",
                  "import { tamaguiPlugin } from '@tamagui/vite-plugin'",
                  "import react from '@vitejs/plugin-react'",
                  "import { defineConfig } from 'vite'",
                  '',
                  'export default defineConfig({',
                  '  plugins: [',
                  '    react(),',
                  '    tamaguiPlugin({',
                  "      components: ['tamagui'],",
                  '    }),',
                  '  ],',
                  '  resolve: {',
                  "    extensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],",
                  '    alias: {',
                  "      'react-native': 'react-native-web',",
                  "      'react-native/Libraries/Utilities/codegenNativeComponent': path.resolve(__dirname, 'src/stubs/codegenNativeComponent.ts'),",
                  "      'react-native/Libraries/ReactNative/AppContainer': path.resolve(__dirname, 'src/stubs/AppContainer.tsx'),",
                  '    },',
                  '  },',
                  '  optimizeDeps: {',
                  "    include: ['react-native-web', 'warn-once'],",
                  "    exclude: ['react-native-safe-area-context', 'react-native-screens'],",
                  '  },',
                  '})',
                  '',
                ].join('\n');
                await writeFile(viteConfigPath, viteConfigContent, 'utf-8');
              }

              // Step 4: Create index.html if it doesn't exist
              const indexHtmlPath = join(workspaceRoot, 'index.html');
              let indexHtmlExists = false;
              try {
                await readFile(indexHtmlPath);
                indexHtmlExists = true;
              } catch {
                // File doesn't exist — will create it
              }
              if (!indexHtmlExists) {
                const indexHtmlContent = [
                  '<!DOCTYPE html>',
                  '<html lang="en">',
                  '<head>',
                  '  <meta charset="UTF-8">',
                  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
                  '  <title>App</title>',
                  '</head>',
                  '<body>',
                  '  <div id="root"></div>',
                  '  <script type="module" src="/src/main.tsx"></script>',
                  '</body>',
                  '</html>',
                  '',
                ].join('\n');
                await writeFile(indexHtmlPath, indexHtmlContent, 'utf-8');
              }

              // Step 5: Update package.json scripts — set "dev": "vite" if currently using expo/metro
              progress.report({ message: 'Updating package.json scripts...' });
              try {
                const pkgJsonPath = join(workspaceRoot, 'package.json');
                const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
                const pkg = JSON.parse(pkgRaw);
                const scripts = (pkg.scripts ?? {}) as Record<string, string>;
                const currentDev = scripts.dev ?? '';
                // Replace expo-based or missing dev script with vite
                // Never replace `one dev` — Tamagui One projects use their own Vite wrapper
                if ((!currentDev || currentDev.includes('expo')) && !currentDev.includes('one ')) {
                  scripts.dev = 'vite';
                  pkg.scripts = scripts;
                  await writeFile(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
                }
              } catch {
                // Non-critical — user can set the script manually
              }

              // Step 6: Create App.web.tsx — web entry without native navigation stack
              // Keeps SafeAreaProvider + NavigationContainer (both work on web via react-native-web)
              // but replaces native-stack navigator with direct screen render.
              progress.report({ message: 'Creating web entry point...' });
              try {
                const appPath = join(workspaceRoot, 'App.tsx');
                const appContent = await readFile(appPath, 'utf-8');
                const hasNativeImports = /expo-status-bar|@react-navigation\/native-stack|react-native-screens/.test(
                  appContent,
                );
                if (hasNativeImports) {
                  // Find tamagui config import
                  const cfgMatch = appContent.match(
                    /import\s+(?:\{\s*(\w+)\s*\}|(\w+))\s+from\s+['"]([^'"]*tamagui\.config[^'"]*)['"]/,
                  );
                  const cfgVar = cfgMatch?.[1] || cfgMatch?.[2] || 'config';
                  const cfgPath = cfgMatch?.[3] || './src/theme/tamagui.config';
                  const cfgIsNamed = !!cfgMatch?.[1];
                  // Find default theme
                  const themeMatch = appContent.match(/defaultTheme=["'](\w+)["']/);
                  const theme = themeMatch?.[1] || 'dark';

                  // Find first screen in src/screens/
                  let screenName = 'HomeScreen';
                  try {
                    const files = await readdir(join(workspaceRoot, 'src', 'screens'));
                    const home = files.find((f) => /^HomeScreen\.(tsx|jsx)$/.test(f));
                    const feed = files.find((f) => /^FeedScreen\.(tsx|jsx)$/.test(f));
                    const chat = files.find((f) => /^ChatListScreen\.(tsx|jsx)$/.test(f));
                    const any = files.find((f) => /Screen\.(tsx|jsx)$/.test(f));
                    const chosen = home || feed || chat || any;
                    if (chosen) screenName = chosen.replace(/\.(tsx|jsx)$/, '');
                  } catch {
                    /* no screens dir — use default */
                  }

                  // Check if screen uses useNavigation hook
                  let needsNavContainer = false;
                  try {
                    const screenSrc = await readFile(
                      join(workspaceRoot, 'src', 'screens', `${screenName}.tsx`),
                      'utf-8',
                    );
                    needsNavContainer = /useNavigation\s*[<(]/.test(screenSrc);
                  } catch {
                    /* can't read screen — skip nav container */
                  }

                  // Detect extra context providers (e.g., CartProvider)
                  const extraProviders: Array<{ importLine: string; name: string }> = [];
                  const cartMatch = appContent.match(/import\s+\{\s*CartProvider\s*\}\s+from\s+['"]([^'"]+)['"]/);
                  if (cartMatch) {
                    extraProviders.push({
                      importLine: `import { CartProvider } from "${cartMatch[1]}";`,
                      name: 'CartProvider',
                    });
                  }

                  // Build App.web.tsx
                  const lines: string[] = [
                    'import React from "react";',
                    'import { TamaguiProvider } from "tamagui";',
                    'import { SafeAreaProvider } from "react-native-safe-area-context";',
                  ];
                  if (needsNavContainer) {
                    lines.push('import { NavigationContainer } from "@react-navigation/native";');
                  }
                  lines.push(
                    cfgIsNamed ? `import { ${cfgVar} } from "${cfgPath}";` : `import ${cfgVar} from "${cfgPath}";`,
                  );
                  for (const ep of extraProviders) lines.push(ep.importLine);
                  lines.push(`import { ${screenName} } from "./src/screens/${screenName}";`);
                  lines.push('');
                  lines.push('export default function App() {');
                  lines.push('  return (');

                  // Build provider nesting
                  let depth = 2;
                  const pad = (d: number) => '  '.repeat(d);
                  lines.push(`${pad(depth)}<SafeAreaProvider>`);
                  depth++;
                  if (needsNavContainer) {
                    lines.push(`${pad(depth)}<NavigationContainer>`);
                    depth++;
                  }
                  lines.push(`${pad(depth)}<TamaguiProvider config={${cfgVar}} defaultTheme="${theme}">`);
                  depth++;
                  for (const ep of extraProviders) {
                    lines.push(`${pad(depth)}<${ep.name}>`);
                    depth++;
                  }
                  lines.push(`${pad(depth)}<${screenName} />`);
                  for (const ep of [...extraProviders].reverse()) {
                    depth--;
                    lines.push(`${pad(depth)}</${ep.name}>`);
                  }
                  depth--;
                  lines.push(`${pad(depth)}</TamaguiProvider>`);
                  if (needsNavContainer) {
                    depth--;
                    lines.push(`${pad(depth)}</NavigationContainer>`);
                  }
                  depth--;
                  lines.push(`${pad(depth)}</SafeAreaProvider>`);
                  lines.push('  );');
                  lines.push('}');
                  lines.push('');

                  await writeFile(join(workspaceRoot, 'App.web.tsx'), lines.join('\n'), 'utf-8');
                }
              } catch {
                // App.tsx doesn't exist or can't be read — skip
              }
            },
          );
        }
        // Re-check to confirm the package was recorded in package.json
        const stillUnsupported = await detectUnsupportedProject(workspaceRoot);
        if (stillUnsupported) {
          vscode.window.showWarningMessage(
            'HyperIDE: react-native-web may not have been added to package.json. Try running the install manually.',
          );
        } else {
          const successMsg = isNextJs
            ? 'react-native-web + Next.js configured. Run "dev" to start the Next.js dev server.'
            : isTamaguiOne
              ? 'react-native-web installed. Restart `one dev` to apply.'
              : 'react-native-web + Vite configured. Run "dev" to start the Vite dev server.';
          vscode.window.showInformationMessage(successMsg);
          previewPanel?.notifyUnsupportedProject(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`HyperIDE: Failed to set up project: ${msg}`);
      }
    }),
  );

  // Configure AI API key — multi-step wizard
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.configureAIKey', async () => {
      // ── Step 1: Choose provider ──
      const config = vscode.workspace.getConfiguration('hypercanvas.ai');
      const currentProvider = config.get<string>('provider', 'glm') as AIProvider;
      const plansLine = GLM_RECOMMENDATION.plans.map((p) => `${p.name} ${p.price}`).join(' \u00b7 ');

      interface ProviderItem extends vscode.QuickPickItem {
        providerId: AIProvider | 'settings';
      }

      const providerItems: ProviderItem[] = [
        {
          label: `$(star-full) ${PROVIDER_LABELS.glm}`,
          detail: `${GLM_RECOMMENDATION.description} ${plansLine}`,
          description: currentProvider === 'glm' ? 'current' : '',
          providerId: 'glm',
        },
        {
          label: PROVIDER_LABELS.claude,
          detail: 'Per-token pricing via Anthropic API',
          description: currentProvider === 'claude' ? 'current' : '',
          providerId: 'claude',
        },
        {
          label: PROVIDER_LABELS.openai,
          detail: 'GPT-4o and OpenAI-compatible APIs',
          description: currentProvider === 'openai' ? 'current' : '',
          providerId: 'openai',
        },
        {
          label: '$(gear) Other providers (Gemini, DeepSeek, Mistral, Qwen...)',
          detail: 'Opens AI Settings to pick provider, model, and backend',
          providerId: 'settings',
        },
      ];

      const pickedProvider = await vscode.window.showQuickPick(providerItems, {
        title: 'Hyper: Configure AI (Step 1/2) — Choose Provider',
        placeHolder: 'Which AI provider do you want to use?',
      });

      if (!pickedProvider) return;

      if (pickedProvider.providerId === 'settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'hypercanvas.ai');
        return;
      }

      const selectedProvider = pickedProvider.providerId;
      const defaults = AI_PROVIDER_DEFAULTS[selectedProvider];
      const providerLabel = PROVIDER_LABELS[selectedProvider];

      // Apply provider + defaults to settings
      if (selectedProvider !== currentProvider) {
        await config.update('provider', selectedProvider, vscode.ConfigurationTarget.Global);
        await config.update('model', defaults.model, vscode.ConfigurationTarget.Global);
        await config.update('baseURL', defaults.baseURL ?? undefined, vscode.ConfigurationTarget.Global);
      }

      // ── Step 2: Enter key or get one ──
      const keyUrl = PROVIDER_KEY_URLS[selectedProvider];

      interface ActionItem extends vscode.QuickPickItem {
        action: 'enter' | 'get-key';
      }

      const actionItems: ActionItem[] = [
        {
          label: `$(key) Enter API key for ${providerLabel}`,
          detail: `model=${defaults.model}`,
          action: 'enter',
        },
      ];

      if (keyUrl) {
        actionItems.push({
          label: `$(link-external) Get API key from ${keyUrl.label}`,
          detail: keyUrl.url,
          action: 'get-key',
        });
      }

      const pickedAction = await vscode.window.showQuickPick(actionItems, {
        title: 'Hyper: Configure AI (Step 2/2) — API Key',
        placeHolder: `Provider: ${providerLabel}`,
      });

      if (!pickedAction) return;

      if (pickedAction.action === 'get-key' && keyUrl) {
        vscode.env.openExternal(vscode.Uri.parse(keyUrl.url));
        return;
      }

      // ── Input key ──
      const key = await vscode.window.showInputBox({
        title: `${providerLabel} API Key`,
        prompt: `Enter ${providerLabel} API key (will be stored in OS keychain)`,
        password: true,
      });

      if (key !== undefined) {
        if (key) {
          await context.secrets.store('hypercanvas.ai.apiKey', key);
          vscode.window.showInformationMessage(`${providerLabel} API key saved.`);
        } else {
          await context.secrets.delete('hypercanvas.ai.apiKey');
          vscode.window.showInformationMessage('AI API key removed.');
        }
      }
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

  // Setup MCP for AI agents (Copilot, Claude Code, Codex, OpenCode)
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.setupMcp', async () => {
      if (!mcpServer || mcpServer.port === 0) {
        vscode.window.showErrorMessage('HyperCanvas MCP server is not running');
        return;
      }

      // Step 1: Choose AI agents — pre-check already configured ones
      interface AgentItem extends vscode.QuickPickItem {
        agentId: 'copilot' | 'claude-code' | 'codex' | 'opencode';
      }

      const configured = await detectConfiguredAgents(workspaceRoot);

      const agents: AgentItem[] = [
        {
          label: 'VS Code Copilot',
          detail: 'Write .vscode/mcp.json — auto-discovered by GitHub Copilot',
          agentId: 'copilot',
          picked: configured.copilot,
        },
        {
          label: 'Claude Code',
          detail: 'Write .mcp.json — auto-discovered by Claude Code CLI',
          agentId: 'claude-code',
          picked: configured.claudeCode,
        },
        {
          label: 'Codex',
          detail: 'Write .codex/config.toml — auto-discovered by OpenAI Codex CLI',
          agentId: 'codex',
          picked: configured.codex,
        },
        {
          label: 'OpenCode',
          detail: 'Write opencode.json — auto-discovered by OpenCode CLI',
          agentId: 'opencode',
          picked: configured.opencode,
        },
      ];

      const picked = await vscode.window.showQuickPick(agents, {
        title: 'Hyper: Setup MCP (Step 1/2) — Choose AI Agents',
        placeHolder: 'Select AI agents to configure (multi-select)',
        canPickMany: true,
      });

      if (!picked || picked.length === 0) return;

      const url = mcpServer.url;

      for (const agent of picked) {
        if (agent.agentId === 'copilot') {
          await writeVsCodeMcpJson(workspaceRoot, url);
        } else if (agent.agentId === 'claude-code') {
          await writeMcpJson(workspaceRoot, url);
        } else if (agent.agentId === 'codex') {
          await writeCodexConfig(workspaceRoot, url);
        } else if (agent.agentId === 'opencode') {
          await writeOpenCodeJson(workspaceRoot, url);
        }
      }

      // Step 2: Companion MCP servers
      interface CompanionItem extends vscode.QuickPickItem {
        companionId: string;
        npxPackage: string;
      }

      const companions: CompanionItem[] = [
        {
          label: 'Playwright MCP',
          detail: 'Browser automation & visual testing — take screenshots, click elements, fill forms',
          companionId: 'playwright',
          npxPackage: '@playwright/mcp@latest',
        },
        {
          label: 'Serena MCP',
          detail: 'Semantic code navigation & refactoring — find symbols, references, rename across codebase',
          companionId: 'serena',
          npxPackage: '@anthropic/serena-mcp@latest',
        },
        {
          label: 'Context7 MCP',
          detail: 'Up-to-date library docs — pulls latest API references for any npm/pip package',
          companionId: 'context7',
          npxPackage: '@upstash/context7-mcp@latest',
        },
      ];

      const pickedCompanions = await vscode.window.showQuickPick(companions, {
        title: 'Hyper: Setup MCP (Step 2/2) — Companion Servers',
        placeHolder: 'These MCP servers work great alongside HyperCanvas (optional)',
        canPickMany: true,
      });

      // Detect browser for Playwright before building configs
      let playwrightExtraArgs: string[] = [];
      const playwrightPicked = (pickedCompanions ?? []).some((c) => c.companionId === 'playwright');
      if (playwrightPicked) {
        const detection = detectBrowserForPlaywright();
        if (detection.found) {
          playwrightExtraArgs = detection.extraArgs;
        } else {
          try {
            await installChromeForPlaywright();
          } catch {
            // Error already shown to user, continue with config writing
          }
        }
      }

      // Write companion servers into the same config files selected in step 1
      const companionConfigs = (pickedCompanions ?? []).map((c) => ({
        id: c.companionId,
        command: 'npx',
        args: ['-y', c.npxPackage, ...(c.companionId === 'playwright' ? playwrightExtraArgs : [])],
      }));

      const agentIds = picked.map((a) => a.agentId);

      if (companionConfigs.length > 0) {
        await writeCompanionServers(workspaceRoot, agentIds, companionConfigs);
      }

      const allNames = [...picked.map((a) => a.label), ...(pickedCompanions ?? []).map((c) => c.label)];
      vscode.window.showInformationMessage(`MCP configured: ${allNames.join(', ')}`);
    }),
  );
}

/**
 * Auto-update existing MCP config files with the new port.
 * Called on every extension activation to keep port in sync.
 */
async function autoUpdateMcpConfigs(workspaceRoot: string, port: number): Promise<void> {
  const url = `http://127.0.0.1:${port}/mcp`;

  // Check and update .mcp.json (Claude Code)
  const mcpJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.mcp.json');
  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.mcpServers?.['hyper-canvas']) {
      config.mcpServers['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated .mcp.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update .vscode/mcp.json (Copilot)
  const vscodeMcpPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.vscode', 'mcp.json');
  try {
    const content = await vscode.workspace.fs.readFile(vscodeMcpPath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.servers?.['hyper-canvas']) {
      config.servers['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(vscodeMcpPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated .vscode/mcp.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update opencode.json
  const opencodePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'opencode.json');
  try {
    const content = await vscode.workspace.fs.readFile(opencodePath);
    const config = JSON.parse(new TextDecoder().decode(content));
    if (config?.mcp?.['hyper-canvas']) {
      config.mcp['hyper-canvas'].url = url;
      await vscode.workspace.fs.writeFile(opencodePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
      console.log('[HyperMCP] Updated opencode.json with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }

  // Check and update .codex/config.toml (Codex)
  const codexConfigPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex', 'config.toml');
  try {
    const content = await vscode.workspace.fs.readFile(codexConfigPath);
    const toml = new TextDecoder().decode(content);
    if (toml.includes('hyper-canvas')) {
      const updated = toml.replace(/url\s*=\s*"http:\/\/127\.0\.0\.1:\d+\/mcp"/, `url = "${url}"`);
      await vscode.workspace.fs.writeFile(codexConfigPath, Buffer.from(updated, 'utf-8'));
      console.log('[HyperMCP] Updated .codex/config.toml with new port');
    }
  } catch {
    // File doesn't exist or no hyper-canvas entry — skip
  }
}

interface ConfiguredAgents {
  copilot: boolean;
  claudeCode: boolean;
  codex: boolean;
  opencode: boolean;
}

async function detectConfiguredAgents(workspaceRoot: string): Promise<ConfiguredAgents> {
  const result: ConfiguredAgents = { copilot: false, claudeCode: false, codex: false, opencode: false };

  const tryRead = async (relativePath: string): Promise<string | null> => {
    try {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePath);
      const content = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(content);
    } catch {
      return null;
    }
  };

  const vscodeMcp = await tryRead('.vscode/mcp.json');
  if (vscodeMcp) {
    try {
      result.copilot = !!JSON.parse(vscodeMcp)?.servers?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  const mcpJson = await tryRead('.mcp.json');
  if (mcpJson) {
    try {
      result.claudeCode = !!JSON.parse(mcpJson)?.mcpServers?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  const codexToml = await tryRead('.codex/config.toml');
  if (codexToml) {
    result.codex = codexToml.includes('hyper-canvas');
  }

  const opencodeJson = await tryRead('opencode.json');
  if (opencodeJson) {
    try {
      result.opencode = !!JSON.parse(opencodeJson)?.mcp?.['hyper-canvas'];
    } catch {
      /* invalid json */
    }
  }

  return result;
}

async function writeVsCodeMcpJson(workspaceRoot: string, url: string): Promise<void> {
  const vscodeDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.vscode');
  try {
    await vscode.workspace.fs.stat(vscodeDir);
  } catch {
    await vscode.workspace.fs.createDirectory(vscodeDir);
  }

  const mcpJsonPath = vscode.Uri.joinPath(vscodeDir, 'mcp.json');
  let config: Record<string, unknown> = { servers: {} };

  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    config = JSON.parse(new TextDecoder().decode(content));
    if (!config.servers) config.servers = {};
  } catch {
    // File doesn't exist — use default
  }

  (config.servers as Record<string, unknown>)['hyper-canvas'] = {
    type: 'http',
    url,
  };

  await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

async function writeMcpJson(workspaceRoot: string, url: string): Promise<void> {
  const mcpJsonPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.mcp.json');
  let config: Record<string, unknown> = { mcpServers: {} };

  try {
    const content = await vscode.workspace.fs.readFile(mcpJsonPath);
    config = JSON.parse(new TextDecoder().decode(content));
    if (!config.mcpServers) config.mcpServers = {};
  } catch {
    // File doesn't exist — use default
  }

  (config.mcpServers as Record<string, unknown>)['hyper-canvas'] = {
    type: 'http',
    url,
  };

  await vscode.workspace.fs.writeFile(mcpJsonPath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

async function writeOpenCodeJson(workspaceRoot: string, url: string): Promise<void> {
  const opencodePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), 'opencode.json');
  let config: Record<string, unknown> = {};

  try {
    const content = await vscode.workspace.fs.readFile(opencodePath);
    config = JSON.parse(new TextDecoder().decode(content));
  } catch {
    // File doesn't exist — use default
  }

  if (!config.mcp) config.mcp = {};
  (config.mcp as Record<string, unknown>)['hyper-canvas'] = {
    type: 'remote',
    url,
  };

  await vscode.workspace.fs.writeFile(opencodePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

async function writeCodexConfig(workspaceRoot: string, url: string): Promise<void> {
  const codexDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex');
  try {
    await vscode.workspace.fs.stat(codexDir);
  } catch {
    await vscode.workspace.fs.createDirectory(codexDir);
  }

  const configPath = vscode.Uri.joinPath(codexDir, 'config.toml');
  let toml = '';

  try {
    const content = await vscode.workspace.fs.readFile(configPath);
    toml = new TextDecoder().decode(content);
  } catch {
    // File doesn't exist — start fresh
  }

  if (toml.includes('[mcp_servers.hyper-canvas]')) {
    // Update existing entry
    toml = toml.replace(/url\s*=\s*"http:\/\/127\.0\.0\.1:\d+\/mcp"/, `url = "${url}"`);
  } else {
    // Append new entry
    const entry = `\n[mcp_servers.hyper-canvas]\ntype = "http"\nurl = "${url}"\n`;
    toml = `${toml.trimEnd()}\n${entry}`;
  }

  await vscode.workspace.fs.writeFile(configPath, Buffer.from(toml, 'utf-8'));
}

async function installChromeForPlaywright(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Installing Chrome for Playwright MCP...',
      cancellable: false,
    },
    () =>
      new Promise<void>((resolve, reject) => {
        const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execFile(npx, ['playwright', 'install', 'chrome'], { timeout: 120_000 }, (error) => {
          if (error) {
            vscode.window.showErrorMessage(
              'Failed to install Chrome for Playwright. Run manually: npx playwright install chrome',
            );
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  );
}

interface CompanionConfig {
  id: string;
  command: string;
  args: string[];
}

async function writeCompanionServers(
  workspaceRoot: string,
  agentIds: Array<'copilot' | 'claude-code' | 'codex' | 'opencode'>,
  companions: CompanionConfig[],
): Promise<void> {
  for (const agentId of agentIds) {
    if (agentId === 'copilot') {
      await mergeStdioServers('.vscode/mcp.json', 'servers', workspaceRoot, companions);
    } else if (agentId === 'claude-code') {
      await mergeStdioServers('.mcp.json', 'mcpServers', workspaceRoot, companions);
    } else if (agentId === 'opencode') {
      await mergeStdioServers('opencode.json', 'mcp', workspaceRoot, companions);
    } else if (agentId === 'codex') {
      await appendCodexCompanions(workspaceRoot, companions);
    }
  }
}

async function mergeStdioServers(
  relativePath: string,
  serversKey: string,
  workspaceRoot: string,
  companions: CompanionConfig[],
): Promise<void> {
  const filePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePath);
  let config: Record<string, Record<string, unknown>> = {};

  try {
    const content = await vscode.workspace.fs.readFile(filePath);
    config = JSON.parse(new TextDecoder().decode(content));
  } catch {
    return; // File should already exist from step 1
  }

  const servers = (config[serversKey] ?? {}) as Record<string, unknown>;
  for (const c of companions) {
    if (!servers[c.id]) {
      servers[c.id] = { command: c.command, args: c.args };
    }
  }
  config[serversKey] = servers;

  await vscode.workspace.fs.writeFile(filePath, Buffer.from(JSON.stringify(config, null, 2), 'utf-8'));
}

async function appendCodexCompanions(workspaceRoot: string, companions: CompanionConfig[]): Promise<void> {
  const configPath = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), '.codex', 'config.toml');
  let toml = '';

  try {
    const content = await vscode.workspace.fs.readFile(configPath);
    toml = new TextDecoder().decode(content);
  } catch {
    return; // File should already exist from step 1
  }

  for (const c of companions) {
    if (!toml.includes(`[mcp_servers.${c.id}]`)) {
      const argsToml = c.args.map((a) => `"${a}"`).join(', ');
      const entry = `\n[mcp_servers.${c.id}]\ncommand = "${c.command}"\nargs = [${argsToml}]\n`;
      toml = `${toml.trimEnd()}\n${entry}`;
    }
  }

  await vscode.workspace.fs.writeFile(configPath, Buffer.from(toml, 'utf-8'));
}

/**
 * Register MCP server with VS Code Copilot (1.99+).
 * Uses runtime check — no engine version bump needed.
 */
function registerCopilotMcp(context: vscode.ExtensionContext, port: number): void {
  const lm = vscode.lm as Record<string, unknown> | undefined;
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function') {
    console.log('[HyperMCP] vscode.lm.registerMcpServerDefinitionProvider not available (VS Code < 1.99)');
    return;
  }

  try {
    const McpHttpServerDefinition = (vscode as Record<string, unknown>).McpHttpServerDefinition as
      | (new (config: {
          label: string;
          uri: vscode.Uri;
          headers?: Record<string, string>;
          version?: string;
        }) => unknown)
      | undefined;

    if (!McpHttpServerDefinition) {
      console.log('[HyperMCP] vscode.McpHttpServerDefinition not available');
      return;
    }

    const didChangeEmitter = new vscode.EventEmitter<void>();
    context.subscriptions.push(didChangeEmitter);

    type RegisterFn = (id: string, provider: Record<string, unknown>) => vscode.Disposable | undefined;
    const register = lm.registerMcpServerDefinitionProvider as RegisterFn;
    const disposable = register('hypercanvas.mcpServer', {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,
      provideMcpServerDefinitions: async () => [
        new McpHttpServerDefinition({
          label: 'HyperCanvas',
          uri: vscode.Uri.parse(`http://127.0.0.1:${port}/mcp`),
          version: context.extension.packageJSON.version,
        }),
      ],
    });

    if (disposable) {
      context.subscriptions.push(disposable);
      console.log('[HyperMCP] Registered Copilot MCP server provider');
    }
  } catch (err) {
    console.error('[HyperMCP] Failed to register Copilot MCP provider:', err);
  }
}

// ============================================================================
// needs-patch: AI auto-fix prompt builder
// ============================================================================

/**
 * Build an AI chat prompt for the "Auto fix" button shown when needs-patch is returned.
 * Reads router candidate files and package.json to give AI full context.
 */
