/**
 * Preview panel setup utilities.
 * Extracted to reduce PreviewPanel.ts size.
 */

import * as vscode from 'vscode';
import { setMovePreviewToRight, setupActiveFileListener } from './EditorBridge';
import type { StateHub } from './StateHub';
import type { PanelRouter } from './PanelRouter';
import type { LifecycleEffect, LifecycleEvent } from './PreviewLifecycle';

/**
 * Focused dependency surface for panel setup. Built inside PreviewPanel (private
 * members are legally accessible from within the class) and passed here, so this
 * helper never reaches into PreviewPanel's private fields directly. Mutable backing
 * fields are exposed through getters/setters; behavior is exposed through bound methods.
 */
export interface PanelSetupDeps {
  extensionUri: vscode.Uri;
  stateHub: StateHub;
  panelRouter: PanelRouter;
  setPanel(panel: vscode.WebviewPanel | undefined): void;
  getPanel(): vscode.WebviewPanel | undefined;
  getDisposables(): vscode.Disposable[];
  setDisposables(disposables: vscode.Disposable[]): void;
  getCurrentComponent(): string | undefined;
  getReEmitTimer(): ReturnType<typeof setTimeout> | null;
  setReEmitTimer(timer: ReturnType<typeof setTimeout> | null): void;
  getSampleWatcher(): vscode.Disposable | undefined;
  setSampleWatcher(watcher: vscode.Disposable | undefined): void;
  getSyncService(): { dispose(): void } | undefined;
  setSyncService(service: undefined): void;
  getHtmlForWebview(): string;
  handleMessage(message: unknown, webview: vscode.Webview): Promise<void>;
  updateComponentFromEditor(editor?: vscode.TextEditor): void;
  dispatch(event: LifecycleEvent): readonly LifecycleEffect[];
  startSyncService(): void;
  initializeComponent(activeEditor?: vscode.TextEditor): void;
}

export function setupPanel(
  deps: PanelSetupDeps,
  panel: vscode.WebviewPanel,
  activeEditor: vscode.TextEditor | undefined,
  panelId: string,
): void {
  deps.setPanel(panel);

  setMovePreviewToRight(() => {
    deps.getPanel()?.reveal(vscode.ViewColumn.Two, true);
  });

  panel.iconPath = vscode.Uri.joinPath(deps.extensionUri, 'media', 'icon.png');

  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'out')],
  };

  deps.stateHub.register(panelId, panel.webview);
  deps.panelRouter.setAstResponseTarget(panel.webview);

  panel.webview.onDidReceiveMessage(
    async (message) => {
      await deps.handleMessage(message, panel.webview);
    },
    undefined,
    deps.getDisposables(),
  );

  panel.webview.html = deps.getHtmlForWebview();

  deps.getDisposables().push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      deps.updateComponentFromEditor(editor);
    }),
  );

  deps.getDisposables().push(setupActiveFileListener(panel.webview));

  const unsubState = deps.stateHub.onChange((_state, patch) => {
    if (patch.currentComponent !== undefined) {
      const component = patch.currentComponent;
      if (component && deps.getCurrentComponent() !== component.path) {
        deps.dispatch({ type: 'componentChanged', repoPath: component.path });
        console.log('[HyperIDE] Component changed via state:', component.path);
      }
    }
  });
  deps.getDisposables().push({ dispose: unsubState });

  deps.startSyncService();

  panel.onDidDispose(() => {
    const timer = deps.getReEmitTimer();
    if (timer) {
      clearTimeout(timer);
      deps.setReEmitTimer(null);
    }
    deps.dispatch({ type: 'dispose' });
    for (const d of deps.getDisposables()) d.dispose();
    deps.setDisposables([]);
    deps.getSampleWatcher()?.dispose();
    deps.setSampleWatcher(undefined);
    deps.getSyncService()?.dispose();
    deps.stateHub.unregister(panelId);
    deps.setSyncService(undefined);
    deps.setPanel(undefined);
    setMovePreviewToRight(null);
  }, undefined);

  deps.initializeComponent(activeEditor);
}
