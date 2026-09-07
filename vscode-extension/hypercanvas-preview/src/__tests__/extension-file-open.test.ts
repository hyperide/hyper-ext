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
import { openComponentFileThenRevealPreview } from '../component-selection-open-order';
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

// ---------------------------------------------------------------------------
// Regression test: split-view column ordering (HYP-1372, regression of HYP-363)
//
// Background: Alex reported that clicking a component in Hyper Explorer no
// longer opens a split view — the file opened as a plain tab next to "Hyper
// Canvas" in the SAME editor group. Precisely: the FIRST Explorer click in a
// fresh window never split, but every click after that DID. Live-reproduced
// via the Playwright/CDP e2e harness on a FRESH VS Code window (no file open
// yet) + react-vite-tw4-twitter: after the first click,
// `.editor-group-container` count was 1 (both "Hyper Canvas" and the clicked
// file as tabs in that one group); after a second click on a different
// component, count was 2 (a real split). Every existing e2e spec calls
// `Editor.openFile()` BEFORE opening the preview panel, which pre-creates a
// real ViewColumn.One — masking this exact ordering bug from automated
// coverage.
//
// Root cause: `previewPanel.createOrShow(ViewColumn.Two)` only materializes a
// genuine split relative to an EXISTING ViewColumn.One. On the very first
// Explorer click in a fresh window, calling it BEFORE any text editor is open
// has nothing at column One to split beside — VS Code collapses the webview
// into the sole (first) group. The immediately-following
// `showTextDocument(doc, { viewColumn: ViewColumn.One })` then resolves to
// that SAME sole group instead of creating a second one. By the second click,
// the first click's own (mis-split) file-open already created a real column
// One, so the preview panel's reveal finally has something to split beside.
//
// Fix: extracted to `openComponentFileThenRevealPreview`
// (component-selection-open-order.ts) — opens the file FIRST, so a real
// ViewColumn.One exists, THEN reveals the preview panel at ViewColumn.Two.
// These tests import and invoke the REAL production function (not a
// hand-copied simulation), with a manually-controlled `showTextDocument`
// promise so the assertion genuinely proves ordering — not just invocation
// order of two synchronous mock calls that both happened to run before the
// test's own microtask-count assertion. (The actual "does a split form"
// behavior is VS Code's own layout engine and isn't meaningfully mockable
// here; that's covered by the live Playwright/CDP repro referenced above.)
// ---------------------------------------------------------------------------

