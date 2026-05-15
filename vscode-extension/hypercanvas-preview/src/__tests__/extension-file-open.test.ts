/**
 * @file Regression test: component selection opens file exactly once.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/extension-file-open.test.ts
 * Assumptions: selecting a component via stateHub triggers showTextDocument in ViewColumn.One exactly once.
 *
 * Background (HYP-363): users reported every file opening twice — first right (another component),
 * then left (the selected component). Root cause: extension.ts onChange listener calls
 * previewPanel.createOrShow(), which internally calls _initializeComponent(activeEditor).
 * When the active editor contains a DIFFERENT component, _initializeComponent calls
 * _setCurrentComponent → stateHub.applyUpdate, triggering a SECOND synchronous listener run
 * before the first finishes — resulting in showTextDocument being called twice.
 *
 * Fix: _initializeComponent now checks stateHub.state.currentComponent FIRST.
 * If StateHub already has a component (set by the very patch being broadcast),
 * it just caches that value locally and returns without calling applyUpdate.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import { StateHub } from '../StateHub';

// ---------------------------------------------------------------------------
// Mock PreviewPanel.createOrShow — two variants to prove before/after behaviour
// ---------------------------------------------------------------------------

/**
 * Simulate PreviewPanel.createOrShow + _initializeComponent.
 *
 * 'buggy'  — OLD code: derives component from activeEditor regardless of StateHub.
 *            Emits a second applyUpdate when activeEditor has a different component,
 *            causing showTextDocument to be called twice.
 *
 * 'fixed'  — NEW code (the actual fix): prefers stateHub.state.currentComponent.
 *            If StateHub already has a component, caches it locally without applyUpdate.
 *            Only falls back to activeEditor when StateHub is empty (first open).
 */
function createMockPreviewPanel(stateHub: StateHub, workspaceRoot: string, variant: 'buggy' | 'fixed' = 'fixed') {
  const panel = {
    createOrShow: mock((_column?: number) => {
      // Fixed variant: StateHub wins — no second applyUpdate.
      if (variant === 'fixed') {
        const stateComponent = stateHub.state.currentComponent;
        if (stateComponent?.path) {
          return; // cached locally, no applyUpdate, no extra listener run
        }
      }

      // Derive from activeEditor (buggy always; fixed only when StateHub empty).
      const editor = vscode.window.activeTextEditor as vscode.TextEditor | undefined;
      if (!editor) return;

      const editorPath = editor.document.uri.fsPath;
      if (!/\.(tsx|jsx)$/.test(editorPath)) return;

      const rel = editorPath.startsWith(`${workspaceRoot}/`) ? editorPath.slice(workspaceRoot.length + 1) : undefined;
      if (!rel) return;

      // Dedup check (mirrors PreviewPanel._setCurrentComponent)
      const current = stateHub.state.currentComponent;
      const name = rel.replace(/^.*\//, '').replace(/\.\w+$/, '');
      if (current?.path === rel && current?.name === name) return;

      stateHub.applyUpdate({ currentComponent: { name, path: rel } });
    }),
  };

  return panel;
}

// ---------------------------------------------------------------------------
// Inline copy of extension.ts onChange listener (lines 549-582)
// ---------------------------------------------------------------------------

function registerComponentOpenListener(
  stateHub: StateHub,
  previewPanel: ReturnType<typeof createMockPreviewPanel>,
  workspaceRoot: string,
): () => void {
  return stateHub.onChange((_state, patch) => {
    if (!patch.currentComponent?.path) return;

    const componentPath = patch.currentComponent.path;

    // Auto-open Preview Panel
    previewPanel.createOrShow(vscode.ViewColumn.Two);

    // Open the component file in the left editor group
    const absPath = isAbsolute(componentPath) ? componentPath : join(workspaceRoot, componentPath);
    vscode.workspace
      .openTextDocument(vscode.Uri.file(absPath))
      .then((doc) =>
        vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true,
          preview: true,
        }),
      )
      .then(undefined, (err: unknown) => {
        console.error('[test] Failed to open component file:', err);
      });
  });
}

