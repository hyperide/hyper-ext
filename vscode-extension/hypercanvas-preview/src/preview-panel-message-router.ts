/**
 * Preview panel message router — handles all messages from the webview.
 * Extracted to reduce PreviewPanel.ts size.
 */

import * as vscode from 'vscode';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import type { DevServerRuntimeError } from './types';
import { generateSamplePropValues } from '@lib/preview-generator';
import { deriveSubProjectPrefix, resolveComponentAbsPath } from './bridges/monorepo-path-translate';
import { postToWebviewSafe } from './webview-post';
import {
  type CanvasMode,
  type ContextMenuAction,
  TelemetryEvents,
  type TelemetryProps,
  type TelemetryValue,
  valueKindOf,
} from './telemetry/events';
import type { TelemetrySink } from './telemetry/TelemetryService';

/**
 * Focused dependency surface for the message router. Built inside PreviewPanel
 * (private members are legally accessible from within the class) and passed here,
 * so the router never reaches into PreviewPanel's private fields directly.
 */
export interface MessageRouterDeps {
  stateHub: StateHub;
  panelRouter: PanelRouter;
  context: vscode.ExtensionContext;
  currentComponent: string | undefined;
  previewComponent: string | undefined;
  workspaceRoot: string | undefined;
  panel: vscode.WebviewPanel | undefined;
  onScopeChange?: (scope: 'full-app' | 'component-only') => Promise<void>;
  onRuntimeErrorCallback: ((error: DevServerRuntimeError | null) => void) | null;
  onConsoleCaptureCallback: ((entries: Array<{ level: string; args: string[]; timestamp: number }>) => void) | null;
  pushFullStateToWebview(): void;
  updatePreviewUrl(): void;
  bumpStyleVersion(): void;
  reEmitSelectionAfterHmr(): void;
  onComponentMissingCallback: ((componentPath: string) => void) | null;
  onComponentErrorCallback: ((componentPath: string, error: string) => void) | null;
  // Telemetry: a render-success forward from the webview (host emits
  // preview.renderSucceeded + funnel.firstPreview), and the allow-listed
  // webview-origin event sink (rage/dead/error clicks, AI thumbs).
  onRenderSucceededCallback: ((componentPath: string | undefined) => void) | null;
  telemetrySink: TelemetrySink | null;
  // Host-emitted canvas/inspector telemetry (ast:* edits, undo/redo, mode switch,
  // context-menu actions, keyboard delete/duplicate). Distinct from telemetrySink:
  // these events ORIGINATE host-side and skip the webview allow-list. Null when
  // telemetry is unavailable — every emit is null-guarded.
  track: ((name: string, props?: TelemetryProps) => void) | null;
  // Dedupe holder for inspector.elementInspected — persists the last emitted
  // selection key across messages (the router itself is stateless per call) so a
  // re-selection of the same element does not re-count. Owned by PreviewPanel.
  inspectorSelection: { lastKey: string | null } | null;
  undo(): Promise<void>;
  redo(): Promise<void>;
  handleCreateSampleFromError(
    componentPath: string | undefined,
    propValues?: Record<string, unknown>,
    sampleName?: string,
    options?: { suggestAIKey?: boolean },
  ): Promise<boolean>;
  handleContextMenuGoToCode(msg: { [key: string]: unknown }, webview: vscode.Webview): Promise<void>;
  handleContextMenuDuplicate(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuDelete(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuWrapInDiv(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuCopy(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuPaste(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuCut(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuSelectParent(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuSelectChild(msg: { [key: string]: unknown }): Promise<void>;
  handleContextMenuCopyContent(msg: { [key: string]: unknown }, webview: vscode.Webview, mode: 'text' | 'html'): void;
  handleElementContentResult(msg: { [key: string]: unknown }): void;
  handleScreenshotResult(msg: { [key: string]: unknown }): void;
  // HYP-544: the iframe's reply to a write-time live-className RPC (DOM-anchored color).
  handleLiveClassNameResult(msg: { [key: string]: unknown }): void;
  // HYP-544 Phase 3: the iframe's reply to an empirical color-probe RPC (driving candidates).
  handleProbeColorCandidatesResult(msg: { [key: string]: unknown }): void;
}

export async function routeMessage(deps: MessageRouterDeps, message: unknown, webview: vscode.Webview): Promise<void> {
  const msg = message as { type?: string; [key: string]: unknown };

  if (!msg.type) return;

  console.log('[HyperIDE] Message from webview:', msg.type);

  // === Webview lifecycle ===
  if (msg.type === 'webview:ready') {
    deps.stateHub.sendInit('preview');
    deps.pushFullStateToWebview();
    return;
  }

  if (msg.type === 'previewLoaded') {
    console.log('[HyperIDE] Preview iframe loaded');
    return;
  }
  if (msg.type === 'chrome-detected') {
    const shown = deps.context.workspaceState.get<boolean>('chromeDetectedShown', false);
    if (!shown) {
      void deps.context.workspaceState.update('chromeDetectedShown', true);
      void vscode.window
        .showInformationMessage(
          'HyperCanvas: Preview includes app layout (nav/header/sidebar). Switch to Isolated mode to isolate components.',
          'Generate wrapper',
          'Dismiss',
        )
        .then((choice) => {
          if (choice === 'Generate wrapper') {
            void deps.onScopeChange?.('component-only');
          }
        });
    }
    return;
  }
  if (msg.type === 'preview:setScope') {
    const scope = msg.scope;
    if (scope !== 'full-app' && scope !== 'component-only') return;
    const mode: CanvasMode = scope === 'component-only' ? 'component' : 'app';
    deps.track?.(TelemetryEvents.canvasModeSwitched, { mode });
    void deps.onScopeChange?.(scope);
    return;
  }
  if (msg.type === 'runtime:error') {
    const error = (msg as { error?: unknown }).error ?? null;
    deps.onRuntimeErrorCallback?.(error as DevServerRuntimeError | null);
    return;
  }
  // Telemetry: preview render succeeded (forwarded from the webview). The host
  // emits preview.renderSucceeded + the one-shot funnel.firstPreview.
  if (msg.type === 'preview:renderSucceeded') {
    const componentPath = (msg as { componentPath?: string }).componentPath;
    deps.onRenderSucceededCallback?.(componentPath);
    return;
  }
  // Telemetry: an allow-listed webview-origin event (rage/dead/error clicks).
  // Only event NAMES on the host allow-list are accepted; props are coerced to
  // scalars so no objects/PII can slip through.
  if (msg.type === 'telemetry:event') {
    const name = (msg as { name?: unknown }).name;
    const rawProps = (msg as { props?: unknown }).props;
    if (typeof name === 'string') {
      deps.telemetrySink?.trackFromWebview(name, coerceWebviewProps(rawProps));
    }
    return;
  }
  if (msg.type === 'hypercanvas:componentMissing') {
    const componentPath = (msg as { componentPath?: string }).componentPath;
    if (componentPath) {
      deps.onComponentMissingCallback?.(componentPath);
    }
    return;
  }
  if (msg.type === 'hypercanvas:componentError') {
    const { componentPath, error } = msg as { componentPath?: string; error?: string };
    if (componentPath && error) {
      deps.onComponentErrorCallback?.(componentPath, error);
    }
    return;
  }
  // User clicked a recommendation in the non-previewable-file overlay — select that
  // component, driving the same selection pipeline as an Explorer click (opens the
  // file + previews it).
  if (msg.type === 'preview:selectComponent') {
    const { path, name } = msg as { path?: string; name?: string };
    if (path) {
      deps.stateHub.applyUpdate({ currentComponent: { name: name ?? path, path } });
    }
    return;
  }

  // === Console capture ===
  if (msg.type === 'diagnostic:console') {
    const entries = (msg as { entries?: Array<{ level: string; args: string[]; timestamp: number }> }).entries;
    if (entries) {
      deps.onConsoleCaptureCallback?.(entries);
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

  // === ErrorBoundary actions ===
  if (msg.type === 'errorBoundary:createSample') {
    const componentPath = msg.componentPath as string | undefined;
    await deps.handleCreateSampleFromError(
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
  // HYP-880: "Generate preview wrapper" on the provider-error card — scaffold
  // (or AI-generate, when a key is configured) `.hyperide/preview.tsx` and open it.
  if (msg.type === 'errorBoundary:generatePreviewWrapper') {
    vscode.commands.executeCommand('hypercanvas.generatePreviewWrapper');
    return;
  }
  if (msg.type === 'errorBoundary:getPropsSchema') {
    const componentPath = msg.componentPath as string | undefined;
    if (componentPath) {
      const props = await deps.panelRouter.componentService.getComponentDefinitions(componentPath);
      const unsatisfiedProps = props && props.length > 0 ? generateSamplePropValues(props).unsatisfied : [];
      // Check if an existing SampleDefault already exists so the webview can skip
      // auto-create for components with a real (possibly broken) sample — prevents
      // silently overwriting an existing sample on generic runtime errors (HYP-648 P1).
      let hasSample = false;
      if (deps.workspaceRoot) {
        try {
          const subProjectPrefix = deriveSubProjectPrefix(deps.currentComponent, deps.previewComponent);
          const absPath = resolveComponentAbsPath(componentPath, deps.workspaceRoot, subProjectPrefix);
          const fileUri = vscode.Uri.file(absPath);
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          const sourceCode = Buffer.from(bytes).toString('utf-8');
          hasSample = /export\s+const\s+SampleDefault\s*=/.test(sourceCode);
        } catch {
          // File unreadable — treat as no sample; auto-create will create it
          hasSample = false;
        }
      }
      webview.postMessage({
        type: 'errorBoundary:propsSchema',
        componentPath,
        propsSchema: props,
        unsatisfiedProps,
        hasSample,
      });
    }
    return;
  }

  if (msg.type === 'previewError') {
    console.error('[HyperIDE] Preview error:', (msg as { error?: string }).error);
    return;
  }

  // === Canvas undo/redo ===
  if (msg.type === 'canvas:undo') {
    deps.track?.(TelemetryEvents.canvasUndo);
    await deps.undo();
    return;
  }
  if (msg.type === 'canvas:redo') {
    deps.track?.(TelemetryEvents.canvasRedo);
    await deps.redo();
    return;
  }

  // === Keyboard-driven delete (from iframe keyboard handler) ===
  if (msg.type === 'keyboard:delete') {
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = deps.currentComponent;
    if (!componentPath || !elementIds?.length) return;
    deps.track?.(TelemetryEvents.canvasElementDeleted, { count: elementIds.length, source: 'keyboard' });
    const result = await deps.panelRouter.astBridge.deleteElements(componentPath, elementIds);
    if (result.success) {
      deps.stateHub.applyUpdate({ selectedIds: [] });
    } else {
      void vscode.window.showErrorMessage(`HyperCanvas: Could not delete element. ${result.error ?? ''}`);
    }
    return;
  }

  // === Keyboard-driven duplicate (from iframe keyboard handler) ===
  if (msg.type === 'keyboard:duplicate') {
    const elementId = msg.elementId as string | undefined;
    const componentPath = deps.currentComponent;
    if (!componentPath || !elementId) return;
    deps.track?.(TelemetryEvents.canvasElementDuplicated, { source: 'keyboard' });
    const result = await deps.panelRouter.astBridge.duplicateElement(componentPath, elementId);
    if (result.success && result.newId) {
      deps.stateHub.applyUpdate({ selectedIds: [result.newId] });
    }
    return;
  }

  // === Context menu handlers ===
  // One telemetry emit for the whole family — derive the action enum from the
  // `contextMenu:` suffix so we don't repeat a track() call in all 11 branches.
  if (msg.type.startsWith('contextMenu:')) {
    const action = contextMenuActionFromType(msg.type);
    if (action) deps.track?.(TelemetryEvents.canvasContextMenuAction, { action });
  }
  if (msg.type === 'contextMenu:goToCode') {
    await deps.handleContextMenuGoToCode(msg, webview);
    return;
  }
  if (msg.type === 'contextMenu:duplicate') {
    await deps.handleContextMenuDuplicate(msg);
    return;
  }
  if (msg.type === 'contextMenu:delete') {
    await deps.handleContextMenuDelete(msg);
    return;
  }
  if (msg.type === 'contextMenu:wrapInDiv') {
    await deps.handleContextMenuWrapInDiv(msg);
    return;
  }
  if (msg.type === 'contextMenu:copy') {
    await deps.handleContextMenuCopy(msg);
    return;
  }
  if (msg.type === 'contextMenu:paste') {
    await deps.handleContextMenuPaste(msg);
    return;
  }
  if (msg.type === 'contextMenu:cut') {
    await deps.handleContextMenuCut(msg);
    return;
  }
  if (msg.type === 'contextMenu:selectParent') {
    await deps.handleContextMenuSelectParent(msg);
    return;
  }
  if (msg.type === 'contextMenu:selectChild') {
    await deps.handleContextMenuSelectChild(msg);
    return;
  }
  if (msg.type === 'contextMenu:copyText') {
    deps.handleContextMenuCopyContent(msg, webview, 'text');
    return;
  }
  if (msg.type === 'contextMenu:copyAsHTML') {
    deps.handleContextMenuCopyContent(msg, webview, 'html');
    return;
  }

  // === Element content result ===
  if (msg.type === 'elementContentResult') {
    deps.handleElementContentResult(msg);
    return;
  }

  // === Screenshot result ===
  if (msg.type === 'screenshotResult') {
    deps.handleScreenshotResult(msg);
    return;
  }

  // === Live-className result (HYP-544 write-time DOM-anchor round-trip) ===
  if (msg.type === 'liveClassNameResult') {
    deps.handleLiveClassNameResult(msg);
    return;
  }

  // === Color-probe result (HYP-544 Phase 3 empirical driving-candidate round-trip) ===
  if (msg.type === 'probeColorCandidatesResult') {
    deps.handleProbeColorCandidatesResult(msg);
    return;
  }

  // === Dev server status ===
  if (msg.type === 'devserver:statusChanged') {
    const running = msg.running as boolean;
    if (running) {
      deps.updatePreviewUrl();
    } else {
      // Disposed-safe: this fires on a devserver-status message that can arrive after the
      // panel's webview is torn down; a plain post would throw `Webview is disposed`.
      postToWebviewSafe(deps.panel, { type: 'devserver:statusChanged', running: false, url: null });
    }
    return;
  }

  // === Preview resize ===
  if (msg.type === 'hypercanvas:resizePreviewElement') {
    return;
  }
  if (msg.type === 'hypercanvas:clearPreviewResize') {
    return;
  }

  // AST mutations (ast:updateStyles, ast:updateProps, ast:insertElement, etc.)
  // trigger HMR — re-emit selection so the preview re-highlights the element
  // after the fiber tree is rebuilt.
  if (msg.type.startsWith('ast:')) {
    emitAstTelemetry(deps.track, msg);
    await deps.panelRouter.routeMessage(msg, webview);
    deps.bumpStyleVersion();
    deps.reEmitSelectionAfterHmr();
    return;
  }

  // When the user clicks an element (or empty area) on the canvas, the webview
  // sends state:update with selectedIds. Make the canvas tab visually active
  // so keyboard events (Tab, Delete, etc.) go to the canvas instead of a sidebar.
  // reveal(false) activates the tab but steals focus from the iframe, so we
  // immediately post a message to refocus the iframe afterwards. NOTE: this does
  // NOT return — state:update must still fall through to PanelRouter below so
  // shared selection/state sync runs.
  if (msg.type === 'state:update') {
    const patch = (msg as { patch?: Record<string, unknown> }).patch;
    if (patch && 'selectedIds' in patch) {
      // Selecting an element on the canvas drives the inspector to show it —
      // that IS the "element inspected" signal. Emit it here with a SAFE count
      // only (no nodeRef, no path, no element identity), deduped via the holder
      // so a programmatic re-selection (move/insert) or identical re-click does
      // not over-count. An empty selection (cleared) carries no inspect signal.
      if (deps.inspectorSelection) {
        deps.inspectorSelection.lastKey = emitInspectorElementInspected(
          deps.track,
          patch,
          deps.inspectorSelection.lastKey,
        );
      }
      deps.panel?.reveal(undefined, false);
      webview.postMessage({ type: 'canvas:refocusIframe' });
    }
  }

  // Delegate shared platform messages (state:update, selection, AST responses, …)
  // to PanelRouter. This catch-all is required — without it every webview→extension
  // message PanelRouter owns is silently dropped (blank canvas, no selection sync).
  const handled = await deps.panelRouter.routeMessage(msg, webview);
  if (!handled) {
    console.log('[HyperIDE] Unknown message type:', msg.type);
  }
}

/**
 * Decide whether a selection patch should emit `inspector.elementInspected`, and
 * emit it if so. Pure aside from the `track` side effect; the dedupe key is
 * threaded in/out (the router holds it) so the same selection re-crossing the
 * host seam — e.g. the programmatic re-selection a move/insert posts, or an
 * identical re-click — does NOT re-count. Returns the new dedupe key the caller
 * must persist.
 *
 * Skips, returning `prevKey` unchanged:
 *  - an empty selection (a CLEAR, not an inspect),
 *  - an insert-panel patch (`insertTargetId` present) — that is an insert flow,
 *    not the user opening the inspector on an element,
 *  - a selection identical to the last one (dedupe).
 *
 * PII-SAFE: emits a `count` only — never the selected ids / nodeRefs / paths.
 * Exported so the mapping is unit-testable.
 */
export function emitInspectorElementInspected(
  track: MessageRouterDeps['track'],
  patch: Record<string, unknown>,
  prevKey: string | null,
): string | null {
  const selectedIds = patch.selectedIds;
  // A non-array selectedIds is a malformed patch — ignore it, keep the dedupe.
  if (!Array.isArray(selectedIds)) return prevKey;
  // A CLEAR (empty selection) is not an inspect, but it DOES reset the dedupe so
  // re-selecting the same element afterwards is counted as a fresh inspect.
  if (selectedIds.length === 0) return null;
  // An insert-panel selection is part of the insert flow, not an inspect.
  if ('insertTargetId' in patch && patch.insertTargetId) return prevKey;
  const key = selectedIds.join(',');
  if (key === prevKey) return prevKey;
  track?.(TelemetryEvents.inspectorElementInspected, { count: selectedIds.length });
  return key;
}

/** Map a `contextMenu:<suffix>` message type to its `ContextMenuAction` enum. */
function contextMenuActionFromType(type: string): ContextMenuAction | null {
  const suffix = type.slice('contextMenu:'.length);
  const valid: ReadonlySet<string> = new Set<ContextMenuAction>([
    'goToCode',
    'duplicate',
    'delete',
    'wrapInDiv',
    'copy',
    'paste',
    'cut',
    'selectParent',
    'selectChild',
    'copyText',
    'copyAsHTML',
  ]);
  return valid.has(suffix) ? (suffix as ContextMenuAction) : null;
}

/**
 * Classify an `ast:*` mutation message into a host-emitted canvas/inspector
 * telemetry event with PII-SAFE props only. Sends counts, type names (JSX
 * `componentType`/`wrapperType` — safe API identifiers), the `state` enum, the
 * move `position` enum, and a coarse `valueKind` — NEVER prop names/values,
 * style values, or edited text. Exported so the mapping is unit-testable.
 */
export function emitAstTelemetry(
  track: MessageRouterDeps['track'],
  msg: { type?: string; [key: string]: unknown },
): void {
  if (!track || !msg.type) return;
  switch (msg.type) {
    case 'ast:updateProps': {
      const props = (msg.props ?? {}) as Record<string, unknown>;
      const keys = Object.keys(props);
      track(TelemetryEvents.inspectorPropEdited, {
        propCount: keys.length,
        valueKind: valueKindOf(keys.length > 0 ? props[keys[0]] : undefined),
      });
      return;
    }
    case 'ast:updateStyles': {
      const styles = (msg.styles ?? {}) as Record<string, unknown>;
      const state = typeof msg.state === 'string' && msg.state.length > 0 ? msg.state : 'base';
      track(TelemetryEvents.inspectorStyleEdited, { styleCount: Object.keys(styles).length, state });
      return;
    }
    case 'ast:updateText':
      // No text — the edit kind is the whole signal.
      track(TelemetryEvents.inspectorTextEdited);
      return;
    case 'ast:insertElement': {
      const componentType = typeof msg.componentType === 'string' ? msg.componentType : 'unknown';
      track(TelemetryEvents.canvasElementInserted, { componentType });
      return;
    }
    case 'ast:wrapElement': {
      const wrapperType = typeof msg.wrapperType === 'string' ? msg.wrapperType : 'unknown';
      track(TelemetryEvents.canvasElementWrapped, { wrapperType });
      return;
    }
    case 'ast:deleteElements': {
      const ids = Array.isArray(msg.elementIds) ? msg.elementIds : [];
      track(TelemetryEvents.canvasElementDeleted, { count: ids.length });
      return;
    }
    case 'ast:duplicateElement':
      track(TelemetryEvents.canvasElementDuplicated);
      return;
    case 'ast:moveElement': {
      // `position` is the 'before' | 'after' enum from the AST move contract — safe.
      const position = msg.position === 'before' || msg.position === 'after' ? msg.position : 'after';
      track(TelemetryEvents.canvasElementMoved, { position });
      return;
    }
    default:
      // ast:writeI18nResource etc. carry user text — no telemetry.
      return;
  }
}

/**
 * Coerce a webview-supplied props bag to telemetry-safe scalars. Drops anything
 * that is not a string/number/boolean (objects, arrays, nested values) so a
 * webview cannot smuggle structured data — the host PII guard scrubs further.
 */
function coerceWebviewProps(raw: unknown): TelemetryProps {
  const out: TelemetryProps = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value as TelemetryValue;
    }
  }
  return out;
}