describe('openComponentFileThenRevealPreview: split-view column ordering (HYP-1372)', () => {
  it('revealPreview runs only AFTER showTextDocument resolves, never before', async () => {
    const order: string[] = [];
    let resolveShowTextDocument!: (editor: vscode.TextEditor) => void;
    const showTextDocumentPending = new Promise<vscode.TextEditor>((resolve) => {
      resolveShowTextDocument = resolve;
    });

    const openTextDocument = mock(async (uri: vscode.Uri) => ({ uri }) as unknown as vscode.TextDocument);
    const showTextDocument = mock(() => {
      order.push('showTextDocument:called');
      return showTextDocumentPending;
    });
    const revealPreview = mock((column: vscode.ViewColumn) => {
      order.push(`revealPreview:${column}`);
    });

    const done = openComponentFileThenRevealPreview('/test-workspace/src/Button.tsx', {
      openTextDocument,
      showTextDocument,
      revealPreview,
    });

    // Let openTextDocument's microtask settle and showTextDocument get called —
    // but its promise is still PENDING (deliberately not resolved yet).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(showTextDocument).toHaveBeenCalledTimes(1);
    // The whole point of the fix: revealPreview must NOT have run yet while
    // showTextDocument is still pending. A regression that calls revealPreview
    // synchronously (or immediately after kicking off showTextDocument without
    // awaiting it) would fail this assertion.
    expect(revealPreview).not.toHaveBeenCalled();

    // Now let showTextDocument resolve, and let the function finish.
    resolveShowTextDocument({} as vscode.TextEditor);
    await done;

    expect(order).toEqual(['showTextDocument:called', `revealPreview:${vscode.ViewColumn.Two}`]);
    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ viewColumn: vscode.ViewColumn.One }),
    );
  });

  it('still reveals the preview panel when openTextDocument rejects (no unhandled rejection)', async () => {
    const revealPreview = mock(() => {});
    const openTextDocument = mock(async () => {
      throw new Error('boom: file does not exist');
    });
    const showTextDocument = mock(async () => ({}) as vscode.TextEditor);

    // Must not throw / reject — the caller does `void openComponentFileThenRevealPreview(...)`
    // with no .catch, so any rejection here would become an unhandled promise
    // rejection in production (the exact "Unhandled rejection…" toast this
    // module's own file-open error handling exists to avoid).
    await expect(
      openComponentFileThenRevealPreview('/test-workspace/src/Missing.tsx', {
        openTextDocument,
        showTextDocument,
        revealPreview,
      }),
    ).resolves.toBeUndefined();

    expect(showTextDocument).not.toHaveBeenCalled();
    expect(revealPreview).toHaveBeenCalledWith(vscode.ViewColumn.Two);
  });

  it('still reveals the preview panel when showTextDocument rejects (no unhandled rejection)', async () => {
    // This is the specific failure the original extension.ts comment called
    // out by name: showTextDocument (not just openTextDocument) can reject —
    // a disposed editor, a workspace switch, or another panel closing all
    // editors mid-flight — and that used to become an unhandled promise
    // rejection surfaced as an "Unhandled rejection…" toast.
    const revealPreview = mock(() => {});
    const openTextDocument = mock(async (uri: vscode.Uri) => ({ uri }) as unknown as vscode.TextDocument);
    const showTextDocument = mock(async () => {
      throw new Error('boom: editor was disposed mid-open');
    });

    await expect(
      openComponentFileThenRevealPreview('/test-workspace/src/Button.tsx', {
        openTextDocument,
        showTextDocument,
        revealPreview,
      }),
    ).resolves.toBeUndefined();

    expect(openTextDocument).toHaveBeenCalledTimes(1);
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    expect(revealPreview).toHaveBeenCalledWith(vscode.ViewColumn.Two);
  });

  it('does not throw when revealPreview itself throws (e.g. a disposed panel)', async () => {
    const openTextDocument = mock(async (uri: vscode.Uri) => ({ uri }) as unknown as vscode.TextDocument);
    const showTextDocument = mock(async () => ({}) as vscode.TextEditor);
    const revealPreview = mock(() => {
      throw new Error('Webview is disposed');
    });

    await expect(
      openComponentFileThenRevealPreview('/test-workspace/src/Button.tsx', {
        openTextDocument,
        showTextDocument,
        revealPreview,
      }),
    ).resolves.toBeUndefined();

    expect(revealPreview).toHaveBeenCalledTimes(1);
  });

  it('reveals the preview panel on a bounded fallback timeout when the file open never settles', async () => {
    // A Remote-SSH/WSL/virtual-filesystem provider can leave the Thenable
    // pending forever (not rejected — genuinely never settling). Before this
    // guard, revealPreview lived in a `finally` after both awaits, so a hang
    // here would leave the preview panel stuck closed forever — worse than
    // the pre-fix behavior, where the panel opened synchronously regardless
    // of file I/O.
    const revealPreview = mock(() => {});
    const openTextDocument = mock(() => new Promise<vscode.TextDocument>(() => {})); // never resolves
    const showTextDocument = mock(async () => ({}) as vscode.TextEditor);

    const FALLBACK_MS = 20; // short, so the test itself stays fast
    await expect(
      openComponentFileThenRevealPreview(
        '/test-workspace/src/Slow.tsx',
        { openTextDocument, showTextDocument, revealPreview },
        FALLBACK_MS,
      ),
    ).resolves.toBeUndefined();

    expect(revealPreview).toHaveBeenCalledWith(vscode.ViewColumn.Two);
    // showTextDocument never had a chance to run — openTextDocument itself
    // never settled — confirming this genuinely exercised the timeout path,
    // not a fast resolution that happened to land before the assertion.
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});
