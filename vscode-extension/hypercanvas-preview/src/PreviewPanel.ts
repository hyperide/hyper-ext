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
import * as vscode from 'vscode';
import { normalizeSampleComponentName } from '@lib/preview-generator';
import type { RouteSuggestion } from '@lib/preview-generator/route-heuristics';
import type { ComponentGroup, ComponentsData } from '@lib/component-scanner/types';
import type { ColorProbeCandidate, ColorProbeRequest } from './services/color-probe-types';
import { handleEditorMessage } from './EditorBridge';
import {
  injectGeneratedSampleProps,
  watchSampleInFile,
  buildPropEntries,
  buildSampleScaffold,
} from './preview-panel-sample';
import { setupPanel, type PanelSetupDeps } from './preview-panel-setup';
import { handleCreateSampleFromError } from './preview-panel-error-handler';
import { routeMessage, type MessageRouterDeps } from './preview-panel-message-router';
import { type PanelKind, TelemetryEvents } from './telemetry/events';
import type { TelemetrySink } from './telemetry/TelemetryService';
import { deriveSubProjectPrefix } from './bridges/monorepo-path-translate';
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
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import {
  handleContextMenuGoToCode,
  handleContextMenuDuplicate,
  handleContextMenuDelete,
  handleContextMenuWrapInDiv,
  handleContextMenuCopy,
  handleContextMenuPaste,
  handleContextMenuCut,
  handleContextMenuSelectParent,
  handleContextMenuSelectChild,
  handleContextMenuCopyContent,
  handleElementContentResult,
  handleScreenshotResult,
} from './preview-panel-context-menu';
import { SyncPositionService } from './services/SyncPositionService';
import type { DevServerRuntimeError, NonPreviewableFilePayload, UnsupportedProjectError } from './types';
import { generatePreviewHtml } from './preview-html';
import { postToWebviewSafe, readWebviewSafe } from './webview-post';

export { normalizeSampleComponentName };

/**
 * Build the canvas component-picker payload (atom/composite/page) from a scan result.
 *
 * For monorepos the scanner mirrors the union of sub-project atom/composite groups into the flat
 * fields but deliberately leaves flat `pageGroups: []` (the SaaS PagesSection renders flat pages
 * unconditionally and would double-render — see scanner.ts). The canvas picker is a single flat
 * list with no such conflict, so fold the sub-project page groups in here; otherwise monorepo
 * pages — and a monorepo whose only entries are pages — stay unreachable from the panel-less
 * canvas this picker exists to fix.
 */
