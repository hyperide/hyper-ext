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
import {
  ensureSample,
  buildSampleScaffold,
  generateSamplePropValues,
  normalizeSampleComponentName,
} from '@lib/preview-generator';
import { escapeRegex, extractComponentName } from '../../../lib/preview-generator/scanner';
import { handleEditorMessage, setMovePreviewToRight, setupActiveFileListener } from './EditorBridge';
import { createExtensionSampleGenerator } from './services/SampleAIGenerator';
import { deriveSubProjectPrefix, resolveComponentAbsPath } from './bridges/monorepo-path-translate';
import {
  canNavigate,
  createComponentState,
  needsNavigationWait,
  withNavigable,
  withNeedsRegeneration,
  type PreviewComponentState,
} from './PreviewComponentState';
import {
  reduce as reduceLifecycle,
  type LifecycleContext,
  type LifecycleEffect,
  type LifecycleEvent,
} from './PreviewLifecycle';
import { VSCodeFileIO } from './vscode-file-io';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import { SyncPositionService } from './services/SyncPositionService';
import type { DevServerRuntimeError, UnsupportedProjectError } from './types';

export { normalizeSampleComponentName };

/**
 * Recursively drop function values from a generated sample-prop tree so the result
 * is structured-clone safe for `webview.postMessage`. Functions can appear at any
 * depth (generateSamplePropValues recurses into objectFields), and structured clone
 * throws on the whole payload if any survive. Object keys whose value is a function
 * are omitted entirely; arrays drop function items. Non-plain objects (Date, etc.)
 * are passed through — structured clone handles them. Feature #210.
 */
