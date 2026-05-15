/**
 * Preview Panel
 *
 * Manages a WebviewPanel for component preview as an editor tab.
 * Uses local dev server for preview rendering.
 * Unlike WebviewViewProvider, this creates a draggable editor tab.
 *
 * The webview renders a React app (PreviewPanelApp) that handles:
 * - iframe loading, overlay rendering, canvas interaction
 * - context menu for element operations
 * - message bridging between iframe and extension
 */

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { handleEditorMessage, setMovePreviewToRight, setupActiveFileListener } from './EditorBridge';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import { SyncPositionService } from './services/SyncPositionService';
import type { DevServerRuntimeError, UnsupportedProjectError } from './types';

function isValidJsxComponentName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
}

function toPascalIdentifier(value: string): string {
  const words = value
    .replace(/\.[jt]sx?$/i, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
  const identifier = words
    .map((word) => {
      const first = word.charAt(0);
      return `${first.toUpperCase()}${word.slice(1)}`;
    })
    .join('');
  if (!identifier) return 'Component';
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Component${identifier}`;
}

export function normalizeSampleComponentName(componentName: string): string {
  if (isValidJsxComponentName(componentName)) return componentName;
  const fileName = componentName.split(/[\\/]/).pop() ?? componentName;
  const candidate = toPascalIdentifier(fileName);
  return isValidJsxComponentName(candidate) ? candidate : 'Component';
}

export class PreviewPanel {
  public static readonly viewType = 'hypercanvas.previewPanel';
  private static readonly PANEL_ID = 'preview';

  private _panel?: vscode.WebviewPanel;
  private _currentComponent?: string;
  private _defaultComponent?: string;
  private _disposables: vscode.Disposable[] = [];

  // Runtime error callback
  private _onRuntimeErrorCallback: ((error: DevServerRuntimeError | null) => void) | null = null;

  // Console capture callback (from iframe console intercept)
  private _onConsoleCaptureCallback:
    | ((entries: Array<{ level: string; args: string[]; timestamp: number }>) => void)
    | null = null;

  // Pending content requests (for Copy Text / Copy as HTML round-trip)
  private _pendingContentRequests = new Map<string, (result: { text?: string; html?: string }) => void>();

  // Pending screenshot requests (MCP tool round-trip)
  private _pendingScreenshotRequests = new Map<string, (result: { dataUrl: string | null }) => void>();

  // Preview URL (set dynamically when dev server starts)
  private _previewBaseUrl = 'http://localhost:3000';

  // Whether dev server is actually running
  private _devServerRunning = false;

  // Unsupported project error (React Native / Tamagui), sent to webview on ready
  private _projectError: UnsupportedProjectError | null = null;

  // Bidirectional code/preview position sync
  private _syncService?: SyncPositionService;

  // Cross-panel coordination
  private _stateHub: StateHub;
  private _panelRouter: PanelRouter;

  // Debounce timer for _reEmitSelectionAfterHmr — prevents multiple rapid
  // style writes from queuing redundant re-emissions
  private _reEmitTimer: ReturnType<typeof setTimeout> | null = null;

  private _onScopeChange?: (scope: 'full-app' | 'component-only') => Promise<void>;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private _workspaceRoot: string,
    stateHub: StateHub,
    panelRouter: PanelRouter,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._stateHub = stateHub;
    this._panelRouter = panelRouter;
  }

  /** Update path resolution after VS Code reuses the window for another workspace. */
  public setWorkspaceRoot(workspaceRoot: string): void {
    if (workspaceRoot === this._workspaceRoot) return;
    this.clearSelection();
    this._workspaceRoot = workspaceRoot;
    this._currentComponent = undefined;
    this._defaultComponent = undefined;
    this._devServerRunning = false;
    this._previewBaseUrl = 'http://localhost:3000';
    this.notifyDevServerStopped();
    const shouldRestartSync = Boolean(this._syncService);
    this._syncService?.dispose();
    this._syncService = undefined;
    if (this._panel) {
      if (shouldRestartSync) this._startSyncService();
      this._initializeComponent();
    }
  }

  private _syncWorkspaceRootFromVSCode(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) this.setWorkspaceRoot(workspaceRoot);
  }

  /** Register a callback invoked when the user toggles preview scope via the toolbar. */
  setScopeChangeHandler(fn: (scope: 'full-app' | 'component-only') => Promise<void>): void {
    this._onScopeChange = fn;
  }

  /** Push current scope state into the webview (called from extension when mode changes). */
  setPreviewScope(scope: 'full-app' | 'component-only'): void {
    // Persist to StateHub so newly created panels receive the correct scope on state:init
    this._stateHub.applyUpdate({ previewScope: scope });
  }

  /**
   * Create a new panel or reveal existing one.
   * Always pins the panel so it cannot be accidentally closed.
   */
  public createOrShow(column?: vscode.ViewColumn): void {
    this._syncWorkspaceRootFromVSCode();
    const activeEditor = this._resolveComponentEditor();

    if (this._panel) {
      this._initializeComponent(activeEditor);
      this._panel.reveal(column);
      this._pinPanel();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      'Hyper Canvas',
      column || vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
      },
    );

    this._setupPanel(panel, activeEditor);
    this._pinPanel();
  }

  /**
   * Pin the preview panel tab unless already pinned.
   * Uses workbench.action.pinEditor which operates on the active editor,
   * so the panel must be focused first. Skips if tab is already pinned
   * to avoid an unnecessary focus steal.
   */
  private async _pinPanel(): Promise<void> {
    if (!this._panel) return;
    if (this._isAlreadyPinned()) return;
    // reveal() makes the panel active; pinEditor pins the active editor
    this._panel.reveal(undefined, false);
    await vscode.commands.executeCommand('workbench.action.pinEditor');
  }

  private _isAlreadyPinned(): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes(PreviewPanel.viewType) &&
          tab.isPinned
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Restore panel from serialized state (cross-restart persistence).
   * If we already created a panel via createOrShow, dispose it
   * in favor of the one VSCode is restoring.
   */
  public restorePanel(panel: vscode.WebviewPanel): void {
    if (this._panel) {
      this._panel.dispose();
    }
    this._setupPanel(panel, this._resolveComponentEditor());
    this._pinPanel();
  }

  /**
   * Shared panel initialization
   */
  private _setupPanel(panel: vscode.WebviewPanel, activeEditor?: vscode.TextEditor): void {
    this._panel = panel;

    // Register callback so EditorBridge can move preview to the right
    // when it needs to open a file in a left split.
    setMovePreviewToRight(() => {
      this._panel?.reveal(vscode.ViewColumn.Two, true);
    });

    panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png');

    // Ensure scripts are enabled (matters for deserialized panels)
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
    };

    // Register with StateHub and PanelRouter
    this._stateHub.register(PreviewPanel.PANEL_ID, panel.webview);
    this._panelRouter.setAstResponseTarget(panel.webview);

    // Set HTML once — React app handles all UI state via messages
    panel.webview.html = this._getHtmlForWebview();

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message, panel.webview);
      },
      undefined,
      this._disposables,
    );

    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this._updateComponentFromEditor(editor);
      }),
    );

    // Listen for active editor changes (for platform layer)
    this._disposables.push(setupActiveFileListener(panel.webview));

    // Listen for component changes from other panels (e.g. Left Panel component list).
    // Only track _currentComponent here — do NOT call _updatePreviewUrl().
    // The iframe navigation must wait for ensureComponent/ensureSample to finish
    // (extension.ts chain calls setComponentParam() when ready). Navigating eagerly
    // caused black canvas: the iframe tried to render a component not yet registered
    // in __canvas_preview__.tsx because HMR hadn't picked up the file change.
    const unsubState = this._stateHub.onChange((_state, patch) => {
      if (patch.currentComponent !== undefined) {
        const component = patch.currentComponent;
        if (component && this._currentComponent !== component.path) {
          this._currentComponent = component.path;
          console.log('[HyperIDE] Component changed via state:', component.path);
        }
      }
    });
    this._disposables.push({ dispose: unsubState });

    this._startSyncService();

    // Cleanup on dispose
    panel.onDidDispose(() => {
      for (const d of this._disposables) d.dispose();
      this._disposables = [];
      this._stateHub.unregister(PreviewPanel.PANEL_ID);
      this._syncService = undefined;
      this._panel = undefined;
      setMovePreviewToRight(null);
    }, undefined);

    // Initialize component
    this._initializeComponent(activeEditor);
  }

  private _startSyncService(): void {
    this._syncService = new SyncPositionService(
      this._panelRouter.astBridge.astService,
      this._stateHub,
      this._workspaceRoot,
      (elementId) => this.sendGoToVisual(elementId),
      () => this._currentComponent,
    );
    this._syncService.start();
    this._disposables.push(this._syncService);
  }

  /**
   * Handle message from webview
   */
  private async _handleMessage(message: unknown, webview: vscode.Webview): Promise<void> {
    const msg = message as { type?: string; [key: string]: unknown };

    if (!msg.type) return;

    console.log('[HyperIDE] Message from webview:', msg.type);

    // === Webview lifecycle ===
    if (msg.type === 'webview:ready') {
      // Send initial state
      this._stateHub.sendInit(PreviewPanel.PANEL_ID);
      // Send current devserver status
      webview.postMessage({
        type: 'devserver:statusChanged',
        running: this._devServerRunning,
        url: this._devServerRunning ? this._previewBaseUrl : null,
      });
      // Send unsupported project error if already detected
      if (this._projectError) {
        webview.postMessage({ type: 'projectError', error: this._projectError });
      }
      // If dev server is running, send current preview URL
      if (this._devServerRunning) {
        this._updatePreviewUrl();
      }
      return;
    }

    // === Preview-specific lifecycle messages (not routed) ===
    if (msg.type === 'previewLoaded') {
      console.log('[HyperIDE] Preview iframe loaded');
      return;
    }
    if (msg.type === 'chrome-detected') {
      const shown = this._context.workspaceState.get<boolean>('chromeDetectedShown', false);
      if (!shown) {
        void this._context.workspaceState.update('chromeDetectedShown', true);
        void vscode.window
          .showInformationMessage(
            'HyperCanvas: Preview includes app layout (nav/header/sidebar). Switch to Isolated mode to isolate components.',
            'Generate wrapper',
            'Dismiss',
          )
          .then((choice) => {
            if (choice === 'Generate wrapper') {
              void this._onScopeChange?.('component-only');
            }
          });
      }
      return;
    }
    if (msg.type === 'preview:setScope') {
      const scope = msg.scope;
      if (scope !== 'full-app' && scope !== 'component-only') return;
      void this._onScopeChange?.(scope);
      return;
    }
    if (msg.type === 'runtime:error') {
      const error = (msg as { error?: DevServerRuntimeError | null }).error ?? null;
      this._onRuntimeErrorCallback?.(error);
      return;
    }
    if (msg.type === 'diagnostic:console') {
      const entries = (
        msg as {
          entries?: Array<{ level: string; args: string[]; timestamp: number }>;
        }
      ).entries;
      if (entries) {
        this._onConsoleCaptureCallback?.(entries);
      }
      return;
    }
    if (msg.type === 'command:startDevServer') {
      vscode.commands.executeCommand('hypercanvas.startDevServer');
      return;
    }
    if (msg.type === 'command:fixUnsupportedProject') {
      vscode.commands.executeCommand('hypercanvas.fixUnsupportedProject');
      return;
    }

    // === ErrorBoundary actions (from iframe error UI) ===
    if (msg.type === 'errorBoundary:createSample') {
      await this._handleCreateSampleFromError(
        msg.componentPath as string | undefined,
        msg.propValues as Record<string, unknown> | undefined,
        msg.sampleName as string | undefined,
      );
      return;
    }
    if (msg.type === 'errorBoundary:configureAIKey') {
      vscode.commands.executeCommand('hypercanvas.configureAIKey');
      return;
    }
    if (msg.type === 'errorBoundary:getPropsSchema') {
      const componentPath = msg.componentPath as string | undefined;
      if (componentPath) {
        const props = await this._panelRouter.componentService.getComponentDefinitions(componentPath);
        webview.postMessage({
          type: 'errorBoundary:propsSchema',
          componentPath,
          propsSchema: props,
        });
      }
      return;
    }

    if (msg.type === 'previewError') {
      console.error('[HyperIDE] Preview error:', (msg as { error?: string }).error);
      return;
    }

    // === Canvas undo/redo (from iframe Cmd+Z / Shift+Cmd+Z) ===
    // Delegates to the same undo()/redo() methods used by keybinding commands,
    // ensuring consistent behavior between keyboard shortcuts and webview messages.
    if (msg.type === 'canvas:undo') {
      await this.undo();
      return;
    }
    if (msg.type === 'canvas:redo') {
      await this.redo();
      return;
    }

    // === Keyboard-driven delete (from iframe keyboard handler) ===
    if (msg.type === 'keyboard:delete') {
      const elementIds = msg.elementIds as string[] | undefined;
      const componentPath = this._currentComponent;
      if (!componentPath || !elementIds?.length) return;

      const result = await this._panelRouter.astBridge.deleteElements(componentPath, elementIds);

      if (result.success) {
        this._stateHub.applyUpdate({
          selectedIds: [],
        });
      }
      return;
    }

    // === Context menu actions ===
    if (msg.type === 'contextMenu:goToCode') {
      await this._handleContextMenuGoToCode(msg, webview);
      return;
    }
    if (msg.type === 'contextMenu:duplicate') {
      await this._handleContextMenuDuplicate(msg);
      return;
    }
    if (msg.type === 'contextMenu:delete') {
      await this._handleContextMenuDelete(msg);
      return;
    }
    if (msg.type === 'contextMenu:wrapInDiv') {
      await this._handleContextMenuWrapInDiv(msg);
      return;
    }
    if (msg.type === 'contextMenu:copy') {
      await this._handleContextMenuCopy(msg);
      return;
    }
    if (msg.type === 'contextMenu:paste') {
      await this._handleContextMenuPaste(msg);
      return;
    }
    if (msg.type === 'contextMenu:cut') {
      await this._handleContextMenuCut(msg);
      return;
    }
    if (msg.type === 'contextMenu:selectParent') {
      await this._handleContextMenuSelectParent(msg);
      return;
    }
    if (msg.type === 'contextMenu:selectChild') {
      await this._handleContextMenuSelectChild(msg);
      return;
    }
    if (msg.type === 'contextMenu:copyText') {
      this._handleContextMenuCopyContent(msg, webview, 'text');
      return;
    }
    if (msg.type === 'contextMenu:copyAsHTML') {
      this._handleContextMenuCopyContent(msg, webview, 'html');
      return;
    }
    if (msg.type === 'elementContentResult') {
      this._handleElementContentResult(msg);
      return;
    }
    if (msg.type === 'screenshotResult') {
      this._handleScreenshotResult(msg);
      return;
    }

    // AST mutations (ast:updateStyles, ast:updateProps, ast:insertElement, etc.)
    // trigger HMR — re-emit selection so the preview re-highlights the element
    // after the fiber tree is rebuilt.
    if (msg.type?.startsWith('ast:')) {
      await this._panelRouter.routeMessage(msg, webview);
      this._bumpStyleVersion();
      this._reEmitSelectionAfterHmr();
      return;
    }

    // When the user clicks an element (or empty area) on the canvas, the webview
    // sends state:update with selectedIds.  Make the canvas tab visually active
    // so keyboard events (Tab, Delete, etc.) go to the canvas instead of a sidebar.
    // reveal(false) activates the tab but steals focus from the iframe, so we
    // immediately post a message to refocus the iframe afterwards.
    if (msg.type === 'state:update') {
      const patch = (msg as { patch?: Record<string, unknown> }).patch;
      if (patch && 'selectedIds' in patch) {
        this._panel?.reveal(undefined, false);
        // Refocus the iframe after reveal stole focus
        webview.postMessage({ type: 'canvas:refocusIframe' });
      }
    }

    // Delegate shared platform messages to PanelRouter
    const handled = await this._panelRouter.routeMessage(msg, webview);

    if (!handled) {
      console.log('[HyperIDE] Unknown message type:', msg.type);
    }
  }

  // === ErrorBoundary handlers ===

  /**
   * Handle "Create Sample File" button from the ErrorBoundary UI.
   * Creates a minimal SampleDefault scaffold in the component file and opens it in editor.
   */
  private async _handleCreateSampleFromError(
    componentPath: string | undefined,
    propValues?: Record<string, unknown>,
    sampleName?: string,
    options?: { componentName?: string; revealInEditor?: boolean },
  ): Promise<boolean> {
    if (!componentPath) return false;

    const absPath = path.isAbsolute(componentPath) ? componentPath : path.join(this._workspaceRoot, componentPath);
    const exportName = sampleName || 'SampleDefault';
    const revealInEditor = options?.revealInEditor ?? true;

    // Extract component name from file path (e.g. 'src/components/Button.tsx' → 'Button')
    const fileName = path.basename(absPath, path.extname(absPath));
    const componentName = options?.componentName || fileName.charAt(0).toUpperCase() + fileName.slice(1);

    // Read the file to check if this sample name already exists
    let sourceCode: string;
    try {
      const fileUri = vscode.Uri.file(absPath);
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      sourceCode = Buffer.from(bytes).toString('utf-8');
    } catch {
      void vscode.window.showErrorMessage(`Could not read component file: ${componentPath}`);
      return false;
    }

    // Check if sample with this name already exists — update it in place
    const existingRegex = new RegExp(`export\\s+const\\s+${exportName}\\s*=`);
    if (existingRegex.test(sourceCode)) {
      // Find and replace the existing sample block
      const sampleStart = sourceCode.indexOf(`export const ${exportName}`);
      // Find the end of the sample (next export or end of file)
      const afterSample = sourceCode.slice(sampleStart);
      const nextExportMatch = afterSample.match(/\n(export\s)/);
      const sampleEnd = nextExportMatch
        ? sampleStart + (nextExportMatch.index ?? afterSample.length)
        : sourceCode.length;

      // Build replacement
      const propEntries = this._buildPropEntries(propValues);
      const replacement = this._buildSampleScaffold(componentName, exportName, propEntries);

      sourceCode = sourceCode.slice(0, sampleStart) + replacement.trimStart() + sourceCode.slice(sampleEnd);

      try {
        const fileUri = vscode.Uri.file(absPath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(sourceCode, 'utf-8'));
      } catch {
        void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
        return false;
      }

      if (!revealInEditor) {
        return true;
      }

      const lineNumber = sourceCode.substring(0, sourceCode.indexOf(exportName)).split('\n').length;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: true,
        selection: new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0),
      });
      return true;
    }

    // Generate a minimal sample scaffold — include user-provided prop values if available
    const propEntries = this._buildPropEntries(propValues);
    const scaffold = this._buildSampleScaffold(componentName, exportName, propEntries);

    // Append to file
    const updatedCode = `${sourceCode}\n${scaffold}\n`;
    try {
      const fileUri = vscode.Uri.file(absPath);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedCode, 'utf-8'));
    } catch {
      void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
      return false;
    }

    if (revealInEditor) {
      // Open the file and position cursor at the scaffold
      const lines = updatedCode.split('\n');
      const todoIdx = lines.findIndex((line) => line.includes('// TODO: Add required props'));
      const sampleIdx = lines.findIndex((line) => line.includes(exportName));
      const targetLine = todoIdx >= 0 ? todoIdx : Math.max(sampleIdx, 0);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: true,
        selection: new vscode.Range(targetLine, 0, targetLine, 0),
      });
    }

    console.log(`[HyperIDE] Created ${exportName} scaffold in ${componentPath}`);

    // Watch file for sample deletion — notify webview to reset sampleCreated state
    if (this._panel) {
      this._watchSampleInFile(absPath, exportName, this._panel.webview);
    }
    return true;
  }

  /**
   * Ensure a deterministic SampleDefault scaffold exists for a component with no props.
   * Used as a silent fallback when AI sample generation is unavailable.
   */
  public async ensureDefaultSampleForNoProps(componentPath: string, componentName: string): Promise<boolean> {
    return this._handleCreateSampleFromError(componentPath, undefined, 'SampleDefault', {
      componentName,
      revealInEditor: false,
    });
  }

  private _sampleWatcher?: vscode.Disposable;

  private _watchSampleInFile(absPath: string, exportName: string, webview: vscode.Webview): void {
    // Dispose previous watcher
    this._sampleWatcher?.dispose();

    const fileUri = vscode.Uri.file(absPath);
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(fileUri, ''));

    const checkSample = async () => {
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(bytes).toString('utf-8');
        const exists = content.includes(`export const ${exportName}`);
        if (!exists) {
          webview.postMessage({ type: 'errorOverlay:sampleDeleted', sampleName: exportName });
          this._sampleWatcher?.dispose();
          this._sampleWatcher = undefined;
        }
      } catch {
        // File deleted entirely
        webview.postMessage({ type: 'errorOverlay:sampleDeleted', sampleName: exportName });
        this._sampleWatcher?.dispose();
        this._sampleWatcher = undefined;
      }
    };

    watcher.onDidChange(checkSample);
    watcher.onDidDelete(() => {
      webview.postMessage({ type: 'errorOverlay:sampleDeleted', sampleName: exportName });
      this._sampleWatcher?.dispose();
      this._sampleWatcher = undefined;
    });

    this._sampleWatcher = watcher;
  }

  private _buildPropEntries(propValues?: Record<string, unknown>): Array<[string, unknown]> {
    return propValues
      ? Object.entries(propValues).filter(([, v]) => {
          if (v == null) return false;
          if (typeof v === 'string') return v.trim() !== '';
          return true;
        })
      : [];
  }

  private _buildSampleScaffold(
    componentName: string,
    exportName: string,
    propEntries: Array<[string, unknown]>,
  ): string {
    const jsxComponentName = normalizeSampleComponentName(componentName);
    const propLines =
      propEntries.length > 0
        ? propEntries.map(([key, value]) => {
            if (typeof value === 'boolean') return `    ${key}={${value}}`;
            if (typeof value === 'number') return `    ${key}={${value}}`;
            if (typeof value === 'object') return `    ${key}={${JSON.stringify(value)}}`;
            return `    ${key}={${JSON.stringify(String(value))}}`;
          })
        : [`    // TODO: Add required props here`];
    return [
      '',
      `// Sample component — add required props below`,
      `export const ${exportName} = () => (`,
      `  <${jsxComponentName}`,
      ...propLines,
      `  />`,
      ');',
    ].join('\n');
  }

  // === Context menu handlers ===

  private async _handleContextMenuGoToCode(msg: { [key: string]: unknown }, webview: vscode.Webview): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const loc = await this._panelRouter.astBridge.astService.getElementLocation(componentPath, elementId);

    if (loc) {
      await handleEditorMessage(
        {
          type: 'editor:goToCode',
          path: componentPath,
          line: loc.line,
          column: loc.column + 1,
        },
        webview,
      );
    }
  }

  private async _handleContextMenuDuplicate(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.duplicateElement(componentPath, elementId);

    if (result.success && result.newId) {
      // Select the new element
      this._stateHub.applyUpdate({
        selectedIds: [result.newId],
      });
    }
  }

  private async _handleContextMenuDelete(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.deleteElements(componentPath, [elementId]);

    if (result.success) {
      // Clear selection
      this._stateHub.applyUpdate({
        selectedIds: [],
      });
    }
  }

  private async _handleContextMenuWrapInDiv(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.wrapElement(componentPath, elementId, 'div');

    if (result.success && result.wrapperId) {
      // Select the wrapper
      this._stateHub.applyUpdate({
        selectedIds: [result.wrapperId],
      });
    }
  }

  private async _handleContextMenuCopy(msg: { [key: string]: unknown }): Promise<void> {
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementIds?.length) return;

    const codes: string[] = [];
    for (const id of elementIds) {
      const code = await this._panelRouter.astBridge.astService.getElementCode(componentPath, id);
      if (code) codes.push(code);
    }

    if (codes.length > 0) {
      await vscode.env.clipboard.writeText(codes.join('\n'));
    }
  }

  private async _handleContextMenuPaste(msg: { [key: string]: unknown }): Promise<void> {
    const targetId = (msg.targetId as string) || null;
    const componentPath = this._currentComponent;
    if (!componentPath) return;

    const tsxCode = await vscode.env.clipboard.readText();
    if (!tsxCode.trim()) return;

    const result = await this._panelRouter.astBridge.pasteElement(componentPath, targetId, tsxCode);

    if (result.success && result.newId) {
      this._stateHub.applyUpdate({
        selectedIds: [result.newId],
      });
    }
  }

  private async _handleContextMenuCut(msg: { [key: string]: unknown }): Promise<void> {
    // Copy first
    await this._handleContextMenuCopy(msg);

    // Then delete
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementIds?.length) return;

    const result = await this._panelRouter.astBridge.deleteElements(componentPath, elementIds);

    if (result.success) {
      this._stateHub.applyUpdate({
        selectedIds: [],
      });
    }
  }

  private async _handleContextMenuSelectParent(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const parentId = await this._panelRouter.astBridge.astService.getParentElementId(
      componentPath,
      elementId,
      elementId,
    );

    if (parentId) {
      this._stateHub.applyUpdate({
        selectedIds: [parentId],
      });
    }
  }

  private async _handleContextMenuSelectChild(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const childIds = await this._panelRouter.astBridge.astService.getChildElementIds(
      componentPath,
      elementId,
      elementId,
    );

    if (childIds.length > 0) {
      this._stateHub.applyUpdate({
        selectedIds: childIds,
      });
    }
  }

  private _handleContextMenuCopyContent(
    msg: { [key: string]: unknown },
    webview: vscode.Webview,
    mode: 'text' | 'html',
  ): void {
    const elementId = msg.elementId as string | undefined;
    if (!elementId) return;

    const requestId = `content-${Date.now()}-${this._generateRandomId(6)}`;
    this._pendingContentRequests.set(requestId, (result) => {
      const value = mode === 'text' ? result.text : result.html;
      if (value) {
        vscode.env.clipboard.writeText(value);
      }
    });

    webview.postMessage({
      type: mode === 'text' ? 'getElementText' : 'getElementHTML',
      elementId,
      requestId,
    });

    // Timeout: clean up if no response in 5 seconds
    setTimeout(() => {
      this._pendingContentRequests.delete(requestId);
    }, 5000);
  }

  private _handleElementContentResult(msg: { [key: string]: unknown }): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    const callback = this._pendingContentRequests.get(requestId);
    if (callback) {
      callback({ text: msg.text as string, html: msg.html as string });
      this._pendingContentRequests.delete(requestId);
    }
  }

  private _handleScreenshotResult(msg: { [key: string]: unknown }): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    const callback = this._pendingScreenshotRequests.get(requestId);
    if (callback) {
      callback({ dataUrl: (msg.dataUrl as string) ?? null });
      this._pendingScreenshotRequests.delete(requestId);
    }
  }

  /**
   * Take a screenshot of the preview or a specific element.
   * Returns base64 PNG data URL, or null if screenshot failed.
   */
  takeScreenshot(elementId?: string): Promise<string | null> {
    const webview = this._panel?.webview;
    if (!webview) return Promise.resolve(null);

    const requestId = `screenshot-${Date.now()}-${this._generateRandomId(6)}`;

    return new Promise((resolve) => {
      this._pendingScreenshotRequests.set(requestId, (result) => {
        resolve(result.dataUrl);
      });

      webview.postMessage({
        type: 'takeScreenshot',
        elementId: elementId ?? null,
        requestId,
      });

      // Timeout: 10 seconds for screenshot rendering
      setTimeout(() => {
        if (this._pendingScreenshotRequests.has(requestId)) {
          this._pendingScreenshotRequests.delete(requestId);
          resolve(null);
        }
      }, 10000);
    });
  }

  /**
   * Initialize component from active editor
   */
  private _initializeComponent(activeEditor = vscode.window.activeTextEditor): void {
    this._syncWorkspaceRootFromVSCode();
    const component = this._resolveComponentPath(activeEditor);
    if (component) {
      this._setCurrentComponent(component);
    }

    // Fallback: pick component from StateHub (e.g. opened via Explorer click)
    if (!this._currentComponent) {
      const stateComponent = this._stateHub.state.currentComponent;
      if (stateComponent?.path) {
        this._currentComponent = stateComponent.path;
      }
    }
  }

  /**
   * Extract component path from editor (relative to workspace root)
   */
  private _extractComponentFromEditor(editor: vscode.TextEditor): string | undefined {
    return this._extractComponentFromPath(editor.document.uri.fsPath);
  }

  private _extractComponentFromPath(filePath: string): string | undefined {
    if (!/\.(tsx|jsx)$/.test(filePath)) {
      return undefined;
    }

    if (filePath.startsWith(this._workspaceRoot)) {
      return filePath.substring(this._workspaceRoot.length + 1);
    }
    return undefined;
  }

  private _resolveComponentPath(editor = vscode.window.activeTextEditor): string | undefined {
    if (editor) {
      const component = this._extractComponentFromEditor(editor);
      if (component) return component;
    }

    for (const candidate of vscode.window.visibleTextEditors) {
      const component = this._extractComponentFromEditor(candidate);
      if (component) return component;
    }

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const component = this._extractComponentFromPath(tab.input.uri.fsPath);
          if (component) return component;
        }
      }
    }

    return undefined;
  }

  private _resolveComponentEditor(editor = vscode.window.activeTextEditor): vscode.TextEditor | undefined {
    if (editor && this._extractComponentFromEditor(editor)) {
      return editor;
    }
    return vscode.window.visibleTextEditors.find((candidate) => Boolean(this._extractComponentFromEditor(candidate)));
  }

  /**
   * Update component from editor
   */
  private _updateComponentFromEditor(editor?: vscode.TextEditor): void {
    // Ignore focus loss (e.g. clicking on preview tab or output panel).
    // Keep the last selected component instead of resetting.
    if (!editor) return;
    this._syncWorkspaceRootFromVSCode();

    const component = this._extractComponentFromEditor(editor);
    if (
      component &&
      (this._currentComponent !== component || this._stateHub.state.currentComponent?.path !== component)
    ) {
      console.log('[HyperIDE] Component from editor:', component);
      this._setCurrentComponent(component);
    }
  }

  private _setCurrentComponent(component: string): void {
    this._currentComponent = component;
    const name = component.replace(/^.*\//, '').replace(/\.\w+$/, '');
    const current = this._stateHub.state.currentComponent;

    if (current?.path === component && current.name === name) {
      return;
    }

    // Dispatch to StateHub so Inspector and other panels sync.
    this._stateHub.applyUpdate({
      currentComponent: { name, path: component },
    });
  }

  /**
   * Update preview URL
   */
  private _updatePreviewUrl(): void {
    // No iframe to update when dev server isn't running
    if (!this._devServerRunning) {
      return;
    }

    const component = this._currentComponent || this._defaultComponent;

    // No component selected — show hint instead of loading bare URL
    if (!component) {
      console.log('[HyperIDE] No component selected, showing hint');
      this._panel?.webview.postMessage({ type: 'showNoComponentHint' });
      return;
    }

    const baseUrl = `${this._previewBaseUrl}/test-preview`;
    const url = `${baseUrl}?component=${encodeURIComponent(component)}`;

    console.log('[HyperIDE] Updating URL:', url);

    this._panel?.webview.postMessage({ type: 'updateUrl', url });
  }

  /**
   * Set preview URL (called by dev server when started)
   */
  public setPreviewUrl(url: string): void {
    this._previewBaseUrl = url;
    this._devServerRunning = true;

    // Notify React webview of devserver status change
    this._panel?.webview.postMessage({
      type: 'devserver:statusChanged',
      running: true,
      url,
    });

    this._updatePreviewUrl();
  }

  /**
   * Notify webview that the dev server has stopped.
   */
  public notifyDevServerStopped(): void {
    this._devServerRunning = false;
    this._panel?.webview.postMessage({
      type: 'devserver:statusChanged',
      running: false,
      url: null,
    });
  }

  /**
   * Notify webview that the project type is unsupported (e.g. React Native / Tamagui).
   * Pass null to clear the error (e.g. after fix installed react-native-web).
   */
  public notifyUnsupportedProject(error: UnsupportedProjectError | null): void {
    this._projectError = error;
    this._panel?.webview.postMessage({ type: 'projectError', error });
  }

  /**
   * Notify the webview about project capabilities (readonly mode, CSS system).
   * Sent after CSS system detection completes during activation.
   */
  public notifyCapabilities(capabilities: import('./types').ProjectCapabilities): void {
    this._panel?.webview.postMessage({ type: 'projectCapabilities', capabilities });
  }

  /**
   * Refresh preview
   */
  public refresh(): void {
    this._panel?.webview.postMessage({ type: 'refresh' });
  }

  /**
   * Dispose the preview panel. This closes the webview tab and fires
   * `onDidDispose`, which tears down all child services (dev server, state
   * hub registration, source map warmers) and clears `_panel` so the next
   * `createOrShow` builds a fresh webview with a clean iframe state.
   *
   * Primarily exposed for E2E tests that need to guarantee a fresh preview
   * iframe between specs — the iframe accumulates module-level state (click
   * handler listeners, source map caches, pendingClickElement) that leaks
   * across tests and causes intermittent click-resolution failures.
   */
  public dispose(): void {
    this.clearSelection();
    this._panel?.dispose();
  }

  /**
   * Update iframe component URL param without a hard reload.
   * Triggers navigation to /test-preview?component=<componentPath>.
   */
  public setComponentParam(componentPath: string): void {
    this._currentComponent = componentPath;
    if (!this._panel) return;

    if (this._devServerRunning) {
      this._updatePreviewUrl();
      return;
    }

    this._panel.webview.postMessage({
      type: 'setComponent',
      component: componentPath,
    });
  }

  /**
   * Wait for selectedIds to become non-empty.
   * Tree click sends state:update asynchronously via postMessage, so
   * selectedIds may still be empty when a command fires immediately after.
   * Returns current selectedIds if already populated, otherwise listens
   * for the next StateHub change (up to 500ms).
   */
  private _waitForSelectedIds(): Promise<string[]> {
    const current = this._stateHub.state.selectedIds;
    if (current?.length) return Promise.resolve(current);

    return new Promise<string[]>((resolve) => {
      let settled = false;
      const unsub = this._stateHub.onChange((state) => {
        if (!settled && state.selectedIds?.length) {
          settled = true;
          unsub();
          resolve(state.selectedIds);
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          unsub();
          resolve(this._stateHub.state.selectedIds);
        }
      }, 500);
    });
  }

  /**
   * Delete selected elements (called from VS Code keybinding command).
   */
  public async deleteSelected(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    if (!componentPath || !selectedIds?.length) return;

    const result = await this._panelRouter.astBridge.deleteElements(componentPath, selectedIds);
    if (result.success) {
      this._stateHub.applyUpdate({ selectedIds: [] });
    }
  }

  /**
   * Duplicate the first selected element (called from VS Code command).
   */
  public async duplicateSelected(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    if (!componentPath || !selectedIds?.length) return;

    const result = await this._panelRouter.astBridge.duplicateElement(componentPath, selectedIds[0]);
    if (result.success && result.newId) {
      this._stateHub.applyUpdate({ selectedIds: [result.newId] });
    }
  }

  /**
   * Wrap the first selected element in a new div container (called from VS Code command).
   */
  public async wrapSelected(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    if (!componentPath || !selectedIds?.length) return;

    const result = await this._panelRouter.astBridge.wrapElement(componentPath, selectedIds[0], 'div');
    if (result.success && result.wrapperId) {
      this._stateHub.applyUpdate({ selectedIds: [result.wrapperId] });
    }
  }

  /**
   * Open the insertion UI for the first selected element (called from VS Code command).
   */
  public async openInsertPanelForSelection(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    if (!selectedIds.length) return;

    this._stateHub.applyUpdate({ selectedIds, insertTargetId: selectedIds[0] });
  }

  /**
   * Select children of selected element (called from VS Code keybinding command).
   */
  public async selectChildren(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    if (componentPath && selectedIds.length > 0) {
      const childIds = await this._panelRouter.astBridge.astService.getChildElementIds(
        componentPath,
        selectedIds[0],
        selectedIds[0],
      );
      if (childIds.length > 0) {
        this._stateHub.applyUpdate({ selectedIds: childIds });
        return;
      }
    }

    this._panel?.webview.postMessage({ type: 'canvas:keyboard', key: 'Enter', shiftKey: false });
  }

  /**
   * Select parent of selected element (called from VS Code keybinding command).
   */
  public async selectParent(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    if (componentPath && selectedIds.length > 0) {
      const parentId = await this._panelRouter.astBridge.astService.getParentElementId(
        componentPath,
        selectedIds[0],
        selectedIds[0],
      );
      if (parentId) {
        this._stateHub.applyUpdate({ selectedIds: [parentId] });
        return;
      }
    }

    this._panel?.webview.postMessage({ type: 'canvas:keyboard', key: 'Enter', shiftKey: true });
  }

  /**
   * Select next sibling of selected element (called from VS Code keybinding command).
   */
  public selectNextSibling(): void {
    // Forward to iframe where DOM-based keyboard handler resolves siblings via fiber tree.
    // AST-based NodeMapService doesn't reliably track elements inside conditional JSX expressions.
    this._panel?.webview.postMessage({ type: 'canvas:keyboard', key: 'Tab', shiftKey: false });
  }

  /**
   * Select previous sibling of selected element (called from VS Code keybinding command).
   */
  public selectPrevSibling(): void {
    this._panel?.webview.postMessage({ type: 'canvas:keyboard', key: 'Tab', shiftKey: true });
  }

  /**
   * Programmatically select an element by its nodeRef.
   * Used by E2E tests and extension commands to establish full canvas selection state.
   */
  public selectElement(elementId: string): void {
    this._stateHub.applyUpdate({ selectedIds: [elementId] });
  }

  /**
   * Programmatically select multiple elements by their nodeRefs.
   */
  public selectElements(elementIds: string[]): void {
    this._stateHub.applyUpdate({ selectedIds: elementIds });
  }

  /**
   * Clear selection (called from VS Code keybinding command).
   */
  public clearSelection(): void {
    this._stateHub.applyUpdate({ selectedIds: [], insertTargetId: null });
  }

  /**
   * Undo last canvas operation (called from VS Code keybinding command).
   * Falls back to VS Code native undo when canvas stack is empty.
   */
  public async undo(): Promise<void> {
    console.log('[PreviewPanel] undo() called (keybinding command)');
    const panel = this._panel;
    if (!panel) {
      console.log('[PreviewPanel] undo: no panel, falling back to native undo');
      await vscode.commands.executeCommand('undo');
      return;
    }
    const handled = await this._panelRouter.astBridge.undo(panel);
    console.log(`[PreviewPanel] undo: astBridge.undo returned ${handled}`);
    if (!handled) {
      console.log('[PreviewPanel] undo: falling back to native VS Code undo');
      await vscode.commands.executeCommand('undo');
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.isDirty) {
        await editor.document.save();
      }
    }
    // Always bump styleVersion to refresh inspector — both canvas stack and native undo paths
    // revert the file on disk, but inspector caches styles and needs explicit invalidation
    this._bumpStyleVersion();
    // Re-emit selection after HMR settles so the new fiber tree picks it up
    this._reEmitSelectionAfterHmr();
  }

  /**
   * Redo last canvas operation (called from VS Code keybinding command).
   * Falls back to VS Code native redo when canvas stack is empty.
   */
  public async redo(): Promise<void> {
    console.log('[PreviewPanel] redo() called (keybinding command)');
    const panel = this._panel;
    if (!panel) {
      console.log('[PreviewPanel] redo: no panel, falling back to native redo');
      await vscode.commands.executeCommand('redo');
      return;
    }
    const handled = await this._panelRouter.astBridge.redo(panel);
    console.log(`[PreviewPanel] redo: astBridge.redo returned ${handled}`);
    if (!handled) {
      console.log('[PreviewPanel] redo: falling back to native VS Code redo');
      await vscode.commands.executeCommand('redo');
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.isDirty) {
        await editor.document.save();
      }
    }
    // Always bump styleVersion to refresh inspector after redo
    this._bumpStyleVersion();
    // Re-emit selection after HMR settles so the new fiber tree picks it up
    this._reEmitSelectionAfterHmr();
  }

  /**
   * Increment styleVersion in shared state so the inspector re-reads styles.
   * Called after any file-modifying operation (style writes, undo/redo) to
   * sync the inspector with file changes.
   */
  private _bumpStyleVersion(): void {
    const current = this._stateHub.state.styleVersion ?? 0;
    this._stateHub.applyUpdate({ styleVersion: current + 1 });
  }

  /**
   * Re-emit current selectedIds after a delay so the preview webview can
   * re-select the element once HMR has rebuilt the fiber tree.
   *
   * After undo/redo the file on disk changes, Vite HMR reloads the preview
   * iframe, and the fiber tree is recreated with fresh DOM nodes.  The old
   * selection (nodeRef format "src/App.tsx:13:8") is still valid because
   * it's source-position-based, but the webview dropped it when HMR
   * destroyed the previous React tree.  Re-emitting via applyUpdate
   * broadcasts state:update with selectedIds to all panels so the preview
   * can locate and highlight the element again.
   */
  private _reEmitSelectionAfterHmr(): void {
    const selectedIds = this._stateHub.state.selectedIds;
    if (!selectedIds?.length) return;

    // Debounce: clear previous timer if multiple style writes happen rapidly
    // (e.g. drag-resizing or multi-property updates). Only the last one fires.
    if (this._reEmitTimer) clearTimeout(this._reEmitTimer);

    // 300ms delay: Vite HMR typically settles within 100-200ms, but we add
    // headroom for slower machines and full-page reloads (native undo path).
    this._reEmitTimer = setTimeout(() => {
      this._reEmitTimer = null;
      // Re-read state — selection may have been cleared by user action
      // during the delay window
      const currentIds = this._stateHub.state.selectedIds;
      if (!currentIds?.length) return;

      console.log('[PreviewPanel] Re-emitting selection after HMR:', currentIds);
      this._stateHub.applyUpdate({ selectedIds: currentIds });
    }, 300);
  }

  /**
   * Set callback for runtime errors from iframe preview
   */
  public onRuntimeError(callback: (error: DevServerRuntimeError | null) => void): void {
    this._onRuntimeErrorCallback = callback;
  }

  /**
   * Set callback for console capture messages from iframe preview
   */
  public onConsoleCapture(
    callback: (entries: Array<{ level: string; args: string[]; timestamp: number }>) => void,
  ): void {
    this._onConsoleCaptureCallback = callback;
  }

  /**
   * Send Go to Visual command to webview
   */
  public sendGoToVisual(elementId: string): void {
    if (this._panel) {
      console.log(`[HyperIDE] Sending goToVisual: ${elementId}`);
      this._panel.webview.postMessage({
        type: 'goToVisual',
        elementId,
      });
      // Update StateHub so inspector (right panel) and explorer (left panel) receive selection
      this._stateHub.applyUpdate({
        selectedIds: [elementId],
      });
    }
  }

  /**
   * Generate HTML for webview — minimal shell, React handles all UI
   */
  private _getHtmlForWebview(): string {
    const webview = this._panel?.webview;
    if (!webview) {
      // Fallback HTML if the webview panel is not available
      return '<!DOCTYPE html><html><body><p>Preview is not available.</p></body></html>';
    }
    const nonce = this._getNonce();

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-preview-panel.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- unsafe-inline required: React applies styles via style={{}} attributes in PreviewPanelApp -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src *;
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};
    script-src 'nonce-${nonce}';
    connect-src *;
  ">
  <title>HyperIDE Preview</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate a random alphanumeric string of the given length
   * using cryptographically secure randomness.
   */
  private _generateRandomId(length: number): string {
    return crypto.randomBytes(length).toString('base64url').slice(0, length);
  }

  /**
   * Generate nonce for CSP
   */
  private _getNonce(): string {
    return this._generateRandomId(32);
  }
}
