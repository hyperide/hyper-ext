/**
 * Preview panel message router — handles all messages from the webview.
 * Extracted to reduce PreviewPanel.ts size.
 */

import * as vscode from 'vscode';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import type { DevServerRuntimeError } from './types';
import { generateSamplePropValues } from '@lib/preview-generator';

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
    void deps.onScopeChange?.(scope);
    return;
  }
  if (msg.type === 'runtime:error') {
    const error = (msg as { error?: unknown }).error ?? null;
    deps.onRuntimeErrorCallback?.(error as DevServerRuntimeError | null);
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
  if (msg.type === 'errorBoundary:getPropsSchema') {
    const componentPath = msg.componentPath as string | undefined;
    if (componentPath) {
      const props = await deps.panelRouter.componentService.getComponentDefinitions(componentPath);
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

  // === Canvas undo/redo ===
  if (msg.type === 'canvas:undo') {
    await deps.undo();
    return;
  }
  if (msg.type === 'canvas:redo') {
    await deps.redo();
    return;
  }

  // === Keyboard-driven delete (from iframe keyboard handler) ===
  if (msg.type === 'keyboard:delete') {
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = deps.currentComponent;
    if (!componentPath || !elementIds?.length) return;
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
    const result = await deps.panelRouter.astBridge.duplicateElement(componentPath, elementId);
    if (result.success && result.newId) {
      deps.stateHub.applyUpdate({ selectedIds: [result.newId] });
    }
    return;
  }

  // === Context menu handlers ===
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

  // === Dev server status ===
  if (msg.type === 'devserver:statusChanged') {
    const running = msg.running as boolean;
    if (running) {
      deps.updatePreviewUrl();
    } else {
      deps.panel?.webview.postMessage({ type: 'devserver:statusChanged', running: false, url: null });
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