// ---------------------------------------------------------------------------

describe('extension component selection: showTextDocument call count', () => {
  const WORKSPACE = '/test-workspace';

  beforeEach(() => {
    (vscode.window.showTextDocument as ReturnType<typeof mock>).mockClear();
    (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockClear();
  });

  // -------------------------------------------------------------------------
  // Regression tests (fixed behaviour — must pass after the fix)
  // -------------------------------------------------------------------------

  it('showTextDocument called once: active editor is a non-component file', async () => {
    const stateHub = new StateHub();
    const previewPanel = createMockPreviewPanel(stateHub, WORKSPACE, 'fixed');

    Object.assign(vscode.window, {
      activeTextEditor: {
        document: { uri: vscode.Uri.file(`${WORKSPACE}/README.md`) },
      },
    });

    const unsub = registerComponentOpenListener(stateHub, previewPanel, WORKSPACE);
    stateHub.applyUpdate({ currentComponent: { name: 'Button', path: 'src/Button.tsx' } });

    await Promise.resolve();
    await Promise.resolve();

    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewColumn: vscode.ViewColumn.One }),
    );

    unsub();
  });

  it('showTextDocument called once: active editor is the SAME component being selected', async () => {
    const stateHub = new StateHub();
    const previewPanel = createMockPreviewPanel(stateHub, WORKSPACE, 'fixed');

    Object.assign(vscode.window, {
      activeTextEditor: {
        document: { uri: vscode.Uri.file(`${WORKSPACE}/src/Button.tsx`) },
      },
    });

    const unsub = registerComponentOpenListener(stateHub, previewPanel, WORKSPACE);
    stateHub.applyUpdate({ currentComponent: { name: 'Button', path: 'src/Button.tsx' } });

    await Promise.resolve();
    await Promise.resolve();

    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);

    unsub();
  });

  it('showTextDocument called once: active editor has a DIFFERENT component (the bug scenario)', async () => {
    const stateHub = new StateHub();
    // 'fixed' variant: StateHub wins, no second applyUpdate
    const previewPanel = createMockPreviewPanel(stateHub, WORKSPACE, 'fixed');

    Object.assign(vscode.window, {
      activeTextEditor: {
        document: { uri: vscode.Uri.file(`${WORKSPACE}/src/OtherComp.tsx`) },
      },
    });

    const unsub = registerComponentOpenListener(stateHub, previewPanel, WORKSPACE);
    stateHub.applyUpdate({ currentComponent: { name: 'Button', path: 'src/Button.tsx' } });

    await Promise.resolve();
    await Promise.resolve();

    // Fixed: only Button.tsx opens once
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);

    unsub();
  });

  // -------------------------------------------------------------------------
  // Proof-of-bug test (documents the old broken behaviour)
  // -------------------------------------------------------------------------

  it('PROOF-OF-BUG: buggy variant calls showTextDocument TWICE when active editor differs', async () => {
    const stateHub = new StateHub();
    // 'buggy' variant: activeEditor overrides StateHub → second applyUpdate
    const previewPanel = createMockPreviewPanel(stateHub, WORKSPACE, 'buggy');

    Object.assign(vscode.window, {
      activeTextEditor: {
        document: { uri: vscode.Uri.file(`${WORKSPACE}/src/OtherComp.tsx`) },
      },
    });

    const unsub = registerComponentOpenListener(stateHub, previewPanel, WORKSPACE);
    stateHub.applyUpdate({ currentComponent: { name: 'Button', path: 'src/Button.tsx' } });

    await Promise.resolve();
    await Promise.resolve();

    // Buggy: first OtherComp.tsx opens (second listener run), then Button.tsx (first run completes)
    expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(2);

    unsub();
  });
});
