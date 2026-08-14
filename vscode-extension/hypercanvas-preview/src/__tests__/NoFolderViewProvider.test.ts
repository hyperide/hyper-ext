/**
 * @file NoFolderViewProvider tests (HYP-1237, follow-up: exact copy + two actions).
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/NoFolderViewProvider.test.ts
 *
 * Regression guarded here: `activate()` used to `return` before registering ANY
 * `WebviewViewProvider` when no workspace folder was open, so every HyperIDE view
 * (declared statically in package.json) sat in VS Code's initial "loading" state
 * forever — a permanent activity-bar spinner and a blank panel, with no error and
 * no timeout. `NoFolderViewProvider.resolveWebviewView` must set `webview.html`
 * SYNCHRONOUSLY (not after some async resource fetch) so the view resolves on the
 * very first call — that's what actually breaks the infinite-spinner state.
 *
 * Follow-up regression guarded here (Alex, 2026-08-14): the empty state must match
 * his literal spec — heading "No folder opened", the exact body copy contrasting
 * "Open Folder" (closes all editors) against a separate "add a folder" action
 * (does NOT close editors) — matching VS Code's own native Explorer empty-state
 * convention. "add a folder" must be wired to `workbench.action.addRootFolder`,
 * a DIFFERENT command from the "Open Folder" button's
 * `workbench.action.files.openFolder`. Collapsing the two actions onto the same
 * command silently regresses the whole point of offering "add a folder".
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import {
  buildNoFolderEmptyStateHtml,
  escapeHtml,
  NO_FOLDER_BODY_AFTER_LINK,
  NO_FOLDER_BODY_BEFORE_LINK,
  NO_FOLDER_BODY_LINK_TEXT,
  NO_FOLDER_HEADING,
  NoFolderViewProvider,
} from '../NoFolderViewProvider';

describe('escapeHtml', () => {
  it('escapes markup so it cannot break out of the element it is interpolated into', () => {
    // The copy is fixed constants today, but this function is the only thing
    // standing between a future dynamic caller and a DOM break-out/XSS — keep
    // it covered directly, not just indirectly through today's safe inputs.
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('buildNoFolderEmptyStateHtml', () => {
  it('renders the exact heading Alex specified', () => {
    const html = buildNoFolderEmptyStateHtml();
    expect(html).toContain(`<h2>${NO_FOLDER_HEADING}</h2>`);
  });

  it('renders the exact body copy Alex specified, as one contiguous sentence', () => {
    const html = buildNoFolderEmptyStateHtml();
    const fullSentence = `${NO_FOLDER_BODY_BEFORE_LINK}${NO_FOLDER_BODY_LINK_TEXT}${NO_FOLDER_BODY_AFTER_LINK}`;
    expect(fullSentence).toBe(
      'Opening folder will close all current editors. To keep them open, add a folder instead.',
    );
    // The link text sits inside an <a> in the middle of the sentence, so the
    // full sentence isn't literally contiguous in the markup — assert each
    // piece is present and in document order instead of one substring match.
    const beforeIdx = html.indexOf(NO_FOLDER_BODY_BEFORE_LINK);
    const linkIdx = html.indexOf(`>${NO_FOLDER_BODY_LINK_TEXT}<`);
    const afterIdx = html.indexOf(NO_FOLDER_BODY_AFTER_LINK, linkIdx);
    expect(beforeIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(beforeIdx);
    expect(afterIdx).toBeGreaterThan(linkIdx);
  });

  it('renders "add a folder" as its own clickable <a> action, distinct from the Open Folder button', () => {
    const html = buildNoFolderEmptyStateHtml();
    expect(html).toContain(`<a id="hyperide-add-folder" href="#" role="button">${NO_FOLDER_BODY_LINK_TEXT}</a>`);
    expect(html).toContain('<button id="hyperide-open-folder">Open Folder</button>');
  });

  it('wires the Open Folder button and the add-a-folder link to different postMessage types', () => {
    const html = buildNoFolderEmptyStateHtml();
    expect(html).toContain("postMessage({ type: 'openFolder' })");
    expect(html).toContain("postMessage({ type: 'addFolder' })");
  });

  it('renders a real document with a restrictive CSP', () => {
    const html = buildNoFolderEmptyStateHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('is non-empty and does not depend on any external resource URI', () => {
    // No webview.asWebviewUri(...) calls — the empty state has to render with
    // zero setup, since it may be shown before any real workspace/build exists.
    const html = buildNoFolderEmptyStateHtml();
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain('asWebviewUri');
  });
});

describe('NoFolderViewProvider', () => {
  function createMockWebviewView() {
    const messageHandlers: Array<(msg: { type?: string }) => void> = [];
    const webviewView = {
      webview: {
        options: {} as unknown,
        html: '',
        onDidReceiveMessage: mock((handler: (msg: { type?: string }) => void) => {
          messageHandlers.push(handler);
          return { dispose: mock() };
        }),
      },
    } as unknown as vscode.WebviewView;
    return { webviewView, fireMessage: (msg: { type?: string }) => messageHandlers.forEach((h) => h(msg)) };
  }

  it('resolves the view SYNCHRONOUSLY with the heading present (breaks the infinite-spinner state)', () => {
    const provider = new NoFolderViewProvider();
    const { webviewView } = createMockWebviewView();

    provider.resolveWebviewView(webviewView);

    expect(webviewView.webview.html).toContain(NO_FOLDER_HEADING);
    expect(webviewView.webview.html.length).toBeGreaterThan(0);
  });

  it('enables scripts so the buttons/links can post a message', () => {
    const provider = new NoFolderViewProvider();
    const { webviewView } = createMockWebviewView();

    provider.resolveWebviewView(webviewView);

    expect((webviewView.webview.options as { enableScripts?: boolean }).enableScripts).toBe(true);
  });

  it('runs the native folder picker when the webview posts an openFolder message', () => {
    const provider = new NoFolderViewProvider();
    const { webviewView, fireMessage } = createMockWebviewView();

    provider.resolveWebviewView(webviewView);
    fireMessage({ type: 'openFolder' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.openFolder');
  });

  it('runs the add-root-folder command (not openFolder) when the webview posts an addFolder message', () => {
    const provider = new NoFolderViewProvider();
    const { webviewView, fireMessage } = createMockWebviewView();

    provider.resolveWebviewView(webviewView);
    fireMessage({ type: 'addFolder' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.addRootFolder');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('workbench.action.files.openFolder');
  });

  it('ignores messages of an unrelated type', () => {
    const provider = new NoFolderViewProvider();
    const { webviewView, fireMessage } = createMockWebviewView();

    provider.resolveWebviewView(webviewView);
    fireMessage({ type: 'somethingElse' });

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
