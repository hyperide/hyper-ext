/**
 * Context menu handlers for PreviewPanel.
 * Extracted as standalone functions to reduce PreviewPanel.ts size.
 */

import * as vscode from 'vscode';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import { handleEditorMessage } from './EditorBridge';

export interface ContextMenuDeps {
  currentComponent: string | undefined;
  panelRouter: PanelRouter;
  stateHub: StateHub;
  pendingContentRequests: Map<string, (result: { text: string; html: string }) => void>;
  pendingScreenshotRequests: Map<string, (result: { dataUrl: string | null }) => void>;
  generateRandomId(length: number): string;
}

export async function handleContextMenuGoToCode(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
  webview: vscode.Webview,
): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  // Resolve the selected element to its full JSX range in its OWN file so the editor selects
  // the element (not just a caret) and focuses its tab. The old `getElementLocation(path, id)`
  // passed no nodeRef and always returned null — context-menu Go-to-Code did nothing.
  const range = await deps.panelRouter.astBridge.getElementRange(componentPath, elementId);

  if (range) {
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

export async function handleContextMenuDuplicate(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  const result = await deps.panelRouter.astBridge.duplicateElement(componentPath, elementId);

  if (result.success && result.newId) {
    deps.stateHub.applyUpdate({
      selectedIds: [result.newId],
    });
  } else if (!result.success) {
    void vscode.window.showErrorMessage(`HyperCanvas: Could not duplicate element. ${result.error ?? ''}`);
  }
}

export async function handleContextMenuDelete(deps: ContextMenuDeps, msg: { [key: string]: unknown }): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  const result = await deps.panelRouter.astBridge.deleteElements(componentPath, [elementId]);

  if (result.success) {
    deps.stateHub.applyUpdate({
      selectedIds: [],
    });
  }
}

export async function handleContextMenuWrapInDiv(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  const result = await deps.panelRouter.astBridge.wrapElement(componentPath, elementId, 'div');

  if (result.success && result.wrapperId) {
    deps.stateHub.applyUpdate({
      selectedIds: [result.wrapperId],
    });
  }
}

export async function handleContextMenuCopy(deps: ContextMenuDeps, msg: { [key: string]: unknown }): Promise<void> {
  const elementIds = msg.elementIds as string[] | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementIds?.length) return;

  const codes: string[] = [];
  for (const id of elementIds) {
    const code = await deps.panelRouter.astBridge.astService.getElementCode(componentPath, id);
    if (code) codes.push(code);
  }

  if (codes.length > 0) {
    await vscode.env.clipboard.writeText(codes.join('\n'));
  }
}

export async function handleContextMenuPaste(deps: ContextMenuDeps, msg: { [key: string]: unknown }): Promise<void> {
  const targetId = (msg.targetId as string) || null;
  const componentPath = deps.currentComponent;
  if (!componentPath) return;

  const tsxCode = await vscode.env.clipboard.readText();
  if (!tsxCode.trim()) return;

  const result = await deps.panelRouter.astBridge.pasteElement(componentPath, targetId, tsxCode);

  if (result.success && result.newId) {
    deps.stateHub.applyUpdate({
      selectedIds: [result.newId],
    });
  }
}

export async function handleContextMenuCut(deps: ContextMenuDeps, msg: { [key: string]: unknown }): Promise<void> {
  // Copy first
  await handleContextMenuCopy(deps, msg);

  // Then delete
  const elementIds = msg.elementIds as string[] | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementIds?.length) return;

  const result = await deps.panelRouter.astBridge.deleteElements(componentPath, elementIds);

  if (result.success) {
    deps.stateHub.applyUpdate({
      selectedIds: [],
    });
  }
}

export async function handleContextMenuSelectParent(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  const parentId = await deps.panelRouter.astBridge.astService.getParentElementId(componentPath, elementId, elementId);

  if (parentId) {
    deps.stateHub.applyUpdate({
      selectedIds: [parentId],
    });
  }
}

export async function handleContextMenuSelectChild(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
): Promise<void> {
  const elementId = msg.elementId as string | undefined;
  const componentPath = deps.currentComponent;
  if (!componentPath || !elementId) return;

  const childIds = await deps.panelRouter.astBridge.astService.getChildElementIds(elementId);

  if (childIds.length > 0) {
    deps.stateHub.applyUpdate({
      selectedIds: childIds,
    });
  }
}

export function handleContextMenuCopyContent(
  deps: ContextMenuDeps,
  msg: { [key: string]: unknown },
  webview: vscode.Webview,
  mode: 'text' | 'html',
): void {
  const elementId = msg.elementId as string | undefined;
  if (!elementId) return;

  const requestId = `content-${Date.now()}-${deps.generateRandomId(6)}`;
  deps.pendingContentRequests.set(requestId, (result) => {
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
    deps.pendingContentRequests.delete(requestId);
  }, 5000);
}

export function handleElementContentResult(deps: ContextMenuDeps, msg: { [key: string]: unknown }): void {
  const requestId = msg.requestId as string | undefined;
  if (!requestId) return;

  const callback = deps.pendingContentRequests.get(requestId);
  if (callback) {
    callback({ text: msg.text as string, html: msg.html as string });
    deps.pendingContentRequests.delete(requestId);
  }
}

export function handleScreenshotResult(deps: ContextMenuDeps, msg: { [key: string]: unknown }): void {
  const requestId = msg.requestId as string | undefined;
  if (!requestId) return;

  const callback = deps.pendingScreenshotRequests.get(requestId);
  if (callback) {
    callback({ dataUrl: (msg.dataUrl as string) ?? null });
    deps.pendingScreenshotRequests.delete(requestId);
  }
}