function stripFunctions(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    return value.map(stripFunctions).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = stripFunctions(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

export class PreviewPanel {
  public static readonly viewType = 'hypercanvas.previewPanel';
  private static readonly PANEL_ID = 'preview';

  private _panel?: vscode.WebviewPanel;

  /**
   * Single source of truth for the component the preview is showing — repoPath
   * (astBridge key), previewPath (iframe ?component= path), navigable, and
   * needsRegeneration. Replaces four formerly-independent shadow fields. The
   * accessors below preserve their legacy private names so every read/write routes
   * through this record (HYP-369 Sub-ticket A). See PreviewComponentState.ts.
   */
  private _componentState: PreviewComponentState = createComponentState();

  /** Repo-relative component path (astBridge key). Backed by `_componentState.repoPath`. */
  private get _currentComponent(): string | undefined {
    return this._componentState.repoPath;
  }
  private set _currentComponent(repoPath: string | undefined) {
    this._componentState = { ...this._componentState, repoPath };
  }

  /**
   * Legacy navigability shim. Reads back the repoPath when navigable (so the old
   * `_navigableComponent === _currentComponent` comparisons keep working), undefined
   * otherwise. Writing a path marks navigable only when it matches the current
   * repoPath; writing undefined clears it. Backed by `_componentState.navigable`.
   */
  private get _navigableComponent(): string | undefined {
    return this._componentState.navigable ? this._componentState.repoPath : undefined;
  }
  private set _navigableComponent(navigablePath: string | undefined) {
    this._componentState = withNavigable(this._componentState, navigablePath);
  }

  /**
   * The component path as the preview dev server sees it — relative to the active
   * project root. For a monorepo this is the sub-project-relative path (the key in
   * the sub-project's __canvas_preview__ registry), which differs from
   * _currentComponent (always repo-relative, the root for astBridge edits). Used only
   * to build the iframe ?component= URL. Defaults to _currentComponent for
   * single-package projects where the two roots coincide (HYP-420).
   * Backed by `_componentState.previewPath`.
   */
  private get _previewComponent(): string | undefined {
    return this._componentState.previewPath;
  }
  private set _previewComponent(previewPath: string | undefined) {
    this._componentState = { ...this._componentState, previewPath };
  }

  /** Whether the preview must be regenerated on re-attach. Backed by `_componentState.needsRegeneration`. */
  private get _requiresPreviewRegeneration(): boolean {
    return this._componentState.needsRegeneration;
  }
  private set _requiresPreviewRegeneration(needsRegeneration: boolean) {
    this._componentState = withNeedsRegeneration(this._componentState, needsRegeneration);
  }

  /**
   * Snapshot the backing fields (`_panel`, `_devServerRunning`, `_componentState`) into
   * the pure-reducer's input shape (HYP-369 Sub-ticket B). The lifecycle NAME stays
   * derived (deriveLifecycle) — never stored — so it can never desync from direct field
   * writes. See PreviewLifecycle.ts.
   */
  private _lifecycleContext(): LifecycleContext {
    return {
      attached: this._panel !== undefined,
      devServerRunning: this._devServerRunning,
      component: this._componentState,
    };
  }

  /**
   * Route a lifecycle transition through the one pure reducer (PreviewLifecycle.reduce),
   * write the reduced component/devserver state back onto the backing fields, and hand the
   * effects to the caller. The reducer is the single decision authority for the HYP-363
   * guards (resurrection re-emit, same-path no-op); the host only executes the effects.
   */
  private _dispatch(event: LifecycleEvent): readonly LifecycleEffect[] {
    const { context, effects } = reduceLifecycle(this._lifecycleContext(), event);
    this._componentState = context.component;
    this._devServerRunning = context.devServerRunning;
    return effects;
  }

  private _defaultComponent?: string;
  private _disposables: vscode.Disposable[] = [];

  // Runtime error callback
  private _onRuntimeErrorCallback: ((error: DevServerRuntimeError | null) => void) | null = null;

  // Sample-created callback (triggers preview file regen + activation in extension host)
  private _onSampleCreatedCallback: ((componentPath: string) => Promise<void> | void) | null = null;

  // Component-missing callback (triggers self-healing ensureComponent in extension host)
  private _onComponentMissingCallback: ((componentPath: string) => void) | null = null;

  // Component-error callback (HYP-487): forwarded render errors from the iframe
  // ErrorBoundary. Extension host inspects the message for a provider-context
  // pattern and auto-generates .hyperide/preview.tsx (isolated mode) when matched.
  private _onComponentErrorCallback: ((componentPath: string, error: string) => void) | null = null;

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

  // Project capabilities (readonly mode, CSS system) — cached so _pushFullStateToWebview can replay
  private _capabilities: import('./types').ProjectCapabilities | null = null;

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
    // Full reset: clear the entire component record (repoPath/previewPath/navigable/
    // needsRegeneration) and the devserver axis through the lifecycle reducer, returning
    // the panel to Attached_NoComponent (PreviewLifecycle `workspaceReset`).
    this._dispatch({ type: 'workspaceReset' });
    this._panelRouter.setSubProjectPrefix?.('');
    this._defaultComponent = undefined;
    this._previewBaseUrl = 'http://localhost:3000';
    // Clear shared StateHub state so _initializeComponent() re-derives from the
    // active editor instead of picking up the previous workspace's component.
    this._capabilities = null;
    this._stateHub.applyUpdate({ currentComponent: null });
    this._panel?.webview.postMessage({ type: 'projectCapabilities', capabilities: null });
    this.notifyUnsupportedProject(null);
    this.notifyDevServerStopped();
    this._sampleWatcher?.dispose();
    this._sampleWatcher = undefined;
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

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message, panel.webview);
      },
      undefined,
      this._disposables,
    );

    // Set HTML once — React app handles all UI state via messages. The message
    // handler must already be registered because the webview can post
    // `webview:ready` during the initial HTML assignment.
    panel.webview.html = this._getHtmlForWebview();

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
          // Route the change through the reducer to update `_componentState` (drops
          // navigability so the iframe waits for setComponentParam), but DISCARD the
          // emitSelection effect: re-emitting here would feed StateHub.applyUpdate back
          // into this same listener — the feedback loop the HYP-363 guards exist to break
          // (PreviewPanel.ts onChange seam / no-op regression).
          this._dispatch({ type: 'componentChanged', repoPath: component.path });
          console.log('[HyperIDE] Component changed via state:', component.path);
        }
      }
    });
    this._disposables.push({ dispose: unsubState });

    this._startSyncService();

    // Cleanup on dispose
    panel.onDidDispose(() => {
      if (this._reEmitTimer) {
        clearTimeout(this._reEmitTimer);
        this._reEmitTimer = null;
      }
      // Lifecycle dispose: retain the component record but drop navigability and mark
      // regeneration so the next attach re-derives a fresh, navigable preview
      // (PreviewLifecycle `dispose`). `_panel` is nulled below — the derived lifecycle
      // becomes Detached once it is.
      this._dispatch({ type: 'dispose' });
      for (const d of this._disposables) d.dispose();
      this._disposables = [];
      this._sampleWatcher?.dispose();
      this._sampleWatcher = undefined;
      this._syncService?.dispose();
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
    // Apply the current monorepo sub-project prefix — the service may be created
    // lazily after setComponentParam already ran for this component (HYP-435).
    this._syncService.setSubProjectPrefix(deriveSubProjectPrefix(this._currentComponent, this._previewComponent));
    this._syncService.start();
    // Not added to _disposables — disposed explicitly in onDidDispose and setWorkspaceRoot
    // to avoid accumulating stale entries on workspace switches.
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
      // Push consolidated extension-side state (devserver, project error, URL,
      // current component) so a re-attached panel rehydrates without losing
      // the component selection that survived dispose+createOrShow.
      this._pushFullStateToWebview();
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
    if (msg.type === 'hypercanvas:componentMissing') {
      const componentPath = (msg as { componentPath?: string }).componentPath;
      if (componentPath) {
        this._onComponentMissingCallback?.(componentPath);
      }
      return;
    }
    if (msg.type === 'hypercanvas:componentError') {
      const { componentPath, error } = msg as { componentPath?: string; error?: string };
      if (componentPath && error) {
        this._onComponentErrorCallback?.(componentPath, error);
      }
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
      const componentPath = msg.componentPath as string | undefined;
      await this._handleCreateSampleFromError(
        componentPath,
        msg.propValues as Record<string, unknown> | undefined,
        msg.sampleName as string | undefined,
        { suggestAIKey: true },
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
        // Feature #210 — alongside the schema, tell the overlay WHICH required
        // props the deterministic generator couldn't satisfy. The overlay shows
        // only after a failed auto-render, so these are the props most likely to
        // need the user's attention.
        const unsatisfiedProps = props && props.length > 0 ? generateSamplePropValues(props).unsatisfied : [];
        webview.postMessage({
          type: 'errorBoundary:propsSchema',
          componentPath,
          propsSchema: props,
          unsatisfiedProps,
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

    // === Keyboard-driven duplicate (from iframe keyboard handler) ===
    if (msg.type === 'keyboard:duplicate') {
      const elementId = msg.elementId as string | undefined;
      const componentPath = this._currentComponent;
      if (!componentPath || !elementId) return;
      const result = await this._panelRouter.astBridge.duplicateElement(componentPath, elementId);
      if (result.success && result.newId) {
        this._stateHub.applyUpdate({ selectedIds: [result.newId] });
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
    options?: {
      componentName?: string;
      notifySampleCreated?: boolean;
      revealInEditor?: boolean;
      suggestAIKey?: boolean;
    },
  ): Promise<boolean> {
    if (!componentPath) return false;

    // componentPath from the error-boundary message is sub-project-relative in a
    // monorepo (e.g. 'src/app/ui/HostField.tsx'); re-root it through the sub-project
    // prefix so the file read doesn't miss 'targets/<app>/' and fail (HYP-479).
    const subProjectPrefix = deriveSubProjectPrefix(this._currentComponent, this._previewComponent);
    const absPath = resolveComponentAbsPath(componentPath, this._workspaceRoot, subProjectPrefix);
    const exportName = sampleName || 'SampleDefault';
    const revealInEditor = options?.revealInEditor ?? true;
    const notifySampleCreated = options?.notifySampleCreated ?? true;

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

    // Extract component name from the AST default export (e.g. `export default function Home` → 'Home').
    // Falls back to filename PascalCase if the file has no named default export.
    const fileName = path.basename(absPath, path.extname(absPath));
    const componentName = options?.componentName ?? extractComponentName(sourceCode, fileName);

    // Check if sample with this name already exists — update it in place
    const existingRegex = new RegExp(`export\\s+const\\s+${escapeRegex(exportName)}\\s*=`);
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
      const replacement = this._buildSampleScaffold(componentName, exportName, propEntries, sourceCode);

      sourceCode = sourceCode.slice(0, sampleStart) + replacement.trimStart() + sourceCode.slice(sampleEnd);

      try {
        const fileUri = vscode.Uri.file(absPath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(sourceCode, 'utf-8'));
      } catch {
        void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
        return false;
      }

      if (notifySampleCreated) {
        await this._onSampleCreatedCallback?.(componentPath);
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

    // AI generation is a fallback only for components with required props (complex case).
    // For simple components (no required props), the deterministic scaffold is sufficient.
    // When propDefs is null (parse error), we conservatively skip AI — we can't fill unknown props.
    //
    // IMPORTANT: when AI cannot run for a required-prop component, we return false instead of
    // writing a propless scaffold. A broken scaffold short-circuits the existingRegex check on
    // subsequent "Create Sample" clicks, permanently locking out the AI path.
    const hasPropValues = propValues && Object.keys(propValues).length > 0;
    let sampleWrittenByAI = false;

    if (!hasPropValues) {
      const propDefs = await this._panelRouter.componentService
        ?.getComponentDefinitions(componentPath)
        .catch(() => null);
      const hasRequiredProps = propDefs?.some((p) => p.required) ?? false;

      if (hasRequiredProps) {
        const apiKey = await this._context.secrets.get('hypercanvas.ai.apiKey');
        if (apiKey) {
          const aiGenerated = await ensureSample({
            io: new VSCodeFileIO(),
            absolutePath: absPath,
            componentName,
            sampleName: exportName,
            generate: createExtensionSampleGenerator(this._context),
          });
          if (aiGenerated.exists) {
            sampleWrittenByAI = true;
            // Fall through to shared reveal + watcher block below
          } else {
            // AI tried and failed — don't write a broken propless scaffold
            return false;
          }
        } else {
          if (options?.suggestAIKey) {
            const action = await vscode.window.showInformationMessage(
              `"${componentName}" has required props. Configure an AI key to auto-fill them.`,
              'Configure AI Key',
            );
            if (action === 'Configure AI Key') {
              void vscode.commands.executeCommand('hypercanvas.configureAIKey');
            }
          }
          // No key — writing a propless scaffold would permanently block the AI path on
          // subsequent clicks via the existingRegex short-circuit. Return false so
          // ComponentErrorOverlay stays open and the user can configure a key and retry.
          return false;
        }
      }
    }

    // Generate a minimal sample scaffold when AI did not write the sample
    let updatedCode: string | undefined;
    if (!sampleWrittenByAI) {
      const propEntries = this._buildPropEntries(propValues);
      const scaffold = this._buildSampleScaffold(componentName, exportName, propEntries, sourceCode);
      updatedCode = `${sourceCode}\n${scaffold}\n`;
      try {
        const fileUri = vscode.Uri.file(absPath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedCode, 'utf-8'));
      } catch {
        void vscode.window.showErrorMessage(`Could not write to component file: ${componentPath}`);
        return false;
      }
      console.log(`[HyperIDE] Created ${exportName} scaffold in ${componentPath}`);
    }

    if (revealInEditor) {
      // For AI-written samples re-read the file; for scaffold use the content just written
      const codeToSearch =
        updatedCode ?? Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(absPath))).toString('utf-8');
      const lines = codeToSearch.split('\n');
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

    // Watch file for sample deletion — notify webview to reset sampleCreated state
    if (this._panel) {
      this._watchSampleInFile(absPath, exportName, this._panel.webview);
    }
    if (notifySampleCreated) {
      await this._onSampleCreatedCallback?.(componentPath);
    }
    return true;
  }

  /**
   * Feature #210 — "try first, then ask", IN MEMORY ONLY.
   *
   * Before falling back to the "requires props" overlay, auto-generate best-effort
   * sample VALUES for ALL of the component's props from their TS types and inject
   * them at render time via the preview bridge. The values are posted to the webview
   * (`setGeneratedProps`), which forwards them into the cross-origin preview iframe
   * via postMessage; the generated `__canvas_preview__.tsx` holds them in React state
   * and spreads them when rendering. The component then gets a real render attempt
   * (the iframe ErrorBoundary is the probe). Only if that still fails does the
   * overlay show.
   *
   * The component source file is NEVER mutated and no synthetic file is written to
   * disk — the generated values live only in memory and are recomputed per select.
   * (Previously this scaffolded a `SampleDefault` into the source, which the CTO
   * rejected: the source must stay pristine.)
   *
   * @param componentPath path used to parse the prop schema (relative or absolute).
   * @param previewKey path the iframe keys props by — MUST equal the `?component=`
   *   URL value / preview-registry key (the project-relative path), or the iframe
   *   lookup misses and the component renders without the generated props.
   *
   * Returns true when non-empty values were posted, false when there is no panel
   * (an empty payload is still posted as a readiness signal — see below).
   */
  public async injectGeneratedSampleProps(componentPath: string, previewKey: string): Promise<boolean> {
    if (!this._panel) return false;

    // getComponent (cached) gives us both the prop schema and the display name; the
    // name is used as a meaningful `children` placeholder so a button/badge renders
    // real-looking content ("Local Button") instead of the generic "Sample".
    const component = await this._panelRouter.componentService?.getComponent(componentPath).catch(() => null);
    const propDefs = component?.props ?? null;
    const rawValues =
      propDefs && propDefs.length > 0
        ? generateSamplePropValues(propDefs, { componentName: component?.name }).values
        : {};

    // Deep-strip function values: webview postMessage uses structured clone, which
    // throws on functions — including nested ones (e.g. `{ actions: { onSave: fn } }`,
    // which generateSamplePropValues can produce by recursing into objectFields).
    // Callbacks are already covered by `callbackStubs` spread via `previewFallbackProps`
    // in the generated preview, so dropping them here loses nothing and keeps the
    // payload structured-clone safe.
    const values = stripFunctions(rawValues) as Record<string, unknown>;

    // Always post — even an empty object — so the iframe records a readiness entry
    // for this path (the ErrorBoundary resets on the first arrival) and never reuses
    // a stale payload from a previous selection.
    this._panel.webview.postMessage({
      type: 'setGeneratedProps',
      componentPath: previewKey,
      values,
    });
    return Object.keys(values).length > 0;
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
    sourceCode = '',
  ): string {
    return buildSampleScaffold({ sourceCode, componentName, exportName, propEntries });
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
    } else if (!result.success) {
      void vscode.window.showErrorMessage(`HyperCanvas: Could not duplicate element. ${result.error ?? ''}`);
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

    const childIds = await this._panelRouter.astBridge.astService.getChildElementIds(elementId);

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
   * Initialize component from active editor.
   *
   * If `_currentComponent` is already set (panel was disposed and re-created
   * while the extension host kept its in-memory state — e.g. user closed the
   * Hyper Canvas tab and reopened it via createOrShow), we do NOT re-derive
   * from the editor. The editor's active document at that moment may not be
   * the component the user was previewing, so re-deriving overwrites a valid
   * selection. Instead we push the existing state into the webview and rely
   * on the `webview:ready` handler to do the same when the React app loads.
   *
   * StateHub takes priority over the active editor. When createOrShow is called
   * from the extension.ts onChange listener (while a component-selection patch
   * is still being broadcast), StateHub already holds the user's intent.
   * Deriving from activeEditor at that moment would emit a second applyUpdate
   * for a different component, triggering a second showTextDocument call —
   * the root cause of files opening twice (HYP-363).
   */
  private _initializeComponent(activeEditor = vscode.window.activeTextEditor): void {
    if (this._currentComponent) {
      // Attach with a retained component: route through the lifecycle reducer. Its `attach`
      // case emits a re-selection effect (and clears needsRegeneration) only on the
      // resurrection seed — a re-attach after dispose (regression for f33e5ff0). A plain
      // re-attach of a still-live panel emits nothing.
      const stateComponent = this._stateHub.state.currentComponent;
      const effects = this._dispatch({ type: 'attach' });
      const resurrected = effects.some((e) => e.type === 'emitSelection');
      // Re-apply the SAME stateComponent to re-trigger onChange listeners (this is the
      // one re-emit the legacy guard fired). Only when StateHub still holds that exact
      // path; otherwise StateHub drifted and we just re-push existing webview state.
      if (resurrected && stateComponent?.path === this._currentComponent) {
        this._stateHub.applyUpdate({ currentComponent: stateComponent });
        return;
      }
      this._pushFullStateToWebview();
      return;
    }

    // StateHub already has a current component: respect that intent and do NOT
    // call _setCurrentComponent (which would emit applyUpdate and re-trigger
    // all onChange listeners). Just cache it locally so the webview gets it.
    const stateComponent = this._stateHub.state.currentComponent;
    if (stateComponent?.path) {
      // Adopt the path as current and keep navigability only if it already pointed
      // at this exact component; otherwise the iframe must wait for setComponentParam.
      const wasNavigableForPath = this._navigableComponent === stateComponent.path;
      this._currentComponent = stateComponent.path;
      this._navigableComponent = wasNavigableForPath ? stateComponent.path : undefined;
      if (this._requiresPreviewRegeneration) {
        this._requiresPreviewRegeneration = false;
        this._stateHub.applyUpdate({ currentComponent: stateComponent });
      }
      return;
    }

    // No component in StateHub yet — derive from the active editor (first open).
    this._syncWorkspaceRootFromVSCode();
    const component = this._resolveComponentPath(activeEditor);
    if (component) {
      this._setCurrentComponent(component);
    }
  }

  /**
   * Push consolidated extension-side state into the webview in one shot.
   * Called from `webview:ready` (initial load) and `_initializeComponent`
   * (re-attach after panel dispose) so the React app rehydrates devserver
   * status, project error, iframe URL, and the current component without
   * relying on incidental ordering of subsequent setX() calls.
   *
   * Idempotent — safe to call repeatedly. No-op if no panel is attached.
   */
  private _pushFullStateToWebview(): void {
    const webview = this._panel?.webview;
    if (!webview) return;

    webview.postMessage({
      type: 'devserver:statusChanged',
      running: this._devServerRunning,
      url: this._devServerRunning ? this._previewBaseUrl : null,
    });

    const autoStart = vscode.workspace.getConfiguration('hypercanvas.devServer').get<boolean>('autoStart', false);
    webview.postMessage({ type: 'devserver:settings', autoStart });

    webview.postMessage({ type: 'projectCapabilities', capabilities: this._capabilities ?? null });

    if (this._projectError) {
      webview.postMessage({ type: 'projectError', error: this._projectError });
    }

    if (this._componentState.repoPath && canNavigate(this._componentState)) {
      webview.postMessage({ type: 'setComponent', component: this._componentState.repoPath });
    }

    if (this._devServerRunning) {
      this._updatePreviewUrl();
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
    // Route through the lifecycle reducer: `componentChanged` drops navigability and the
    // stale sub-project preview path on a real change (the extension re-supplies the
    // preview path via setComponentParam when this component is (re)selected through the
    // pipeline) and decides — via the single `emitSelection` rule — whether this is a
    // real selection or the same-path no-op that must NOT re-fire onChange listeners.
    const effects = this._dispatch({ type: 'componentChanged', repoPath: component });
    this._runSelectionEffects(effects);
  }

  /**
   * Execute `emitSelection` effects from the lifecycle reducer: broadcast the selected
   * component to StateHub so Inspector and other panels sync. The StateHub guard (skip
   * when it already holds the identical name+path) preserves the legacy no-op check at
   * the StateHub seam (the reducer already suppressed the same-repoPath case).
   */
  private _runSelectionEffects(effects: readonly LifecycleEffect[]): void {
    for (const effect of effects) {
      if (effect.type !== 'emitSelection') continue;
      const component = effect.repoPath;
      const name = component.replace(/^.*\//, '').replace(/\.\w+$/, '');
      const current = this._stateHub.state.currentComponent;
      if (current?.path === component && current.name === name) continue;
      this._stateHub.applyUpdate({ currentComponent: { name, path: component } });
    }
  }

  /**
   * Update preview URL
   */
  private _updatePreviewUrl(): void {
    // No iframe to update when dev server isn't running
    if (!this._devServerRunning) {
      return;
    }

    const component = this._componentState.repoPath || this._defaultComponent;

    // No component selected — show hint instead of loading bare URL
    if (!component) {
      console.log('[HyperIDE] No component selected, showing hint');
      this._panel?.webview.postMessage({ type: 'showNoComponentHint' });
      return;
    }

    if (needsNavigationWait(this._componentState)) {
      return;
    }

    // The iframe URL must use the preview (project-root-relative) path so the dev
    // server's __canvas_preview__ registry key matches. previewPath is set
    // alongside repoPath by setComponentParam; fall back to the repo-relative
    // component for paths that coincide (single-package projects, _defaultComponent).
    const previewComponent =
      this._componentState.repoPath && this._componentState.previewPath ? this._componentState.previewPath : component;

    const baseUrl = `${this._previewBaseUrl}/test-preview`;
    const url = `${baseUrl}?component=${encodeURIComponent(previewComponent)}`;

    console.log('[HyperIDE] Updating URL:', url);

    this._panel?.webview.postMessage({ type: 'updateUrl', url });
  }

  /**
   * Set preview URL (called by dev server when started)
   */
  public setPreviewUrl(url: string): void {
    this._previewBaseUrl = url;
    this._dispatch({ type: 'devserverStatusChanged', running: true });

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
    this._dispatch({ type: 'devserverStatusChanged', running: false });
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
    this._capabilities = capabilities;
    this._panel?.webview.postMessage({ type: 'projectCapabilities', capabilities });
  }

  /**
   * Refresh preview
   */
  public refresh(): void {
    if (!this._panel) return;
    // Re-push full state before reloading — guards against races where
    // webview:ready fired before _pushFullStateToWebview had current state
    // (e.g. openPreview called before devserver:statusChanged propagated).
    this._pushFullStateToWebview();
    if (this._currentComponent && this._navigableComponent !== this._currentComponent) {
      return;
    }
    this._panel.webview.postMessage({ type: 'refresh' });
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
    // Drop navigability + mark regeneration via the lifecycle reducer before tearing the
    // panel down. `_panel.dispose()` fires onDidDispose, which also dispatches `dispose`
    // (idempotent) and nulls `_panel`, moving the derived lifecycle to Detached.
    this._dispatch({ type: 'dispose' });
    this._panel?.dispose();
  }

  /**
   * Update iframe component URL param without a hard reload.
   * Triggers navigation to /test-preview?component=<previewComponentPath>.
   *
   * @param componentPath repo-relative path — the identity used for AST edits and
   *   the `setComponent` webview message (must match the repo-rooted astBridge).
   * @param previewComponentPath project-root-relative path used to build the iframe
   *   ?component= URL. For a monorepo this is the sub-project-relative path; defaults
   *   to componentPath when the project and repo roots coincide.
   */
  public setComponentParam(componentPath: string, previewComponentPath: string = componentPath): void {
    // Pending -> Live: the preview is generated and the registry is ready, so the
    // component becomes navigable (PreviewLifecycle `selectComponentParam`).
    this._dispatch({ type: 'selectComponentParam', repoPath: componentPath, previewPath: previewComponentPath });

    // Re-root iframe-driven AST edits for monorepo sub-projects. The iframe sees
    // sub-project-relative paths (previewComponentPath form) but the repo-rooted
    // AstService keys files repo-relative (componentPath form). Pin the prefix so
    // edits resolve the correct sub-project source even on suffix collisions
    // across targets. Empty for single-package projects (paths coincide) — a
    // no-op. (HYP-430)
    const subProjectPrefix = deriveSubProjectPrefix(componentPath, previewComponentPath);
    this._panelRouter.setSubProjectPrefix?.(subProjectPrefix);
    this._syncService?.setSubProjectPrefix(subProjectPrefix);

    if (!this._panel) return;

    if (this._devServerRunning) {
      this._updatePreviewUrl();
      return;
    }

    // Post the preview (project-root-relative) path: the iframe navigates to it and
    // the sub-project's __canvas_preview__ registry is keyed by that path, not the
    // repo-relative one (HYP-420).
    this._panel.webview.postMessage({
      type: 'setComponent',
      component: previewComponentPath,
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
          resolve(this._stateHub.state.selectedIds ?? []);
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
    } else if (!result.success) {
      void vscode.window.showErrorMessage(`HyperCanvas: Could not duplicate element. ${result.error ?? ''}`);
    }
  }

  /**
   * Go to code location of the first selected element (called from VS Code keybinding command).
   * Mirrors _handleContextMenuGoToCode but driven by VS Code keyboard shortcut rather than
   * the iframe context menu, so it works even when !inputFocus guard blocks iframe key events.
   */
  public async goToCodeSelected(): Promise<void> {
    const selectedIds = await this._waitForSelectedIds();
    const componentPath = this._currentComponent;
    const panel = this._panel;
    if (!componentPath || !selectedIds?.length || !panel) return;

    const loc = await this._panelRouter.astBridge.astService.getElementLocation(componentPath, selectedIds[0]);
    if (loc) {
      await handleEditorMessage(
        { type: 'editor:goToCode', path: componentPath, line: loc.line, column: loc.column + 1 },
        panel.webview,
      );
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
      const childIds = await this._panelRouter.astBridge.astService.getChildElementIds(selectedIds[0]);
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
        const childItemIndex = this._stateHub.state.selectedItemIndices?.[selectedIds[0]] ?? null;
        this._stateHub.applyUpdate({
          selectedIds: [parentId],
          selectedItemIndices: { [parentId]: childItemIndex },
          hoveredId: null,
          hoveredItemIndex: null,
        });
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
    this._stateHub.applyUpdate({
      selectedIds: [elementId],
      selectedItemIndices: {},
      selectedElementRuntimeStyle: null,
    });
  }

  /**
   * Programmatically select multiple elements by their nodeRefs.
   */
  public selectElements(elementIds: string[]): void {
    this._stateHub.applyUpdate({ selectedIds: elementIds, selectedItemIndices: {}, selectedElementRuntimeStyle: null });
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
    // No native redo fallback — applyEdit() syncs populate VS Code's native undo stack,
    // causing spurious file writes when canRedo()=false. Canvas redo is self-contained.
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

    // 2000ms delay: Vite HMR under Docker load takes 1-2s to rebuild the fiber
    // tree. Re-emitting at 300ms (original) races the HMR settle — the selection
    // update arrives before the iframe is ready, gets dropped, and the inspector
    // loses element context (observed: inspector poll times out at 20s in run #23).
    this._reEmitTimer = setTimeout(() => {
      this._reEmitTimer = null;
      // Re-read state — selection may have been cleared by user action
      // during the delay window
      const currentIds = this._stateHub.state.selectedIds;
      if (!currentIds?.length) return;

      console.log('[PreviewPanel] Re-emitting selection after HMR:', currentIds);
      this._stateHub.applyUpdate({ selectedIds: currentIds });
    }, 2000);
  }

  /**
   * Set callback for runtime errors from iframe preview
   */
  public onRuntimeError(callback: (error: DevServerRuntimeError | null) => void): void {
    this._onRuntimeErrorCallback = callback;
  }

  /**
   * Set callback for component-missing signals from the preview iframe.
   * Extension host wires this to PreviewFileManager.ensureComponent() with a retry guard.
   */
  public onComponentMissing(callback: (componentPath: string) => void): void {
    this._onComponentMissingCallback = callback;
  }

  /**
   * Set callback for render errors caught by the iframe ErrorBoundary (HYP-487).
   * Extension host inspects `error` for a provider-context pattern and, when it
   * matches, auto-generates `.hyperide/preview.tsx` so the component renders
   * inside its providers (isolated mode).
   */
  public onComponentError(callback: (componentPath: string, error: string) => void): void {
    this._onComponentErrorCallback = callback;
  }

  /**
   * Set callback for sample creation from the preview overlay.
   * Extension host uses this to regenerate the preview registry before reloading.
   */
  public onSampleCreated(callback: (componentPath: string) => Promise<void> | void): void {
    this._onSampleCreatedCallback = callback;
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
      // Update StateHub so inspector (right panel) and explorer (left panel) receive selection.
      // Clear stale .map() item snapshot so inspector shows correct colors for the new selection.
      this._stateHub.applyUpdate({
        selectedIds: [elementId],
        selectedItemIndices: {},
        selectedElementRuntimeStyle: null,
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
