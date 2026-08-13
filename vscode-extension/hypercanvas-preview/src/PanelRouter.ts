/**
 * PanelRouter - central message router for all webview panels
 *
 * Handles shared platform messages (ast:*, editor:*, state:*, component:*)
 * that any panel can send. Panel-specific messages (previewLoaded,
 * devserver:*, etc.) stay in their respective panel providers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { generateTailwindClasses, getConflictingPrefixes } from '@lib/tailwind/generator';
import { resolveInSourceMap, type SourceMapV3 } from '@shared/element-tracing/source-map-resolver';
import type { I18nLibrary } from '@shared/i18n-text/types';
import * as vscode from 'vscode';
import { AstBridge } from './bridges/AstBridge';
import { toRepoRelativeElementId, toRepoRelativePath } from './bridges/monorepo-path-translate';
import { type EditorMessage, handleEditorMessage } from './EditorBridge';
import type { StateHub } from './StateHub';
import type { AstService } from './services/AstService';
import type { ColorProbeCandidate, ColorProbeRequest } from './services/color-probe-types';
import { ComponentService } from './services/ComponentService';
import { StyleReadService } from './services/StyleReadService';
import type { AstMessage, SharedEditorState } from './types';
import { VSCodeFileIO } from './vscode-file-io';

interface PanelRouterConfig {
  workspaceRoot: string;
  stateHub: StateHub;
  context: vscode.ExtensionContext;
  /**
   * Optional pre-built leaf services for tests. Production omits both and gets
   * the real repo-rooted services. Tests inject fakes here instead of
   * `mock.module('../services/AstService' | '../services/ComponentService')`,
   * whose process-global, irreversible module mocks leaked into those services'
   * own tests under a non-isolated run (HYP-579). Both default to the original
   * construction, so production behavior is unchanged. Injected instances are
   * only used for the initial workspace; a later workspace switch
   * (`_ensureCurrentWorkspace`) rebuilds the real services, which tests never hit.
   */
  astService?: AstService;
  componentService?: ComponentService;
}

export class PanelRouter {
  private _astBridge: AstBridge;
  private _stateHub: StateHub;
  private _componentService: ComponentService;
  private _styleReadService: StyleReadService;
  private _workspaceRoot: string;
  private _context: vscode.ExtensionContext;
  private _currentWebview: vscode.Webview | null = null;
  private _onOpenAIChat?: (prompt: string) => void;
  /**
   * Fetches the LIVE applied className of an element from the preview iframe (HYP-544).
   * The color write originates in the right-panel webview, which has no preview iframe of
   * its own — so the inspector's `getDOMClassesFromIframe` reads '' and `ast:updateStyles`
   * arrives with `domClasses` empty. Before executing the write, routeMessage asks the
   * preview-panel (which owns the iframe) for the element's live className and awaits it,
   * so the DOM-anchored twMerge escalation can anchor on reality. Wired in extension.ts to
   * `previewPanel.requestLiveClassName(elementId)` (mirrors the takeScreenshot wiring),
   * which avoids a PanelRouter → PreviewPanel circular dependency. Resolves null when the
   * element can't be found / no preview panel / timeout — the write then degrades to the
   * static AST behavior (committed set-diff gate no-ops on empty domClasses).
   */
  private _liveClassNameProvider?: (elementId: string, itemIndex?: number | null) => Promise<string | null>;
  /**
   * Runs the empirical color-probe in the preview-panel iframe (HYP-544 Phase 3). When an
   * inspector color edit's source can't be statically resolved, this asks the iframe which
   * candidate token actually drives the element's color (off-screen-clone verification, §5).
   * Wired in extension.ts to `previewPanel.requestProbeColorCandidates(...)` (same no-circular-dep
   * pattern as the live-className provider). Resolves [] on no-panel / not-found / timeout.
   */
  private _colorProbeProvider?: (request: ColorProbeRequest) => Promise<ColorProbeCandidate[]>;
  /**
   * Sub-project path prefix for a monorepo opened at the repo ROOT (e.g.
   * `targets/conloca-app/`), empty for single-package projects. The dev server
   * runs inside the sub-project, so every source path the iframe emits is
   * relative to it; the repo-rooted services here key files repo-relative.
   * routeMessage re-roots those paths once, for every consumer (ast edits,
   * editor navigation, style reads). Set by PreviewPanel on each select (HYP-435).
   */
  private _subProjectPrefix = '';

