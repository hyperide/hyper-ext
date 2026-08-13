/**
 * @file PreviewPanelApp shell-state selection tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanelApp.test.ts
 * Assumptions: preview shell state is derived only from devServerRunning/disconnected flags.
 * Past bugs: HYP-363 — disconnected preview snapshots captured an unstable shell between stop and rerender.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it } from 'bun:test';
import { getPreviewShellScreen } from '../webview-preview-panel/PreviewPanelApp';

describe('getPreviewShellScreen', () => {
  it('keeps a dedicated disconnected shell after a prior connection drops', () => {
    expect(getPreviewShellScreen(false, true)).toBe('disconnected');
  });

  it('shows the initial start screen before any successful connection', () => {
    expect(getPreviewShellScreen(false, false)).toBe('start');
  });

  it('shows the live preview while the dev server is running', () => {
    expect(getPreviewShellScreen(true, false)).toBe('preview');
    expect(getPreviewShellScreen(true, true)).toBe('preview');
  });
});