export function toPickerGroups(data: ComponentsData): {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
} {
  const subProjectPageGroups = data.subProjects?.flatMap((sp) => sp.pageGroups) ?? [];
  return {
    atomGroups: data.atomGroups,
    compositeGroups: data.compositeGroups,
    pageGroups: [...data.pageGroups, ...subProjectPageGroups],
  };
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

  // Telemetry: render-success forward (host emits preview.renderSucceeded +
  // funnel.firstPreview) and the allow-listed webview-origin event sink.
  private _onRenderSucceededCallback: ((componentPath: string | undefined) => void) | null = null;
  private _telemetrySink: TelemetrySink | null = null;
  // Dedupe holder for inspector.elementInspected (see emitInspectorElementInspected).
  private readonly _inspectorSelection: { lastKey: string | null } = { lastKey: null };

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

  // Pending live-className requests (HYP-544 write-time DOM-anchor round-trip)
  private _pendingClassNameRequests = new Map<string, (result: { className: string | null }) => void>();

  // Pending empirical color-probe requests (HYP-544 Phase 3 — which candidate drives the color)
  private _pendingProbeRequests = new Map<string, (result: { driving: ColorProbeCandidate[] }) => void>();

  // Preview URL (set dynamically when dev server starts)
  private _previewBaseUrl = 'http://localhost:3000';

  // Whether dev server is actually running
  private _devServerRunning = false;

  // App-mode entry path (sub-project-relative, the iframe ?component= form) for which
  // app-mode is currently active, or null when off. When set and it matches the current
  // preview component, the iframe URL gets `&app=1` so the generated preview renders the
  // entry root raw (its own router + providers) and shows the address bar. Set/cleared by
  // setAppMode/clearAppMode; the extension host owns activation (the previewAsApp command).
  private _appModeEntryPreviewPath: string | null = null;

  // Unsupported project error (React Native / Tamagui), sent to webview on ready
  private _projectError: UnsupportedProjectError | null = null;

  // Bumped on every direct screen decision (notifyUnsupportedProject); lets
  // setReactNativeUnsupported discard stale async detection results (HYP-588)
  private _screenDecisionSeq = 0;

  // Project capabilities (readonly mode, CSS system) — cached so _pushFullStateToWebview can replay
  private _capabilities: import('./types').ProjectCapabilities | null = null;

  // True when BOTH side panels (Explorer + Inspector) are hidden — gates the canvas component
  // picker (#92). Defaults true: with neither panel ever opened the host fires no visibility
  // change, and that is exactly the both-closed scenario the picker exists for. extension.ts
  // recomputes this from the two providers' visibility and calls setSidePanelsHidden.
  private _sidePanelsHidden = true;

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
    this._postToWebview({ type: 'projectCapabilities', capabilities: null });
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
  private _setupPanel(panel: vscode.WebviewPanel, activeEditor?: vscode.TextEditor): void {
    setupPanel(this._panelSetupDeps(), panel, activeEditor, PreviewPanel.PANEL_ID);
    // Telemetry: the preview panel just opened (covers both createOrShow paths).
    const panelKind: PanelKind = 'preview';
    this._telemetrySink?.track(TelemetryEvents.panelOpened, { panel: panelKind });
  }
  private _panelSetupDeps(): PanelSetupDeps {
    return {
      extensionUri: this._extensionUri,
      stateHub: this._stateHub,
      panelRouter: this._panelRouter,
      setPanel: (panel) => {
        this._panel = panel;
      },
      getPanel: () => this._panel,
      getDisposables: () => this._disposables,
      setDisposables: (disposables) => {
        this._disposables = disposables;
      },
      getCurrentComponent: () => this._currentComponent,
      getReEmitTimer: () => this._reEmitTimer,
      setReEmitTimer: (timer) => {
        this._reEmitTimer = timer;
      },
      getSampleWatcher: () => this._sampleWatcher,
      setSampleWatcher: (watcher) => {
        this._sampleWatcher = watcher;
      },
      getSyncService: () => this._syncService,
      setSyncService: (service) => {
        this._syncService = service;
      },
      getHtmlForWebview: () => this._getHtmlForWebview(),
      handleMessage: (message, webview) => this._handleMessage(message, webview),
      updateComponentFromEditor: (editor) => this._updateComponentFromEditor(editor),
      dispatch: (event) => this._dispatch(event),
      startSyncService: () => this._startSyncService(),
      initializeComponent: (activeEditor) => this._initializeComponent(activeEditor),
      onPanelClosed: () => this._telemetrySink?.track(TelemetryEvents.panelClosed, { panel: 'preview' }),
    };
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
  async _handleMessage(message: unknown, webview: vscode.Webview): Promise<void> {
    await routeMessage(this._messageRouterDeps(), message, webview);
  }
  private _messageRouterDeps(): MessageRouterDeps {
    return {
      stateHub: this._stateHub,
      panelRouter: this._panelRouter,
      context: this._context,
      currentComponent: this._currentComponent,
      previewComponent: this._previewComponent,
      workspaceRoot: this._workspaceRoot,
      panel: this._panel,
      onScopeChange: this._onScopeChange,
      onRuntimeErrorCallback: this._onRuntimeErrorCallback,
      onConsoleCaptureCallback: this._onConsoleCaptureCallback,
      pushFullStateToWebview: () => this._pushFullStateToWebview(),
      updatePreviewUrl: () => this._updatePreviewUrl(),
      bumpStyleVersion: () => this._bumpStyleVersion(),
      reEmitSelectionAfterHmr: () => this._reEmitSelectionAfterHmr(),
      onComponentMissingCallback: this._onComponentMissingCallback,
      onComponentErrorCallback: this._onComponentErrorCallback,
      onRenderSucceededCallback: this._onRenderSucceededCallback,
      telemetrySink: this._telemetrySink,
      track: this._telemetrySink ? (name, props) => this._telemetrySink?.track(name, props) : null,
      inspectorSelection: this._inspectorSelection,
      undo: () => this.undo(),
      redo: () => this.redo(),
      handleCreateSampleFromError: (componentPath, propValues, sampleName, options) =>
        this._handleCreateSampleFromError(componentPath, propValues, sampleName, options),
      handleContextMenuGoToCode: (msg, wv) => this._handleContextMenuGoToCode(msg, wv),
      handleContextMenuDuplicate: (msg) => this._handleContextMenuDuplicate(msg),
      handleContextMenuDelete: (msg) => this._handleContextMenuDelete(msg),
      handleContextMenuWrapInDiv: (msg) => this._handleContextMenuWrapInDiv(msg),
      handleContextMenuCopy: (msg) => this._handleContextMenuCopy(msg),
      handleContextMenuPaste: (msg) => this._handleContextMenuPaste(msg),
      handleContextMenuCut: (msg) => this._handleContextMenuCut(msg),
      handleContextMenuSelectParent: (msg) => this._handleContextMenuSelectParent(msg),
      handleContextMenuSelectChild: (msg) => this._handleContextMenuSelectChild(msg),
      handleContextMenuCopyContent: (msg, wv, mode) => this._handleContextMenuCopyContent(msg, wv, mode),
      handleElementContentResult: (msg) => this._handleElementContentResult(msg),
      handleScreenshotResult: (msg) => this._handleScreenshotResult(msg),
      handleLiveClassNameResult: (msg) => this._handleLiveClassNameResult(msg),
      handleProbeColorCandidatesResult: (msg) => this._handleProbeColorCandidatesResult(msg),
    };
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
    return handleCreateSampleFromError(
      {
        currentComponent: this._currentComponent,
        previewComponent: this._previewComponent,
        workspaceRoot: this._workspaceRoot,
        onSampleCreatedCallback: this._onSampleCreatedCallback
          ? (repoRelativePath) => Promise.resolve(this._onSampleCreatedCallback?.(repoRelativePath))
          : undefined,
        buildPropEntries: (pv) => this._buildPropEntries(pv),
        buildSampleScaffold: (cn, en, pe, sc) => this._buildSampleScaffold(cn, en, pe, sc),
        panel: this._panel,
        stateHub: this._stateHub,
        watchSampleInFile: (ap, en, wv) => this._watchSampleInFile(ap, en, wv),
        panelRouter: this._panelRouter,
        context: this._context,
      },
      componentPath,
      propValues,
      sampleName,
      options,
    );
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
   * (an empty payload is still posted as a readiness signal — see below), and also
   * false when the panel was disposed mid-flight (the post was skipped).
   */
  public async injectGeneratedSampleProps(componentPath: string, previewKey: string): Promise<boolean> {
    return injectGeneratedSampleProps(this._panel, this._panelRouter, componentPath, previewKey, () =>
      this._clearDisposedPanel(),
    );
  }
  private _sampleWatcher?: vscode.Disposable;

  private _watchSampleInFile(absPath: string, exportName: string, webview: vscode.Webview): void {
    watchSampleInFile({ watcher: this._sampleWatcher }, absPath, exportName, webview);
  }
  private _buildPropEntries(propValues?: Record<string, unknown>): Array<[string, unknown]> {
    return buildPropEntries(propValues);
  }
  private _buildSampleScaffold(
    componentName: string,
    exportName: string,
    propEntries: Array<[string, unknown]>,
    sourceCode = '',
  ): string {
    return buildSampleScaffold(componentName, exportName, propEntries, sourceCode);
  }
  private _contextMenuDeps() {
    return {
      currentComponent: this._currentComponent,
      panelRouter: this._panelRouter,
      stateHub: this._stateHub,
      pendingContentRequests: this._pendingContentRequests,
      pendingScreenshotRequests: this._pendingScreenshotRequests,
      generateRandomId: this._generateRandomId.bind(this),
    };
  }
  // === Context menu handlers ===
  // Delegated to preview-panel-context-menu.ts
  private async _handleContextMenuGoToCode(msg: { [key: string]: unknown }, webview: vscode.Webview): Promise<void> {
    return handleContextMenuGoToCode(this._contextMenuDeps(), msg, webview);
  }
  private async _handleContextMenuDuplicate(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuDuplicate(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuDelete(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuDelete(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuWrapInDiv(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuWrapInDiv(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuCopy(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuCopy(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuPaste(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuPaste(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuCut(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuCut(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuSelectParent(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuSelectParent(this._contextMenuDeps(), msg);
  }
  private async _handleContextMenuSelectChild(msg: { [key: string]: unknown }): Promise<void> {
    return handleContextMenuSelectChild(this._contextMenuDeps(), msg);
  }
  private _handleContextMenuCopyContent(
    msg: { [key: string]: unknown },
    webview: vscode.Webview,
    mode: 'text' | 'html',
  ): void {
    return handleContextMenuCopyContent(this._contextMenuDeps(), msg, webview, mode);
  }
  private _handleElementContentResult(msg: { [key: string]: unknown }): void {
    return handleElementContentResult(this._contextMenuDeps(), msg);
  }
  private _handleScreenshotResult(msg: { [key: string]: unknown }): void {
    return handleScreenshotResult(this._contextMenuDeps(), msg);
  }

  private _handleLiveClassNameResult(msg: { [key: string]: unknown }): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    const callback = this._pendingClassNameRequests.get(requestId);
    if (callback) {
      callback({ className: typeof msg.className === 'string' ? msg.className : null });
      this._pendingClassNameRequests.delete(requestId);
    }
  }

  private _handleProbeColorCandidatesResult(msg: { [key: string]: unknown }): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    const callback = this._pendingProbeRequests.get(requestId);
    if (callback) {
      const driving = Array.isArray(msg.driving) ? (msg.driving as ColorProbeCandidate[]) : [];
      callback({ driving });
      this._pendingProbeRequests.delete(requestId);
    }
  }

  /**
   * Run the empirical color-probe against an element in the preview iframe (HYP-544 Phase 3).
   * Used when an inspector color edit reaches the host from a source the static AST classifier
   * can't resolve: the iframe enumerates candidate value-bearing tokens (§4) and verifies, via
   * the Tier-1 off-screen-clone probe (§5.1), which candidate actually DRIVES the element's
   * color to the requested value. Returns the ranked driving-candidate list (empty = none drive
   * → host degrades to the §7 floor). Same request/response + 800ms-timeout shape as
   * requestLiveClassName. The `elementId` MUST be the iframe-relative id (findElementsByRef).
   */
  requestProbeColorCandidates(request: ColorProbeRequest): Promise<ColorProbeCandidate[]> {
    const webview = this._liveWebview();
    if (!webview || !request.elementId || !request.requestedColor) return Promise.resolve([]);

    const requestId = `colorprobe-${Date.now()}-${this._generateRandomId(6)}`;

    return new Promise((resolve) => {
      this._pendingProbeRequests.set(requestId, (result) => {
        resolve(result.driving);
      });

      const posted = this._postToWebview({
        type: 'probeColorCandidates',
        elementId: request.elementId,
        itemIndex: request.itemIndex ?? null,
        prefixes: request.prefixes,
        cssProp: request.cssProp,
        requestedColor: request.requestedColor,
        requestClass: request.requestClass,
        requestId,
      });
      // Webview disposed mid-flight: no iframe will ever answer, so resolve now instead of
      // leaking the pending entry until the timeout below fires.
      if (!posted) {
        this._pendingProbeRequests.delete(requestId);
        resolve([]);
        return;
      }

      // Timeout mirrors the live-className RPC: resolve [] if the iframe doesn't answer
      // (e.g. mid-HMR reload). 800ms is well under any human-perceptible write latency and
      // never blocks the write — the host then degrades to the static AST / §7 floor.
      setTimeout(() => {
        if (this._pendingProbeRequests.has(requestId)) {
          this._pendingProbeRequests.delete(requestId);
          resolve([]);
        }
      }, 800);
    });
  }

  /**
   * Fetch the LIVE applied `class` attribute of an element from the preview iframe (HYP-544).
   * Used as the write-time `domClasses` source for the inspector color write: the inspector
   * runs in the right-panel webview, which has no preview iframe of its own, so this host
   * round-trip is the only way to read the element's real applied classes at write time.
   * Same request/response shape as takeScreenshot. Resolves null on no-panel / element-not-found
   * / timeout — the caller then degrades to the static AST write. The `elementId` MUST be the
   * iframe-relative id (sub-project-relative in a monorepo), matching findElementsByRef.
   * `itemIndex` selects the occurrence at a repeated JSX site (.map() row) so the anchor
   * reads the element the user is editing, not always the first rendered instance.
   */
  requestLiveClassName(elementId: string, itemIndex?: number | null): Promise<string | null> {
    const webview = this._liveWebview();
    if (!webview || !elementId) return Promise.resolve(null);

    const requestId = `classname-${Date.now()}-${this._generateRandomId(6)}`;

    return new Promise((resolve) => {
      this._pendingClassNameRequests.set(requestId, (result) => {
        resolve(result.className);
      });

      const posted = this._postToWebview({
        type: 'requestLiveClassName',
        elementId,
        itemIndex: itemIndex ?? null,
        requestId,
      });
      // Webview disposed mid-flight: no iframe will ever answer, so resolve now instead of
      // leaking the pending entry until the timeout below fires.
      if (!posted) {
        this._pendingClassNameRequests.delete(requestId);
        resolve(null);
        return;
      }

      // Timeout: resolve null if the iframe doesn't answer (e.g. mid-HMR reload).
      // 800ms is well under any human-perceptible write latency and never blocks the write.
      setTimeout(() => {
        if (this._pendingClassNameRequests.has(requestId)) {
          this._pendingClassNameRequests.delete(requestId);
          resolve(null);
        }
      }, 800);
    });
  }
  /**
   * Take a screenshot of the preview or a specific element.
   * Returns base64 PNG data URL, or null if screenshot failed.
   */
  takeScreenshot(elementId?: string): Promise<string | null> {
    const webview = this._liveWebview();
    if (!webview) return Promise.resolve(null);

    const requestId = `screenshot-${Date.now()}-${this._generateRandomId(6)}`;

    return new Promise((resolve) => {
      this._pendingScreenshotRequests.set(requestId, (result) => {
        resolve(result.dataUrl);
      });

      const posted = this._postToWebview({
        type: 'takeScreenshot',
        elementId: elementId ?? null,
        requestId,
      });
      // Webview disposed mid-flight: no iframe will ever answer, so resolve now instead of
      // leaking the pending entry until the timeout below fires.
      if (!posted) {
        this._pendingScreenshotRequests.delete(requestId);
        resolve(null);
        return;
      }

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
    if (!this._panel) return;

    // Route every post through _postToWebview: if the panel was disposed mid-flight
    // the first post drops the stale reference and the rest short-circuit on the
    // null check, instead of five `Webview is disposed` throws.
    this._postToWebview({
      type: 'devserver:statusChanged',
      running: this._devServerRunning,
      url: this._devServerRunning ? this._previewBaseUrl : null,
    });

    const autoStart = vscode.workspace.getConfiguration('hypercanvas.devServer').get<boolean>('autoStart', false);
    this._postToWebview({ type: 'devserver:settings', autoStart });

    this._postToWebview({ type: 'projectCapabilities', capabilities: this._capabilities ?? null });

    if (this._projectError) {
      this._postToWebview({ type: 'projectError', error: this._projectError });
    }
    if (this._componentState.repoPath && canNavigate(this._componentState)) {
      this._postToWebview({ type: 'setComponent', component: this._componentState.repoPath });
    }
    if (this._devServerRunning) {
      this._updatePreviewUrl();
    }
    // Canvas component picker (#92): replay the both-panels-hidden flag and the scanner groups so a
    // freshly-mounted (or restored) preview webview can render the picker without waiting for the
    // next visibility toggle.
    this._postToWebview({ type: 'preview:sidePanelsHidden', hidden: this._sidePanelsHidden });
    void this._sendComponentGroups();
  }
  /**
   * Update the both-side-panels-hidden flag and replay it to the webview. When both panels are
   * hidden the canvas picker is about to show, so refresh the scanner groups too — this recovers
   * from a cold/empty scan at first mount (same rationale as the Inspector's hide-Explorer refresh).
   */
  public setSidePanelsHidden(hidden: boolean): void {
    this._sidePanelsHidden = hidden;
    this._postToWebview({ type: 'preview:sidePanelsHidden', hidden });
    if (hidden) void this._sendComponentGroups();
  }
  /**
   * Push the scanner component groups (atom/composite/page) to the preview webview for the canvas
   * picker. Same data source the Inspector quick-list uses (PanelRouter.getComponentGroups), posted
   * through the disposed-safe poster since the scan awaits filesystem work.
   */
  private async _sendComponentGroups(): Promise<void> {
    try {
      const result = await this._panelRouter.getComponentGroups();
      this._postToWebview({ type: 'preview:componentGroups', ...toPickerGroups(result.data) });
    } catch (e) {
      console.error('[PreviewPanel] Failed to load component groups:', e);
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
      this._postToWebview({ type: 'showNoComponentHint' });
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
    let url = `${baseUrl}?component=${encodeURIComponent(previewComponent)}`;

    // App-mode: the generated preview reads `&app=1` to render the entry root raw
    // (its own router + providers) instead of in component-isolation. Only append it
    // when app-mode is active for THIS exact preview component — a switch to another
    // component leaves _appModeEntryPreviewPath stale until clearAppMode runs, so the
    // path match keeps the flag from leaking onto an unrelated component's URL.
    if (this._appModeEntryPreviewPath && this._appModeEntryPreviewPath === previewComponent) {
      url += '&app=1';
    }

    console.log('[HyperIDE] Updating URL:', url);

    this._postToWebview({ type: 'updateUrl', url });
  }
  /**
   * Set preview URL (called by dev server when started)
   */
  public setPreviewUrl(url: string): void {
    this._previewBaseUrl = url;
    this._dispatch({ type: 'devserverStatusChanged', running: true });

    // Notify React webview of devserver status change
    this._postToWebview({
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
    this._postToWebview({
      type: 'devserver:statusChanged',
      running: false,
      url: null,
    });
  }
  /**
   * Surface the non-previewable-file error (clear error + clickable recommendations)
   * in the canvas instead of the iframe's infinite "Generating sample…" spinner.
   * Pass null to clear it (e.g. when a previewable component is later selected).
   */
  public notifyNonPreviewableFile(payload: NonPreviewableFilePayload | null): void {
    this._postToWebview({ type: 'previewUnsupportedFile', payload });
  }

  /**
   * Notify webview that the project type is unsupported (e.g. React Native / Tamagui).
   * Pass null to clear the error (e.g. after fix installed react-native-web).
   * Every call is a direct, authoritative screen decision — it bumps the decision
   * token so any async detection that started earlier is recognized as stale and
   * discarded by setReactNativeUnsupported (HYP-588).
   */
  public notifyUnsupportedProject(error: UnsupportedProjectError | null): void {
    this._screenDecisionSeq++;
    this._projectError = error;
    this._postToWebview({ type: 'projectError', error });
  }

  /**
   * Monotonic token identifying the latest direct screen decision (any
   * notifyUnsupportedProject call). Background project detection captures it
   * synchronously BEFORE awaiting its async detectors and hands it back to
   * setReactNativeUnsupported, which drops the result if a newer decision —
   * fix-command clear, selection framework screen, workspace reset — landed
   * while detection was in flight (HYP-588).
   */
  public get screenDecisionToken(): number {
    return this._screenDecisionSeq;
  }
  /**
   * Clear ONLY the selection-driven blocking screen (framework-compat, HYP-442) —
   * used when a later component selection succeeds and the screen must give way to
   * the working preview. Deliberately leaves a 'react-native' projectError intact,
   * so a genuine react-native block is not wiped by an unrelated successful selection.
   */
  public clearSelectionBlockingScreen(): void {
    if (this._projectError?.type !== 'framework') return;
    this.notifyUnsupportedProject(null);
  }

  /**
   * Set or clear ONLY the react-native blocking screen owned by background project
   * detection (runProjectDetection). Two guards, in order (HYP-442/443 + HYP-588):
   *
   * 1. Staleness (decisionToken): the caller captures screenDecisionToken before
   *    starting async detection; if any direct screen decision landed in between
   *    (fix command cleared the RN screen after installing react-native-web,
   *    selection posted a framework screen, workspace reset), the detection result
   *    reflects a project state that decision already superseded — discard it
   *    wholesale. Type precedence alone cannot catch the fix-command race because
   *    both sides are the RN channel.
   * 2. Type precedence: the detector only ever produces a 'react-native' error
   *    (or null), so its null result must never clobber a selection-driven
   *    'framework' compat screen — clearing is scoped to a standing RN error.
   *    (Inverse of clearSelectionBlockingScreen.)
   */
  public setReactNativeUnsupported(error: UnsupportedProjectError | null, decisionToken: number): void {
    if (decisionToken !== this._screenDecisionSeq) return;
    if (error) {
      this.notifyUnsupportedProject(error);
      return;
    }
    // No RN error: clear only if the standing error is an RN one. Leave a
    // selection-driven 'framework' screen untouched.
    if (this._projectError?.type === 'react-native') {
      this.notifyUnsupportedProject(null);
    }
  }

  /**
   * Notify the webview about project capabilities (readonly mode, CSS system).
   * Sent after CSS system detection completes during activation.
   */
  public notifyCapabilities(capabilities: import('./types').ProjectCapabilities): void {
    this._capabilities = capabilities;
    this._postToWebview({ type: 'projectCapabilities', capabilities });
  }

  /**
   * Merge a freshly-computed per-(sub-)repo support breakdown into the cached
   * capabilities and re-post (HYP-788). Additive: only the `supportDimensions` field is
   * touched, so the existing readonly/cssSystem behavior set by notifyCapabilities is
   * preserved. Used on component selection in a monorepo, where the active sub-repo (and
   * thus its dimension tabs) changes without a full capability re-detection.
   *
   * No-op (returns false) until activation detection has produced a base capabilities
   * object — the dimensions only make sense alongside the rest of the project's
   * capabilities. The caller uses the return value to avoid caching a sub-repo as "already
   * applied" when the merge was dropped (so a later selection retries once caps exist).
   */
  public updateSupportDimensions(supportDimensions: import('./types').SupportDimension[]): boolean {
    if (!this._capabilities) return false;
    const merged = { ...this._capabilities, supportDimensions };
    this._capabilities = merged;
    this._postToWebview({ type: 'projectCapabilities', capabilities: merged });
    return true;
  }
  /**
   * Refresh preview. Returns `true` only when a refresh was actually posted to
   * the webview — `false` on the early-return paths (no panel, or the current
   * component is not navigable) so the caller's telemetry counts real refreshes,
   * not no-op invocations.
   */
  public refresh(): boolean {
    if (!this._panel) return false;
    // Re-push full state before reloading — guards against races where
    // webview:ready fired before _pushFullStateToWebview had current state
    // (e.g. openPreview called before devserver:statusChanged propagated).
    this._pushFullStateToWebview();
    if (this._currentComponent && this._navigableComponent !== this._currentComponent) {
      return false;
    }
    this._postToWebview({ type: 'refresh' });
    return true;
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
   * Post a message to the preview webview, surviving a disposed panel.
   *
   * The cached `_panel` can be a stale reference to an already-disposed webview:
   * VS Code fires `onDidDispose` (which nulls `_panel`) asynchronously, and the
   * async ensure-sample/preview pipeline awaits across several ticks during which
   * the panel may be torn down (workspace switch, tab close, or the E2E harness
   * disposing the panel between specs). A plain `_panel?.webview.postMessage(...)`
   * guards only `_panel === undefined`, not "disposed", so it throws
   * `Error: Webview is disposed` — which previously escaped the per-call guards and
   * poisoned the shared extension-host worker into a cascade of dead-preview
   * failures. Routing every post through here turns that into a graceful no-op and
   * drops the stale reference so the NEXT `createOrShow` rebuilds a fresh panel.
   */
  private _postToWebview(message: unknown): boolean {
    return postToWebviewSafe(this._panel, message, () => this._clearDisposedPanel());
  }
  /**
   * Drop a stale reference to an already-disposed panel. The webview is gone, so any
   * further post would throw `Webview is disposed`; nulling `_panel` here means the
   * next `createOrShow` rebuilds a fresh panel instead of reusing the dead one.
   * Dispatching `dispose` keeps the derived lifecycle (Detached) consistent with the
   * nulled panel, exactly as VS Code's own `onDidDispose` path does — and it is
   * idempotent, so a later real `onDidDispose` firing is harmless.
   */
  private _clearDisposedPanel(): void {
    // Drops ONLY the stale reference (and keeps the derived lifecycle consistent). Resource
    // teardown stays with VS Code's identity-gated onDidDispose (setupPanel) when the panel
    // is genuinely disposed — duplicating it here would double-dispose / race that gate.
    this._dispatch({ type: 'dispose' });
    this._panel = undefined;
  }
  /**
   * Read the panel's webview defensively. The RPC entry points, `goToCodeSelected`, and
   * `_getHtmlForWebview` read the getter directly, before any disposed-safe post; on a
   * disposed panel `readWebviewSafe` neutralizes the getter throw and `_clearDisposedPanel`
   * drops the stale reference so the next createOrShow rebuilds. See `readWebviewSafe`.
   */
  private _liveWebview(): vscode.Webview | undefined {
    return readWebviewSafe(this._panel, () => this._clearDisposedPanel());
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
    this._postToWebview({
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
    if (!componentPath || !selectedIds?.length || !this._panel) return;

    // Resolve the selected element to its full JSX range in its OWN source file. The
    // selectedId is a source-location ref (`fileName:line:column`); the previous
    // `getElementLocation(componentPath, selectedIds[0])` passed no nodeRef and resolved
    // nothing, so Go-to-Code did nothing at all. getElementRange is cross-file aware and
    // returns start+end so the editor selects the element's JSX, not just a caret.
    const range = await this._panelRouter.astBridge.astService.getElementRange(componentPath, selectedIds[0]);
    // Re-read the webview AFTER the await: the panel can be disposed during getElementRange
    // and the getter throws on a disposed panel (see `_liveWebview`). Abort cleanly if so.
    const webview = this._liveWebview();
    if (range && webview) {
      await handleEditorMessage(
        {
          type: 'editor:goToCode',
          path: range.filePath,
          line: range.startLine,
          column: range.startColumn + 1,
          endLine: range.endLine,
          endColumn: range.endColumn + 1,
        },
        webview,
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
    this._postToWebview({ type: 'canvas:keyboard', key: 'Enter', shiftKey: false });
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
    this._postToWebview({ type: 'canvas:keyboard', key: 'Enter', shiftKey: true });
  }
  /**
   * Select next sibling of selected element (called from VS Code keybinding command).
   */
  public selectNextSibling(): void {
    // Forward to iframe where DOM-based keyboard handler resolves siblings via fiber tree.
    // AST-based NodeMapService doesn't reliably track elements inside conditional JSX expressions.
    this._postToWebview({ type: 'canvas:keyboard', key: 'Tab', shiftKey: false });
  }
  /**
   * Select previous sibling of selected element (called from VS Code keybinding command).
   */
  public selectPrevSibling(): void {
    this._postToWebview({ type: 'canvas:keyboard', key: 'Tab', shiftKey: true });
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
   * Telemetry: callback fired when the preview reports a successful render. The
   * extension host emits preview.renderSucceeded + the one-shot funnel.firstPreview.
   */
  public onRenderSucceeded(callback: (componentPath: string | undefined) => void): void {
    this._onRenderSucceededCallback = callback;
  }
  /**
   * Telemetry: inject the sink for allow-listed webview-origin events (rage/dead/
   * error clicks) forwarded via `telemetry:event` messages from the preview.
   */
  public setTelemetrySink(sink: TelemetrySink): void {
    this._telemetrySink = sink;
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
   * Activate app-mode for the SPA entry root. Records the entry's preview (iframe
   * ?component=) path so `_updatePreviewUrl` appends `&app=1` for it, posts the
   * `appMode` message so the webview shows the address bar with the code-derived route
   * suggestions, then reloads the iframe with the app-mode URL. The extension host owns
   * the activation flow (resolve entry → enableAppEntry → rebuild → here).
   *
   * @param entryPreviewPath sub-project-relative path of the entry root — the same form
   *   that lands in the `?component=` URL and the preview registry key.
   */
  public setAppMode(payload: {
    entryPreviewPath: string;
    routeSuggestions: RouteSuggestion[];
    currentRoute?: string;
  }): void {
    this._appModeEntryPreviewPath = payload.entryPreviewPath;
    this._postToWebview({
      type: 'appMode',
      enabled: true,
      entryPath: payload.entryPreviewPath,
      routeSuggestions: payload.routeSuggestions,
      currentRoute: payload.currentRoute ?? '/',
    });
    // Reload the iframe so the generated preview re-enters with `&app=1`.
    this._updatePreviewUrl();
  }
  /**
   * Tear app-mode down: forget the active entry path (so `_updatePreviewUrl` stops
   * appending `&app=1`) and tell the webview to hide the address bar. Safe to call when
   * app-mode was never on — a no-op `appMode:false` just keeps the bar hidden.
   */
  public clearAppMode(): void {
    this._appModeEntryPreviewPath = null;
    this._postToWebview({ type: 'appMode', enabled: false });
  }
  /**
   * Public trigger for the otherwise-private iframe URL refresh. Lets the extension host
   * reload the preview after a state change it owns (e.g. app-mode activation) without
   * exposing the URL-building internals.
   */
  public refreshPreviewUrl(): void {
    this._updatePreviewUrl();
  }
  /**
   * Send Go to Visual command to webview
   */
  public sendGoToVisual(elementId: string): void {
    if (this._panel) {
      console.log(`[HyperIDE] Sending goToVisual: ${elementId}`);
      this._postToWebview({
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
  private _generateRandomId(length: number): string {
    return crypto.randomBytes(length).toString('base64url').slice(0, length);
  }
  private _getNonce(): string {
    return this._generateRandomId(32);
  }
  private _getHtmlForWebview(): string {
    const webview = this._liveWebview();
    if (!webview) {
      return '<!DOCTYPE html><html><body><p>Preview is not available.</p></body></html>';
    }
    return generatePreviewHtml(webview, this._extensionUri, this._getNonce());
  }
}