  constructor(config: PanelRouterConfig) {
    this._astBridge = new AstBridge(config.workspaceRoot, config.astService);
    this._stateHub = config.stateHub;
    this._context = config.context;
    this._componentService = config.componentService ?? this._createComponentService(config.workspaceRoot);
    this._styleReadService = this._createStyleReadService(config.workspaceRoot);
    this._workspaceRoot = config.workspaceRoot;
  }

  get astBridge(): AstBridge {
    this._ensureCurrentWorkspace();
    return this._astBridge;
  }

  /**
   * Pin the monorepo sub-project prefix (e.g. `targets/conloca-app/`), empty for
   * single-package. Forwarded to AstBridge so its public direct-call mutation
   * methods (delete/duplicate/wrap/paste, invoked straight from PreviewPanel)
   * re-root too. routeMessage uses it to translate iframe-supplied paths on
   * ast:/editor:/styles: messages (HYP-435).
   */
  setSubProjectPrefix(prefix: string): void {
    this._subProjectPrefix = prefix;
    this._astBridge.setSubProjectPrefix(prefix);
  }

  /**
   * Re-root the sub-project-relative source paths the iframe emits to
   * repo-relative. Covers the three message families that carry an iframe
   * fiber-derived path into a repo-rooted service:
   *  - ast:* — filePath + element-id fields (edits).
   *  - editor:goToCode / editor:openFile — `path` (Go-to-Code navigation).
   *  - styles:readClassName — elementId + componentPath (inspector style read).
   * No-op when the prefix is empty. Returns a shallow clone; never mutates the
   * caller's object. `componentFilePath` (insertElement, repo-rooted picker) and
   * already-repo-relative paths are left untouched.
   */
  private _reRootMessage(message: unknown): unknown {
    const prefix = this._subProjectPrefix;
    if (!prefix) return message;
    const m = message as { type?: string; [k: string]: unknown };
    const type = m?.type;
    if (!type) return message;

    const pathField = (key: string, next: Record<string, unknown>): void => {
      if (typeof m[key] === 'string') next[key] = toRepoRelativePath(m[key] as string, prefix);
    };
    const idField = (key: string, next: Record<string, unknown>): void => {
      if (typeof m[key] === 'string') next[key] = toRepoRelativeElementId(m[key] as string, prefix);
    };

    if (type.startsWith('ast:')) {
      const next = { ...m };
      pathField('filePath', next);
      idField('elementId', next);
      idField('sourceId', next);
      idField('targetId', next);
      idField('parentId', next);
      if (Array.isArray(m.elementIds)) next.elementIds = m.elementIds.map((id) => toRepoRelativeElementId(id, prefix));
      return next;
    }
    if (type === 'editor:goToCode' || type === 'editor:openFile') {
      const next = { ...m };
      pathField('path', next);
      return next;
    }
    if (type === 'styles:readClassName') {
      const next = { ...m };
      idField('elementId', next);
      pathField('componentPath', next);
      return next;
    }
    if (type === 'master:goToComponent') {
      const next = { ...m };
      idField('elementId', next);
      idField('nodeRef', next);
      pathField('componentPath', next);
      return next;
    }
    return message;
  }

  get componentService(): ComponentService {
    this._ensureCurrentWorkspace();
    return this._componentService;
  }

  get workspaceRoot(): string {
    this._ensureCurrentWorkspace();
    return this._workspaceRoot;
  }

