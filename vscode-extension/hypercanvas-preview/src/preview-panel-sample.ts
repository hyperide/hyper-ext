/**
 * Preview panel sample generation and watching utilities.
 * Extracted to reduce PreviewPanel.ts size.
 */

import * as vscode from 'vscode';
import { generateSamplePropValues } from '@lib/preview-generator';
import { stripFunctions } from './preview-utils';
import { postToWebviewSafe, postToWebviewRawSafe } from './webview-post';
import type { PanelRouter } from './PanelRouter';

export async function injectGeneratedSampleProps(
  panel: vscode.WebviewPanel | undefined,
  panelRouter: PanelRouter,
  componentPath: string,
  previewKey: string,
  onDisposed?: () => void,
): Promise<boolean> {
  if (!panel) return false;

  const component = await panelRouter.componentService?.getComponent(componentPath).catch(() => null);
  const propDefs = component?.props ?? null;
  const rawValues =
    propDefs && propDefs.length > 0
      ? generateSamplePropValues(propDefs, { componentName: component?.name }).values
      : {};

  const values = stripFunctions(rawValues) as Record<string, unknown>;

  // Panel can be disposed during the awaited getComponent above; postToWebviewSafe
  // neutralizes the disposed-webview throw — see webview-post.ts.
  const posted = postToWebviewSafe(
    panel,
    {
      type: 'setGeneratedProps',
      componentPath: previewKey,
      values,
    },
    onDisposed,
  );
  if (!posted) return false;
  return Object.keys(values).length > 0;
}

export interface SampleWatcherState {
  watcher?: vscode.Disposable;
}

export function watchSampleInFile(
  state: SampleWatcherState,
  absPath: string,
  exportName: string,
  webview: vscode.Webview,
): void {
  state.watcher?.dispose();

  const fileUri = vscode.Uri.file(absPath);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(fileUri, ''));

  const stopWatching = () => {
    state.watcher?.dispose();
    state.watcher = undefined;
  };

  // Post the sample-deleted notice and tear down the watcher. Disposed-safe: these fire
  // on later watcher events that can outlive the webview (workspace switch / tab close /
  // E2E teardown). On a disposed webview, drop the now-pointless watcher too — otherwise it
  // would fire forever against a dead webview. See webview-post.ts.
  const notifySampleDeletedAndStop = () => {
    postToWebviewRawSafe(webview, { type: 'errorOverlay:sampleDeleted', sampleName: exportName }, stopWatching);
    stopWatching();
  };

  const checkSample = async () => {
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(bytes).toString('utf-8');
      const exists = content.includes(`export const ${exportName}`);
      if (!exists) notifySampleDeletedAndStop();
    } catch {
      notifySampleDeletedAndStop();
    }
  };

  watcher.onDidChange(checkSample);
  watcher.onDidDelete(notifySampleDeletedAndStop);

  state.watcher = watcher;
}

export function buildPropEntries(propValues?: Record<string, unknown>): Array<[string, unknown]> {
  return propValues
    ? Object.entries(propValues).filter(([, v]) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim() !== '';
        return true;
      })
    : [];
}

export function buildSampleScaffold(
  componentName: string,
  exportName: string,
  propEntries: Array<[string, unknown]>,
  sourceCode = '',
): string {
  const { buildSampleScaffold } = require('@lib/preview-generator');
  return buildSampleScaffold({ sourceCode, componentName, exportName, propEntries });
}
