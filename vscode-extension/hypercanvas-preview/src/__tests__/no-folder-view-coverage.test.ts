/**
 * @file Drift guard for the HYP-1237 no-folder empty-state view coverage.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/no-folder-view-coverage.test.ts
 *
 * `NO_FOLDER_VIEW_TYPES` (extension.ts) must list every `webview` view id declared
 * in package.json's `contributes.views`. If a new HyperIDE view is added to
 * package.json without a matching entry here, `registerNoFolderViews` won't
 * register a provider for it, and that view silently regresses to the original
 * HYP-1237 infinite-spinner bug when no workspace folder is open. This test
 * fails loudly instead.
 *
 * This is the first test file to import `../extension` directly (every other
 * test importing "extension-something" actually imports a separate, smaller
 * sibling module — extension-utils.ts, extension-commands.ts, etc. — not the
 * big extension.ts). That pulls in DevServerManager -> PreviewProxy, which
 * reads the pre-built iframe scripts via `fs.readFileSync` AT IMPORT TIME;
 * those .js files only exist next to the bundled `out/` output, not next to
 * the TypeScript source. Stub it exactly like
 * `PreviewProxy.serving.test.ts` does, or the import throws ENOENT before
 * any test body runs. Requires `--isolate` (the repo `test` script and CI
 * both pass it) so this process-global `mock.module` doesn't leak into
 * other test files.
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import packageJson from '../../package.json';

const realFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return realFs.readFileSync(file as string, enc as never);
  },
}));

const { NO_FOLDER_VIEW_TYPES, registerNoFolderViews, activate } = await import('../extension');

interface ViewEntry {
  type?: string;
  id: string;
}

function declaredWebviewViewIds(): string[] {
  const views = (packageJson as { contributes: { views: Record<string, ViewEntry[]> } }).contributes.views;
  return Object.values(views)
    .flat()
    .filter((entry) => entry.type === 'webview')
    .map((entry) => entry.id);
}

describe('NO_FOLDER_VIEW_TYPES coverage', () => {
  it('covers every webview view id declared in package.json contributes.views', () => {
    const declared = declaredWebviewViewIds().toSorted();
    const registered = [...NO_FOLDER_VIEW_TYPES].toSorted();
    expect(registered).toEqual(declared);
  });
});

describe('registerNoFolderViews', () => {
  // `vscode.window.registerWebviewViewProvider` / `vscode.workspace.onDidChangeWorkspaceFolders`
  // aren't in the shared test/mock-vscode.ts (nothing called them before this file). Patch them
  // locally on the shared mock objects — same pattern webview-disposed-guard.test.ts uses for
  // `vscode.workspace.createFileSystemWatcher` — instead of extending the global mock file.
  function createContext(): vscode.ExtensionContext {
    return { subscriptions: [] } as unknown as vscode.ExtensionContext;
  }

  function stubViewRegistration() {
    const registerWebviewViewProvider = mock(() => ({ dispose: mock() }));
    let changeHandler: (() => void) | undefined;
    const onDidChangeWorkspaceFolders = mock((cb: () => void) => {
      changeHandler = cb;
      return { dispose: mock() };
    });
    Object.assign(vscode.window, { registerWebviewViewProvider });
    Object.assign(vscode.workspace, { onDidChangeWorkspaceFolders });
    return { registerWebviewViewProvider, getChangeHandler: () => changeHandler };
  }

  it('registers a webview view provider for every NO_FOLDER_VIEW_TYPES id (no loop/skip bug)', () => {
    const { registerWebviewViewProvider } = stubViewRegistration();

    registerNoFolderViews(createContext());

    const registeredIds = registerWebviewViewProvider.mock.calls.map((call) => call[0]);
    expect(registeredIds.toSorted()).toEqual([...NO_FOLDER_VIEW_TYPES].toSorted());
  });

  it('reloads the window once a folder is present when onDidChangeWorkspaceFolders fires', () => {
    const { getChangeHandler } = stubViewRegistration();
    registerNoFolderViews(createContext());
    expect(getChangeHandler()).toBeDefined();

    const previousFolders = vscode.workspace.workspaceFolders;
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: vscode.Uri.file('/now-open'), name: 'now-open', index: 0 }],
    });
    try {
      getChangeHandler()?.();
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
    } finally {
      Object.assign(vscode.workspace, { workspaceFolders: previousFolders });
    }
  });

  it('does NOT reload when onDidChangeWorkspaceFolders fires but still no folder is open', () => {
    const { getChangeHandler } = stubViewRegistration();
    registerNoFolderViews(createContext());
    expect(getChangeHandler()).toBeDefined();

    const previousFolders = vscode.workspace.workspaceFolders;
    Object.assign(vscode.workspace, { workspaceFolders: [] });
    try {
      getChangeHandler()?.();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.reloadWindow');
    } finally {
      Object.assign(vscode.workspace, { workspaceFolders: previousFolders });
    }
  });
});

describe('activate() — real early-return path (review finding: the extracted-function tests above never call activate() itself)', () => {
  // registerNoFolderViews() being correct doesn't prove activate() still calls it: someone could
  // move/remove the `if (!workspaceRoot) { registerNoFolderViews(context); return; }` branch and
  // every test above would keep passing while the real HYP-1237 spinner regression came back.
  // This test drives activate() itself with an empty workspace, the actual regression surface.
  function createContext(): vscode.ExtensionContext {
    return { subscriptions: [] } as unknown as vscode.ExtensionContext;
  }

  it('registers the no-folder webview providers when activate() runs with no workspace folder open', () => {
    const registerWebviewViewProvider = mock(() => ({ dispose: mock() }));
    Object.assign(vscode.window, { registerWebviewViewProvider });

    const previousFolders = vscode.workspace.workspaceFolders;
    Object.assign(vscode.workspace, { workspaceFolders: [] });
    try {
      activate(createContext());

      const registeredIds = registerWebviewViewProvider.mock.calls.map((call) => call[0]);
      expect(registeredIds.toSorted()).toEqual([...NO_FOLDER_VIEW_TYPES].toSorted());
    } finally {
      Object.assign(vscode.workspace, { workspaceFolders: previousFolders });
    }
  });
});