  getComponentGroups() {
    this._ensureCurrentWorkspace();
    return this._componentService.scanComponentGroups();
  }

  /** Flush deferred .hyperide writes to disk. Returns true if anything was written. */
  flushStructureStore(): Promise<boolean> {
    return this._componentService.flushStructureStore();
  }

  /**
   * Route a message from a panel to the appropriate handler.
   * Returns true if the message was handled.
   */
  async routeMessage(rawMessage: unknown, webview: vscode.Webview): Promise<boolean> {
    this._ensureCurrentWorkspace();
    const message = this._reRootMessage(rawMessage);
    const msg = message as { type?: string };
    const type = msg.type;
    if (!type) return false;

    // State sync
    if (type === 'state:update') {
      const { patch } = message as { patch: Partial<SharedEditorState> };
      this._stateHub.applyUpdate(patch);
      return true;
    }

    // Canvas scroll — broadcast to ALL registered panels so the PreviewPanel webview
    // (which hosts the iframe) receives it even when the sender is the LeftPanel webview
    // (Elements Tree click). VS Code webviews are isolated iframes; DOM events do not
    // cross — broadcasting through StateHub is the only working path.
    // The sender (LeftPanel) also receives the message and silently ignores it
    // (no `case 'iframe:scrollToElement'` in its message handler).
    if (type === 'iframe:scrollToElement') {
      this._stateHub.broadcast(message as { type: string } & Record<string, unknown>);
      return true;
    }

    // Selection-freeze coordination — sender lives in the right sidebar,
    // listener lives in the preview panel's iframe. Broadcast so the message
    // reaches every registered webview; only usePreviewBridge handles it.
    // See docs/plans/2026-05-06-selection-survives-i18n-write.md (Path B).
    if (type === 'iframe:writeI18nResource') {
      this._stateHub.broadcast(message);
      return true;
    }

    // Editor operations
    if (type.startsWith('editor:')) {
      await handleEditorMessage(message as EditorMessage, webview);
      return true;
    }

    // AST operations — route response back to the requesting webview
    if (type.startsWith('ast:')) {
      // HYP-544: live write-time className RPC for color writes. When the inspector
      // (right-panel webview, no preview iframe of its own) sends ast:updateStyles with
      // an empty domClasses, fetch the element's LIVE applied className from the
      // preview-panel iframe and await it, so the DOM-anchored twMerge escalation anchors
      // on reality. Use the PRE-re-root (iframe-relative) elementId: the iframe's
      // findElementsByRef matches the id it emitted (sub-project-relative in a monorepo),
      // while the AST write below uses the re-rooted `message`. Degrades to static behavior
      // on a null result; never throws / never blocks the write.
      if (type === 'ast:updateStyles' && (this._liveClassNameProvider || this._colorProbeProvider)) {
        const styleMsg = message as Extract<AstMessage, { type: 'ast:updateStyles' }>;
        const rawElementId = (rawMessage as { elementId?: unknown }).elementId;
        const probeElementId = typeof rawElementId === 'string' && rawElementId ? rawElementId : null;
        // Item index of the selected occurrence at a repeated JSX site (.map() row), keyed by the
        // iframe-relative id (same space as the raw elementId). Lets the iframe anchor on the
        // element the user is editing, not always the first.
        const itemIndex = probeElementId ? (this._stateHub.state.selectedItemIndices?.[probeElementId] ?? null) : null;

        if (!styleMsg.domClasses && this._liveClassNameProvider) {
          if (probeElementId) {
            let live: string | null = null;
            try {
              live = await this._liveClassNameProvider(probeElementId, itemIndex);
            } catch {
              live = null;
            }
            styleMsg.domClasses = live ?? '';
          } else {
            styleMsg.domClasses = '';
          }
        }

        // HYP-544 Phase 3: empirical color-probe. When a same-group color reaches the element from
        // a source the static AST can't resolve, we can't know statically which token drives it.
        // Gate the probe on a live same-group conflict (so it doesn't fire on every write), then ask
        // the iframe which candidate actually drives the color (off-screen-clone verification, §5).
        // The executor consumes the result ONLY in the case-(c) branch (inline/var/module driver →
        // inline-style override); a tailwind-class driver is a no-op there → existing twMerge path.
        await this._maybeProbeColorCandidates(styleMsg, probeElementId, itemIndex);
      }
      await this._astBridge.handleMessage(message as AstMessage, webview);
      return true;
    }

    // AI chat open request (from any panel)
    if (type === 'ai:openChat') {
      const { prompt } = message as { prompt?: string };
      if (this._onOpenAIChat && prompt) {
        this._onOpenAIChat(prompt);
      }
      return true;
    }

    // Component operations — grouped list (directory-based)
    if (type === 'component:listGroups') {
      const { requestId } = message as { requestId: string };
      try {
        const result = await this._componentService.scanComponentGroups();
        webview.postMessage({
          type: 'component:response',
          requestId,
          success: true,
          data: result.data,
          needsSetup: result.needsSetup,
          setupReason: result.setupReason,
        });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // Execute VS Code commands from webview
    if (type === 'command:execute') {
      const { command, args } = message as { command: string; args?: string[] };
      try {
        await vscode.commands.executeCommand(command, ...(args ?? []));
      } catch (e) {
        console.error(`[PanelRouter] Failed to execute command ${command}:`, e); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
      return true;
    }

    // Component operations — flat list (legacy)
    if (type === 'component:list') {
      const { requestId } = message as { requestId: string };
      try {
        const tree = await this._componentService.scanComponents();
        webview.postMessage({ type: 'component:response', requestId, success: true, data: tree });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:tests') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const groups = await this._componentService.scanComponentTests(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: groups });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:parse') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const info = await this._componentService.getComponent(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: info });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:parseStructure') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const structure = await this._componentService.parseStructure(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: structure });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // File operations (local filesystem)
    if (type === 'file:read') {
      const { requestId, filePath } = message as { requestId: string; filePath: string };
      try {
        const resolved = path.resolve(this._workspaceRoot, filePath);
        const content = await fs.readFile(resolved, 'utf-8');
        webview.postMessage({ type: 'file:response', requestId, success: true, data: content });
      } catch (e) {
        webview.postMessage({ type: 'file:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // Approach B: server-side (RSC) source map resolution.
    // The iframe IIFE cannot fetch server chunk source maps (file:// paths, not browser-accessible).
    // PanelRouter reads the .map file from the local filesystem and decodes VLQ.
    if (type === 'hypercanvas:resolveServerSourceMap') {
      const { filePath, line, col } = message as { filePath: string; line: number; col: number };
      let result = null;
      try {
        const mapPath = filePath.endsWith('.map') ? filePath : `${filePath}.map`;
        const content = await fs.readFile(mapPath, 'utf-8');
        const sm = JSON.parse(content) as SourceMapV3;
        result = resolveInSourceMap(sm, line, col);
      } catch {
        // File not found or parse error — result stays null
      }
      webview.postMessage({ type: 'serverSourceMapResult', filePath, line, col, result });
      return true;
    }

    // Right panel input focus — update context variable so keybindings don't fire in inputs
    if (type === 'panel:inputFocus') {
      const { active } = message as { active: boolean };
      vscode.commands.executeCommand('setContext', 'hypercanvas.rightPanelInputFocused', active);
      return true;
    }

    // Update hypercanvas.devServer.autoStart setting from webview checkbox
    if (type === 'panel:updateAutoStart') {
      const { value } = message as { value: boolean };
      await vscode.workspace
        .getConfiguration('hypercanvas.devServer')
        .update('autoStart', value, vscode.ConfigurationTarget.Global);
      return true;
    }

    // Open VS Code Settings UI at a specific query
    if (type === 'panel:openSettings') {
      const { query } = message as { query: string };
      await vscode.commands.executeCommand('workbench.action.openSettings', query);
      return true;
    }

    // Style reading operations (right panel inspector)
    if (type === 'styles:readClassName') {
      const { requestId, elementId, componentPath, domTextContent, activeLocale } = message as {
        requestId: string;
        elementId: string;
        componentPath: string;
        domTextContent?: string;
        activeLocale?: string;
      };
      try {
        // Ensure NodeMapService is populated before reading styles
        // (same race condition as HYP-268 for writes).
        await this._astBridge.astService.ensureInitialized();
        const result = await this._styleReadService.readElementClassName(
          componentPath,
          elementId,
          domTextContent,
          activeLocale,
        );
        webview.postMessage({
          type: 'styles:response',
          requestId,
          success: true,
          ...result,
        });
      } catch (e) {
        webview.postMessage({
          type: 'styles:response',
          requestId,
          success: false,
          error: String(e),
        });
      }
      return true;
    }

    // Fetch all available i18n keys from the active locale file
    if (type === 'styles:fetchI18nKeys') {
      const { requestId, library, namespace, activeLocale } = message as {
        requestId: string;
        library?: I18nLibrary;
        namespace?: string;
        activeLocale: string;
      };
      if (!activeLocale || typeof activeLocale !== 'string') {
        webview.postMessage({
          type: 'styles:i18nKeysResponse',
          requestId,
          success: false,
          keys: [],
          error: 'activeLocale missing',
        });
        return true;
      }
      try {
        const keys = await this._styleReadService.getAvailableKeys(namespace, activeLocale, library);
        webview.postMessage({ type: 'styles:i18nKeysResponse', requestId, success: true, keys });
      } catch (e) {
        webview.postMessage({ type: 'styles:i18nKeysResponse', requestId, success: false, keys: [], error: String(e) });
      }
      return true;
    }

    // "Go to main component" (HYP-563): resolve the selected element's component
    // reference to its master definition and open it. Handled here (shared router)
    // so it works from BOTH the inspector webview (RightPanelProvider) and the
    // preview panel — the inspector button posts through RightPanelProvider, whose
    // only sink is routeMessage. The inspector pre-gates to component references;
    // host/inline/external resolutions surface an info message instead of navigating.
    if (type === 'master:goToComponent') {
      const { elementId, nodeRef, componentPath, componentName } = message as {
        elementId?: string;
        nodeRef?: string;
        componentPath?: string;
        componentName?: string;
      };
      if (!componentPath || !elementId) return true;

      await this._astBridge.astService.ensureInitialized();
      const resolution = await this._astBridge.astService.getMasterComponentLocation(componentPath, elementId, nodeRef);

      // Pinpointed a concrete definition — navigate straight there.
      if (resolution.kind === 'local' && resolution.pinpointed) {
        await handleEditorMessage(
          { type: 'editor:goToCode', path: resolution.filePath, line: resolution.line, column: resolution.column + 1 },
          webview,
        );
        return true;
      }

      // Backstop via the TS language server for cases the pure resolver can't
      // pinpoint: barrel landings (`local` but not pinpointed), deep/default
      // re-export chains, baseUrl-only imports misread as external, package.json
      // `exports`, and TS project references. Host/inline are terminal — never LSP.
      if (resolution.kind === 'local' || resolution.kind === 'external' || resolution.kind === 'not-found') {
        const navigated = await this._goToDefinitionViaLsp(componentPath, elementId, nodeRef, webview);
        if (navigated) return true;
      }

      // No pinpoint and no LSP result: fall back to the resolved file (the barrel),
      // which is still one hop from the definition.
      if (resolution.kind === 'local') {
        await handleEditorMessage(
          { type: 'editor:goToCode', path: resolution.filePath, line: resolution.line, column: resolution.column + 1 },
          webview,
        );
        return true;
      }

      const label = componentName ?? 'Component';
      const reason =
        resolution.kind === 'external'
          ? `"${label}" is defined in an external package (${resolution.packageName}).`
          : resolution.kind === 'inline'
            ? `"${label}" is defined inline in the current file.`
            : resolution.kind === 'host'
              ? 'This is a plain HTML element with no component definition.'
              : `Could not locate the definition for "${label}".`;
      void vscode.window.showInformationMessage(`HyperCanvas: ${reason}`);
      return true;
    }

    return false;
  }

  /**
   * Resolver-miss backstop: use the TypeScript language server's definition
   * provider at the selected JSX tag to navigate to the component definition.
   * Returns true if it navigated to a real (non-node_modules) source location.
   */
  private async _goToDefinitionViaLsp(
    componentPath: string,
    elementId: string,
    nodeRef: string | undefined,
    webview: vscode.Webview,
  ): Promise<boolean> {
    try {
      const loc = await this._astBridge.astService.getElementLocation(componentPath, elementId, nodeRef);
      if (!loc) return false;

      const absolute = path.isAbsolute(componentPath)
        ? componentPath
        : path.resolve(this._workspaceRoot, componentPath);
      const uri = vscode.Uri.file(absolute);
      // getElementLocation returns the JSX element's 1-based line / Babel 0-based
      // column (pointing at `<`). VS Code Positions are 0-based; +1 on the column
      // lands the cursor on the tag identifier so the definition provider resolves
      // the component symbol rather than the punctuation.
      const position = new vscode.Position(Math.max(0, loc.line - 1), Math.max(0, loc.column + 1));

      const defs = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
        'vscode.executeDefinitionProvider',
        uri,
        position,
      );
      const target = (defs ?? [])
        .map((d) => ('targetUri' in d ? { uri: d.targetUri, range: d.targetRange } : { uri: d.uri, range: d.range }))
        .find((d) => !d.uri.fsPath.includes('node_modules'));
      if (!target) return false;

      await handleEditorMessage(
        {
          type: 'editor:goToCode',
          path: target.uri.fsPath,
          line: target.range.start.line + 1,
          column: target.range.start.character + 1,
        },
        webview,
      );
      return true;
    } catch (e) {
      console.warn('[PanelRouter] LSP definition fallback failed:', e);
      return false;
    }
  }

  /**
   * Set the webview that should receive AST responses.
   * Called when a panel is created or focused.
   */
  setAstResponseTarget(webview: vscode.Webview): void {
    this._currentWebview = webview;
    this._astBridge.setWebview(webview);
  }

  /**
   * Set callback for ai:openChat messages from any panel.
   * Extension host wires this to AIChatPanelProvider.
   */
  setOnOpenAIChat(callback: (prompt: string) => void): void {
    this._onOpenAIChat = callback;
  }

  /**
   * Wire the live write-time className provider (HYP-544). The extension host backs this
   * with `previewPanel.requestLiveClassName(elementId)` — a request/response round-trip to
   * the preview-panel iframe (same promise+timeout shape as takeScreenshot). Called before
   * an inspector color write so `domClasses` is fresh at write time, with no dependency on
   * the race-prone push-at-selection state.
   */
  setLiveClassNameProvider(provider: (elementId: string, itemIndex?: number | null) => Promise<string | null>): void {
    this._liveClassNameProvider = provider;
  }

  /**
   * Wire the empirical color-probe provider (HYP-544 Phase 3). Backed by
   * `previewPanel.requestProbeColorCandidates(...)` — same no-circular-dep pattern as the
   * live-className provider. Lets routeMessage ask the iframe which candidate token drives an
   * element's color when the color source can't be statically resolved.
   */
  setColorProbeProvider(provider: (request: ColorProbeRequest) => Promise<ColorProbeCandidate[]>): void {
    this._colorProbeProvider = provider;
  }

  /**
   * HYP-544 Phase 3 — fire the empirical color-probe and thread the ranked driving candidates onto
   * the write message, but ONLY when a same-group color is actually applied (the live `domClasses`
   * carries a conflicting class for the changed property). This keeps the probe off the hot path for
   * plain writes; the executor further gates it (only an inline/var/module driver redirects the
   * write). On >1 driver, surface a non-blocking inspector warning and take the first (§6). Never
   * throws / never blocks the write — any failure degrades to the static AST path.
   */
  private async _maybeProbeColorCandidates(
    styleMsg: Extract<AstMessage, { type: 'ast:updateStyles' }>,
    probeElementId: string | null,
    itemIndex: number | null,
  ): Promise<void> {
    if (!this._colorProbeProvider || !probeElementId) return;

    const styleKeys = Object.keys(styleMsg.styles ?? {});
    if (styleKeys.length === 0) return;
    const prefixes = getConflictingPrefixes(styleKeys);
    if (prefixes.length === 0) return;

    // Only probe when the live DOM actually shows a same-group conflict class for this property.
    const liveTokens = (styleMsg.domClasses ?? '').split(/\s+/).filter(Boolean);
    const hasLiveConflict = liveTokens.some((tok) => prefixes.some((p) => tok.startsWith(p)));
    if (!hasLiveConflict) return;

    // The probe's "request" is one changed property at a time (color edits are single-prop). Pick the
    // first changed key; its value is the requested color, its conflict prefix the candidate filter.
    const cssProp = styleKeys[0];
    const requestedColor = styleMsg.styles[cssProp];
    if (!requestedColor) return;

    // The Tailwind class that paints the requested color (e.g. `bg-red-600`). The iframe probe swaps
    // this IN on the clone to empirically verify a tailwind-class / hashed module-class driver — without
    // it those candidate kinds can't be tested and the probe would return [] for them (codex P2).
    const requestClass = generateTailwindClasses({ [cssProp]: requestedColor }) || undefined;

    let driving: ColorProbeCandidate[] = [];
    try {
      driving = await this._colorProbeProvider({
        elementId: probeElementId,
        itemIndex,
        prefixes,
        cssProp,
        requestedColor,
        requestClass,
      });
    } catch {
      driving = [];
    }

    if (driving.length === 0) return;
    styleMsg.probeDriving = driving;

    if (driving.length > 1) {
      const chosen = driving[0];
      const others = driving.length - 1;
      // Non-blocking breadcrumb — reuse the existing inspector notification surface (no modal, §6).
      void vscode.window.showWarningMessage(
        `HyperCanvas: color resolved at ${chosen.kind} \`${chosen.token}\`; ${others} other place${others === 1 ? '' : 's'} could also control this color.`,
      );
    }
    console.log(
      '[PanelRouter] HYP-544 color-probe driving candidates:',
      JSON.stringify(driving),
      '→ chose',
      JSON.stringify(driving[0]),
    );
  }

  dispose(): void {
    // Nothing to dispose currently
  }

  private _createComponentService(workspaceRoot: string): ComponentService {
    return new ComponentService(workspaceRoot, () =>
      Promise.resolve(this._context.secrets.get('hypercanvas.ai.apiKey')),
    );
  }

  private _createStyleReadService(workspaceRoot: string): StyleReadService {
    return new StyleReadService(workspaceRoot, new VSCodeFileIO(), this._astBridge.astService.nodeMapService);
  }

  private _ensureCurrentWorkspace(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || workspaceRoot === this._workspaceRoot) return;
    this._workspaceRoot = workspaceRoot;
    this._astBridge = new AstBridge(workspaceRoot);
    if (this._currentWebview) this._astBridge.setWebview(this._currentWebview);
    this._componentService = this._createComponentService(workspaceRoot);
    this._styleReadService = this._createStyleReadService(workspaceRoot);
  }
}
